import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { checkDatabase, repositoryRoot } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { prepareWorkspaceBrowserMembers, workspaceBrowserEnvironment, workspaceBrowserTask } from "./workspace-browser-fixture.mjs";

const outputDir = join(repositoryRoot, ".artifacts/af-058");
const require = createRequire(join(repositoryRoot, "apps/web/package.json"));
const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
const nextBin = require.resolve("next/dist/bin/next");
const webRoot = join(repositoryRoot, "apps/web");
const build = JSON.parse(await readFile(join(outputDir, "browser-build.json"), "utf8"));
const url = new URL(build.webOrigin);
const webPort = Number(url.port), apiPort = new URL(build.apiUrl).port;
assert.equal(build.task, workspaceBrowserTask);
assert.equal(build.exitCode, 0, "isolated Web production build must already pass");
await assertPortAvailable(webPort);
await assertPortAvailable(Number(apiPort));
const databaseIdentity = await checkDatabase("test");
assert.equal(databaseIdentity.target.port, 55433);
assert.equal(databaseIdentity.identity.database, "aij_foundation_test");
assert.equal(databaseIdentity.identity.sessionUser, "aij_foundation_test");

const lease = await createAcceptance("test", workspaceBrowserTask);
const deployed = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
assert.equal(deployed.exitCode, 0);
const fixture = await prepareWorkspaceBrowserMembers(lease.id);
const credentials = JSON.parse(await readFile(fixture.accounts[0].initialPasswordFile, "utf8")).accounts;
const [alphaMember, betaOwner] = credentials;
const values = await workspaceBrowserEnvironment(lease.id);
const previousEnvironment = { ...process.env };
let app;
let webChild;
let stopped = false;
let alpha;
let beta;
let manualEvidence;
let manualRecord;

