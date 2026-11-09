import assert from "node:assert/strict";
import test from "node:test";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import environment from "../runtime-environment.cjs";
import { assertPortAvailable } from "../port-availability.mjs";

const root = environment.repositoryRoot;
const parent = join(root, ".artifacts/af-003/http");
mkdirSync(parent, { recursive: true });
const evidence = mkdtempSync(join(parent, "run-"));
const sleep = (ms) => new Promise((accept) => setTimeout(accept, ms));
const baseEnvironment = {
  ...process.env, APP_ENV: "development", RUNTIME_PROFILE: "host", PROJECT_ID: "aij-foundation",
  AUTH_ENABLED: "false", DATABASE_ENABLED: "false", STORAGE_ENABLED: "false", ENABLED_PLUGINS: "",
  WEB_PORT: "3655", API_PORT: "3656", WEB_URL: "http://localhost:3655", NEXT_PUBLIC_API_URL: "http://localhost:3656/api",
  JWT_ISSUER: "urn:aij:aij-foundation:development:api", COOKIE_PREFIX: "aij_foundation_development",
  LOCAL_STORAGE_ROOT: ".local-data/aij-foundation/development/storage", TRUST_PROXY_HOPS: "0"
};
const owned = new Set();

function start(application, values = {}) {
  const child = spawn(process.execPath, ["scripts/run-app.mjs", application, "start"], {
    cwd: root, env: { ...baseEnvironment, ...values }, stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  child.on("error", (error) => { output += error.message; });
  const item = { child, application, output: () => output, exited: once(child, "exit") };
  owned.add(item);
  return item;
}

function processSnapshot(pid) {
  const text = execFileSync("ps", ["-p", String(pid), "-o", "pid=,ppid=,command="], { encoding: "utf8" }).trim();
  const match = text.match(/^(\d+)\s+(\d+)\s+(.+)$/);
  assert.ok(match, "PID/PPID/command must be readable");
  const cwd = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" }).split("\n").find((line) => line.startsWith("n"))?.slice(1);
  return { pid: Number(match[1]), ppid: Number(match[2]), command: match[3], cwd };
}

async function stop(item, name) {
  const { child } = item;
  if (child.exitCode === null && child.signalCode === null) {
    const snapshot = processSnapshot(child.pid);
    assert.equal(snapshot.ppid, process.pid);
    assert.equal(snapshot.cwd, root);
    assert.ok(snapshot.command.includes("scripts/run-app.mjs " + item.application + " start"));
    writeFileSync(join(evidence, name + "-owned-process.json"), JSON.stringify(snapshot, null, 2));
    child.kill("SIGTERM"); // Only this verified owned launcher; it stops its own process group.
    const stopped = await Promise.race([item.exited.then(() => true), sleep(5000).then(() => false)]);
    assert.equal(stopped, true, "owned launcher must stop");
  }
  writeFileSync(join(evidence, name + ".log"), item.output());
  owned.delete(item);
}

async function waitFor(url, item) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (item.child.exitCode !== null || item.child.signalCode !== null) assert.fail("Declared service exited before readiness");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) return response;
    } catch { /* Bounded readiness retry for this declared service. */ }
    await sleep(100);
  }
  assert.fail("Declared service readiness timed out");
}

test("real host Web/API still serve on 3655/3656, with process identity and approved CORS", async () => {
  await assertPortAvailable(3655);
  await assertPortAvailable(3656);
  let api, web;
  try {
    api = start("api");
    const response = await waitFor("http://127.0.0.1:3656/api/health", api);
    const health = await response.json();
    assert.equal(health.data.service, "aij-foundation-api");
    assert.equal(health.data.projectId, "aij-foundation");
    assert.equal(health.data.namespace, "aij-foundation:development");
    assert.equal(health.data.scope, "process");
    assert.equal(health.data.database, "not-configured"); // Current implementation, not a future invariant.
    const cors = await fetch("http://127.0.0.1:3656/api/health", { headers: { origin: "http://localhost:3655" } });
    assert.equal(cors.headers.get("access-control-allow-origin"), "http://localhost:3655");
    const otherOrigin = await fetch("http://127.0.0.1:3656/api/health", { headers: { origin: "http://localhost:4755" } });
    assert.notEqual(otherOrigin.headers.get("access-control-allow-origin"), "http://localhost:4755");
    web = start("web");
    const page = await waitFor("http://127.0.0.1:3655", web);
    const html = await page.text();
    assert.match(html, /已连接 AIJ API/);
    assert.match(html, /http:\/\/localhost:3656\/api\/health/);
    writeFileSync(join(evidence, "host-http.json"), JSON.stringify({ webStatus: 200, apiStatus: 200, health, cors: cors.headers.get("access-control-allow-origin") }, null, 2));
  } finally {
    if (web) await stop(web, "host-web");
    if (api) await stop(api, "host-api");
  }
  await assertPortAvailable(3655);
  await assertPortAvailable(3656);
  let testing;
  try {
    testing = start("api", { NODE_ENV: "test", APP_ENV: undefined, JWT_ISSUER: undefined, COOKIE_PREFIX: undefined, LOCAL_STORAGE_ROOT: undefined });
    const response = await waitFor("http://127.0.0.1:3656/api/health", testing);
    const health = await response.json();
    assert.equal(health.data.namespace, "aij-foundation:test");
    writeFileSync(join(evidence, "host-test-http.json"), JSON.stringify({ status: 200, health }, null, 2));
  } finally {
    if (testing) await stop(testing, "host-test-api");
  }
  await assertPortAvailable(3656);
});

test("two declared synthetic APIs use their own ports, project identities and origins", async () => {
  await assertPortAvailable(4656);
  await assertPortAvailable(4756);
  const services = [];
  const results = [];
  try {
    for (const [id, webPort, apiPort] of [["alpha", 4655, 4656], ["beta", 4755, 4756]]) {
      const values = {
        RUNTIME_PROFILE: "project", PROJECT_ID: id, WEB_PORT: String(webPort), API_PORT: String(apiPort),
        WEB_URL: "http://localhost:" + webPort, NEXT_PUBLIC_API_URL: "http://localhost:" + apiPort + "/api",
        JWT_ISSUER: "urn:aij:" + id + ":development:api", COOKIE_PREFIX: id + "_development",
        LOCAL_STORAGE_ROOT: ".artifacts/af-003/" + id + "/development/storage"
      };
      const service = start("api", values);
      services.push([id, service]);
      const response = await waitFor("http://127.0.0.1:" + apiPort + "/api/health", service);
      const health = await response.json();
      assert.equal(health.data.service, id + "-api");
      assert.equal(health.data.namespace, id + ":development");
      const cors = await fetch("http://127.0.0.1:" + apiPort + "/api/health", { headers: { origin: values.WEB_URL } });
      assert.equal(cors.headers.get("access-control-allow-origin"), values.WEB_URL);
      results.push({ projectId: id, apiPort, health, origin: values.WEB_URL });
    }
    assert.notEqual(results[0].health.data.service, results[1].health.data.service);
    writeFileSync(join(evidence, "synthetic-http.json"), JSON.stringify(results, null, 2));
  } finally {
    for (const [name, item] of services.reverse()) await stop(item, name + "-api");
  }
  await assertPortAvailable(4656);
  await assertPortAvailable(4756);
  assert.equal(owned.size, 0);
});
