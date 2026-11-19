// Root-only actual persistent lifecycle. No fixture, vendor or other project mutation.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { paths, profile, root, readLocalState, systemEnvironment, assertRepository, assertPath } from "../ai-local-development/config.mjs";
import { inspectResources, localDocker } from "../ai-local-development/docker.mjs";
import { withAiLocalDatabase } from "../ai-local-development/database.mjs";
import { checkedProcesses } from "../ai-local-development/processes.mjs";
import { w21NativeBrowser } from "./w21-native-browser.mjs";
import * as sdk from "../../packages/sdk/dist/index.mjs";

assert.deepEqual(process.argv.slice(2), ["--root-af220"]);
assertRepository();
assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
const parent = join(root, ".artifacts/auto-ai-program-20261105/AF-220"); mkdirSync(parent, { recursive: true });
const artifact = mkdtempSync(join(parent, "lifecycle-")), observations = [];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const origin = "http://127.0.0.1:3955", base = "http://127.0.0.1:3956/api";
const browser = w21NativeBrowser(artifact);
let success = false, phase = "INIT";
const phaseAt = value => { phase = value; writeFileSync(join(artifact, "progress.json"), JSON.stringify({ phase, at: new Date().toISOString() })); };
const cli = (action, expectedExit = 0) => {
  const result = spawnSync(process.execPath, ["scripts/ai-local-development/cli.mjs", action], {
    cwd: root, env: systemEnvironment(), encoding: "utf8", timeout: 840000, maxBuffer: 4 * 1024 * 1024
  });
  assert.equal(result.status, expectedExit, "AF220 CLI " + action + " failed; consult private initialization progress, raw output withheld");
  let value;
  try { value = JSON.parse(result.status === 0 ? result.stdout : result.stderr); }
  catch { assert.fail("AF220 controlled CLI receipt required"); }
  observations.push({ action, exitCode: result.status, status: value.status }); return value;
};
const raw = async (path, { cookie, method = "GET", body, workspaceId, expected = 200 } = {}) => {
  const headers = { origin, "x-aij-client": "web", connection: "close", ...(cookie ? { cookie } : {}), ...(workspaceId ? { "x-aij-workspace-id": workspaceId } : {}),
    ...(body === undefined || body instanceof FormData ? {} : { "content-type": "application/json" }) };
  const response = await fetch(base + path, { method, headers, body: body === undefined || body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, expected, "Actual HTTP status: " + method + " " + path.split("?", 1)[0]);
  observations.push({ method, path: path.split("?", 1)[0], status: response.status }); return response;
};
const snapshot = async () => {
  const { values } = readLocalState();
  return withAiLocalDatabase(values, async client => {
    const result = {};
    for (const table of ["organization_profile", "project_profile", "sys_menu", "sys_user", "sys_role", "sys_permission", "sys_user_role", "sys_role_permission",
      "member_user", "client_workspace", "client_workspace_membership", "client_workspace_role", "client_workspace_role_permission", "client_workspace_permission", "scoped_config", "plugin_installation", "personal_document", "personal_document_version", "file_asset"])
      result[table] = sha(JSON.stringify((await client.query('SELECT * FROM public."' + table + '" ORDER BY id')).rows));
    return result; // Digests only: raw password hashes and content never enter evidence.
  });
};
// docker ps --format json is one JSON object per line, not a JSON array.
const other = () => {
  const text = execFileSync("docker", ["ps", "-a", "--format", "{{json .}}"], { encoding: "utf8", env: systemEnvironment() });
  return text.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(row => row.Names !== profile.container)
    .map(row => ({ id: row.ID, name: row.Names, state: row.State })).sort((a, b) => a.id.localeCompare(b.id));
};
const beforeOther = other();
try {
  if (existsSync(paths.owner) && Object.keys(checkedProcesses(readLocalState().owner)).length) cli("stop");
  assert.equal(cli("init").status, "INITIALIZED");
  let state = readLocalState(); assert.equal(state.owner.initialized, true);
  assert.equal(inspectResources(localDocker(state.owner), state.owner).State.Running, true);
  const initialized = JSON.parse(readFileSync(join(profile.directory, "initialization.json"), "utf8"));
  assert.equal(initialized.applicationPools, 0); assert.equal(initialized.workspaces.length, 5);
  assert.equal(new Set(initialized.workspaces.map(x => x.workspaceId)).size, 5);
  const privatePaths = [paths.environment, paths.password, paths.credentials, join(profile.directory, "initial-clients.json")];
  for (const path of privatePaths) assertPath(path, { restricted: true });
  phaseAt("START"); assert.equal(cli("start").status, "RUNNING");
  const processes = checkedProcesses(state.owner); assert.deepEqual(Object.keys(processes).sort(), ["api", "web"]);
  const credential = JSON.parse(readFileSync(paths.credentials, "utf8"));
  const adminLogin = await raw("/auth/browser-login", { method: "POST", body: { username: credential.username, password: credential.password } });
  const adminCookie = adminLogin.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(adminCookie); await adminLogin.body?.cancel();
  const menus = (await (await raw("/admin/menus/my", { cookie: adminCookie })).json()).data;
  assert.ok(menus.some(menu => menu.path === "/auth/ai/center"));
  const accounts = JSON.parse(readFileSync(join(profile.directory, "initial-clients.json"), "utf8")).accounts;
  const clients = [];
  phaseAt("FIVE_CLIENTS_AND_CURRENT_OWNERS");
  for (const account of accounts) {
    const login = await raw("/client/auth/login", { method: "POST", body: { email: account.email, password: account.password } });
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie); await login.body?.cancel();
    const me = (await (await raw("/client/auth/me", { cookie })).json()).data; assert.equal(me.id, account.id);
    const list = (await (await raw("/client/workspaces", { cookie })).json()).data;
    const own = initialized.workspaces.find(x => x.memberId === me.id); assert.ok(own);
    assert.ok(list.items.some(item => item.workspace.id === own.workspaceId));
    const context = (await (await raw("/client/workspaces/context", { cookie, workspaceId: own.workspaceId })).json()).data;
    assert.equal(context.workspaceId, own.workspaceId); assert.ok(context.permissions.includes("workspace.documents.manage"));
    clients.push({ account, cookie, workspaceId: own.workspaceId });
  }
  assert.equal(clients.length, 5);
  const owner = clients[0];
  const api = sdk.createClientApi(() => base);
  const request = (path, options = {}) => api(path, { ...options, headers: { ...Object.fromEntries(new Headers(options.headers)), cookie: owner.cookie, origin, connection: "close" } });
  const documents = sdk.createPersonalDocumentsClient(request);
  const nonce = randomBytes(5).toString("hex"), text = "AF220 synthetic persistent document " + nonce;
  const doc = await documents.create(owner.workspaceId, { code: "af220-" + nonce, name: "Local synthetic check", body: text });
  assert.equal((await documents.get(owner.workspaceId, doc.id)).body, text);
  const updated = await documents.update(owner.workspaceId, doc.id, { expectedRevision: doc.revision, name: doc.name, body: text + " v2" });
  assert.equal(updated.revision, 2); assert.equal((await documents.versions(owner.workspaceId, doc.id)).items.length, 2);
  await raw("/client/documents/" + doc.id, { expected: 401, workspaceId: owner.workspaceId });
  await raw("/client/documents/" + doc.id, { cookie: clients[1].cookie, expected: 403, workspaceId: owner.workspaceId });
  await raw("/client/documents/" + doc.id, { cookie: clients[1].cookie, expected: 404, workspaceId: clients[1].workspaceId });
  for (const factory of [sdk.createPersonalAgentsClient, sdk.createPersonalWorkflowsClient]) assert.ok(Array.isArray((await factory(request).list(owner.workspaceId)).items));
  const form = new FormData(); form.set("file", new Blob([text], { type: "text/plain" }), "af220-synthetic.txt");
  const upload = (await (await raw("/client/files", { cookie: owner.cookie, method: "POST", body: form, expected: 201 })).json()).data;
  assert.ok(upload.id); const downloaded = await raw("/client/files/" + upload.id, { cookie: owner.cookie });
  assert.equal(sha(Buffer.from(await downloaded.arrayBuffer())), sha(text));
  await raw("/client/files/" + upload.id, { cookie: clients[1].cookie, expected: 404 });
  for (const page of ["/login", "/client/login", "/auth/ai/center", "/client/workspaces", "/client/documents", "/client/agents", "/client/workflows"]) {
    const response = await fetch(origin + page, { signal: AbortSignal.timeout(15000) }); assert.equal(response.status, 200, page); await response.body?.cancel();
  }
  phaseAt("DESKTOP_AND_390_ORIGINAL_LOGIN");
  await browser.action("create", ["--url", origin + "/client/login", "--split", "right"]); await browser.action("switch");
  await browser.action("wait", ["--selector", ".auth-card form, .client-login-actions"]);
  if (await browser.read('[...document.querySelectorAll("button")].some(button => button.textContent.replace(/\\s/g, "") === "退出并切换账号")')) {
    await browser.activate("退出并切换账号"); await browser.action("wait", ["--selector", ".auth-card form"]);
  }
  await browser.fill("邮箱", owner.account.email, true); await browser.fill("密码", owner.account.password, true);
  await browser.activate("登录"); await browser.action("wait", ["--url", origin + "/client/workspaces"]);
  await browser.shot("desktop-workspaces");
  await browser.action("viewport", ["--width", "390", "--height", "844", "--scale", "1", "--mobile"]);
  assert.equal(await browser.read("innerWidth"), 390); await browser.shot("mobile390-workspaces"); await browser.close();
  phaseAt("REINITIALIZATION_PRESERVES_DATA");
  assert.equal(cli("stop").status, "STOPPED");
  // Init restarts only its database; snapshot while no application is mutating sessions.
  const { startDatabase } = await import("../ai-local-development/docker.mjs");
  state = readLocalState(); await startDatabase(localDocker(state.owner), state);
  const before = await snapshot(), digests = privatePaths.map(path => [path, sha(readFileSync(path))]);
  assert.equal(cli("init").status, "INITIALIZED");
  assert.deepEqual(await snapshot(), before);
  for (const [path, digest] of digests) assert.equal(sha(readFileSync(path)), digest, "Private initial file preserved");
  const hook = join(root, "scripts/ai-local-development/root-initialization.mjs"), held = join(artifact, "held-owned-root-hook.mjs");
  renameSync(hook, held);
  try { assert.equal(cli("init", 2).status, "REJECTED"); }
  finally { renameSync(held, hook); }
  assert.deepEqual(await snapshot(), before);
  assert.equal(cli("stop").status, "STOPPED");
  phaseAt("ACTUAL_PORT_AND_NEXT_ENV_REFUSALS");
  const occupied = createServer(); await new Promise(resolve => occupied.listen(profile.webPort, "127.0.0.1", resolve));
  try { assert.equal(cli("start", 2).status, "REJECTED"); } finally { await new Promise(resolve => occupied.close(resolve)); }
  const envFile = join(root, "apps/web/.env.production.local"), marker = "SYNTHETIC_AF220_REJECTION=1\n";
  assert.equal(existsSync(envFile), false); writeFileSync(envFile, marker, { flag: "wx", mode: 0o600 });
  try { assert.equal(cli("start", 2).status, "REJECTED"); assert.equal(readFileSync(envFile, "utf8"), marker); } finally { unlinkSync(envFile); }
  phaseAt("RESTART_AND_PERSISTENCE"); assert.equal(cli("start").status, "RUNNING");
  assert.equal((await documents.get(owner.workspaceId, doc.id)).body, updated.body);
  const restoredFile = await raw("/client/files/" + upload.id, { cookie: owner.cookie }); assert.equal(sha(Buffer.from(await restoredFile.arrayBuffer())), sha(text));
  assert.deepEqual(other(), beforeOther);
  const runtime = readLocalState(); assert.equal(runtime.values.AI_CENTER_LIVE_ENABLED, "false"); assert.equal(runtime.values.AIJ_DOCUMENT_EXPORT_ENABLED, "false");
  writeFileSync(join(artifact, "result.json"), JSON.stringify({ task: "AF-220", status: "ROOT_ASSERTED", ownerAcceptance: "PENDING", artifact,
    project: profile.project, initializedPools: 0, fiveClients: 5, independentWorkspaces: 5, realSdkDocumentRevisions: 2,
    nonDestructiveReinitialization: true, ownedHookMissingRefusal: true, ownedPortRefusal: true, webEnvRefusal: true,
    fileAndDocumentSurvivedRestart: true, otherResourcesUnchanged: true, vendorLive: false, documentExport: false,
    services: "RUNNING_OWNED_PERSISTENT", web: origin, api: base, observations }, null, 2) + "\n", { mode: 0o600 });
  success = true; console.log(JSON.stringify({ task: "AF-220", status: "ROOT_ASSERTED", artifact, services: "RUNNING_OWNED_PERSISTENT", ownerAcceptance: "PENDING" }));
} catch (error) {
  writeFileSync(join(artifact, "failure.json"), JSON.stringify({ phase, code: typeof error?.code === "string" && /^[A-Z0-9_]{2,60}$/.test(error.code) ? error.code : "FAILED",
    frames: String(error?.stack ?? "").split("\n").filter(line => /^\s+at /.test(line)).slice(0, 8) }, null, 2));
  throw Error("AF220 actual acceptance failed at " + phase + "; private evidence: " + artifact);
} finally {
  await browser.close();
  if (!success && existsSync(paths.owner)) cli("stop");
}