function setEnvironment(environment) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, environment);
}
async function api(method, path, { cookie, workspaceId, body } = {}) {
  const response = await fetch("http://127.0.0.1:" + apiPort + "/api/" + path, {
    method,
    headers: {
      connection: "close", origin: build.webOrigin,
      ...(cookie ? { cookie } : {}),
      ...(workspaceId ? { "x-aij-workspace-id": workspaceId } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json();
  return { response, data };
}
async function expect(method, path, status, options) {
  const result = await api(method, path, options);
  assert.equal(result.response.status, status, method + " " + path + " status mismatch");
  return result;
}
async function login(account) {
  const result = await expect("POST", "client/auth/login", 200, { body: { email: account.email, password: account.password } });
  return result.response.headers.get("set-cookie").split(";")[0];
}

async function shutdown() {
  if (stopped) return;
  stopped = true;
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
  if (webChild && webChild.exitCode === null) {
    const pid = webChild.pid;
    if (!Number.isSafeInteger(pid) || pid === process.pid || pid === process.ppid) throw new Error("Refusing to signal unowned Web process");
    webChild.kill("SIGTERM");
    await Promise.race([
      new Promise(resolve => webChild.once("exit", resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Owned Web process did not stop after SIGTERM")), 10000))
    ]);
  }
  if (app) { await app.close(); app = undefined; }
  setEnvironment(previousEnvironment);
}
function onSignal() { void shutdown().then(() => process.exit(0), error => { console.error(error.message); process.exitCode = 1; }); }
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);

try {
  setEnvironment(values);
  app = await createApplication({ testBrowserOrigin: build.webOrigin });
  await app.listen(Number(apiPort), "127.0.0.1");
  const alphaCookie = await login(alphaMember);
  const betaCookie = await login(betaOwner);
  alpha = (await expect("POST", "client/workspaces", 201, { cookie: alphaCookie, body: { name: "AF-058 Alpha", idempotencyKey: "af058-alpha" } })).data.data;
  beta = (await expect("POST", "client/workspaces", 201, { cookie: betaCookie, body: { name: "AF-058 Beta", idempotencyKey: "af058-beta" } })).data.data;
  const roles = await expect("GET", "client/workspaces/roles", 200, { cookie: betaCookie, workspaceId: beta.id });
  const memberRole = roles.data.data.find(role => role.code === "MEMBER");
  assert.ok(memberRole);
  await expect("POST", "client/workspaces/members", 201, { cookie: betaCookie, workspaceId: beta.id, body: { memberId: alphaMember.id, roleId: memberRole.id } });

  const port = Number(webPort);
  const projectId = "aij-g10-06";
  const webEnv = {
    PATH: previousEnvironment.PATH, HOME: previousEnvironment.HOME, TMPDIR: previousEnvironment.TMPDIR,
    LANG: "C.UTF-8", LC_ALL: "C.UTF-8", RUNTIME_PROFILE: "project", PROJECT_ID: projectId,
    APP_ENV: "test", NODE_ENV: "production", WEB_PORT: String(port), API_PORT: String(apiPort),
    WEB_URL: build.webOrigin, NEXT_PUBLIC_API_URL: build.apiUrl,
    JWT_ISSUER: "urn:aij:" + projectId + ":test:web", COOKIE_PREFIX: "aij_g10_06_test",
    LOCAL_STORAGE_ROOT: ".local-data/" + projectId + "/test/storage",
    AUTH_ENABLED: "false", CLIENT_AUTH_ENABLED: "false", DATABASE_ENABLED: "false",
    STORAGE_ENABLED: "false", ASYNC_RUNTIME_ENABLED: "false", ENABLED_PLUGINS: "",
    AIJ_NEXT_DIST_DIR: build.distDirectory
  };
  webChild = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: webRoot, env: webEnv, stdio: "inherit", detached: false
  });
  let webExited;
  webChild.once("exit", (code, signal) => { webExited = { code, signal }; });
  const deadline = Date.now() + 90000;
  let webReady = false;
  while (Date.now() < deadline) {
    if (webExited) throw new Error("Owned Next host exited before becoming ready: " + JSON.stringify(webExited));
    try {
      const response = await fetch(build.webUrl, { signal: AbortSignal.timeout(2000) });
      if (response.status === 200 && (await response.text()).includes("Workspace 登录")) { webReady = true; break; }
    } catch { /* Wait for the owned Next process to serve the page. */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  assert.equal(webReady, true, "production Web host must serve the actual client login route");
  const manual = {
    task: workspaceBrowserTask, state: "PREPARED", webUrl: build.webUrl,
    apiUrl: build.apiUrl, browserOrigin: build.webOrigin,
    accounts: [
      { username: alphaMember.username, email: alphaMember.email, roles: ["owner in Alpha", "member in Beta"] },
      { username: betaOwner.username, email: betaOwner.email, roles: ["owner in Beta"] }
    ],
    initialPasswordFile: fixture.accounts[0].initialPasswordFile,
    acceptanceId: lease.id, database: lease.database,
    workspaces: [{ id: alpha.id, name: alpha.name }, { id: beta.id, name: beta.name }],
    apiOwner: { pid: process.pid, ppid: process.ppid, cwd: process.cwd(), command: "workspace-browser-manual.mjs start", startedAt: new Date().toISOString() },
    webOwner: { pid: webChild.pid, ppid: process.pid, cwd: webRoot, command: [process.execPath, nextBin, "start", "--hostname", "127.0.0.1", "--port", String(port)], processGroupOwned: false },
    stop: "Send Ctrl-C to the terminal session running this script; it will SIGTERM only its recorded Next child and close its in-process Nest API/pool.",
    data: "synthetic clients/workspaces only"
  };
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  manualEvidence = join(outputDir, "manual-" + lease.id + ".json");
  manualRecord = manual;
  await writeFile(manualEvidence, JSON.stringify(manual, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({
    task: workspaceBrowserTask, state: "PREPARED", webUrl: manual.webUrl, apiUrl: manual.apiUrl,
    usernames: manual.accounts.map(account => account.username), initialPasswordFile: manual.initialPasswordFile,
    database: lease.database, apiPid: process.pid, webPid: webChild.pid, evidence: manualEvidence, stop: manual.stop
  }));
  await new Promise((resolve, reject) => {
    webChild.once("exit", (code, signal) => reject(new Error("Owned Web host exited during browser check: " + JSON.stringify({ code, signal }))));
  });
} catch (error) {
  console.error("AF-058 manual host failed: " + (error?.message || "unknown error"));
  process.exitCode = 1;
} finally {
  await shutdown();
  if (manualEvidence && manualRecord) {
    manualRecord.state = "STOPPED";
    manualRecord.stoppedAt = new Date().toISOString();
    await writeFile(manualEvidence, JSON.stringify(manualRecord, null, 2) + "\n", { mode: 0o600 });
  }
}
