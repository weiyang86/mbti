import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../database/connection.mjs";

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return address.port;
}

test("AF-086 customer auth pages are served by the actual Next Web consumer over isolated loopback HTTP", { timeout: 600_000 }, async () => {
  const root = realpathSync(repositoryRoot), webRoot = join(root, "apps/web");
  const projectRoot = resolve(root, ".local-data/projects/af086-web-routes");
  mkdirSync(projectRoot, { recursive: true, mode: 0o700 });
  const webPort = await freePort();
  let apiPort = await freePort();
  while (apiPort === webPort) apiPort = await freePort();
  assert.notEqual(webPort, apiPort);
  const environment = {
    NODE_ENV: "development", RUNTIME_PROFILE: "project", AIJ_PROJECT_ROOT: projectRoot,
    PROJECT_ID: "aij-af086-web-routes", APP_ENV: "test",
    WEB_PORT: String(webPort), API_PORT: String(apiPort), WEB_URL: `http://127.0.0.1:${webPort}`,
    NEXT_PUBLIC_API_URL: `http://127.0.0.1:${apiPort}/api`,
    JWT_ISSUER: "urn:aij:aij-af086-web-routes:test:api", COOKIE_PREFIX: "aij_af086_web_routes_test",
    LOCAL_STORAGE_ROOT: ".local-data/aij-af086-web-routes/test/storage",
    AUTH_ENABLED: "false", CLIENT_AUTH_ENABLED: "false", DATABASE_ENABLED: "false", STORAGE_ENABLED: "false",
    ASYNC_RUNTIME_ENABLED: "false", ENABLED_PLUGINS: "", AIJ_NEXT_DIST_DIR: ".next-af086-routes-wp"
  };
  const saved = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  const webConfigFiles = ["tsconfig.json", "next-env.d.ts"].map(name => {
    const path = join(webRoot, name);
    return [path, readFileSync(path)];
  });
  Object.assign(process.env, environment);
  let webProcess;
  try {
    const runApp = resolve(root, "scripts/run-app.mjs");
    webProcess = spawn(process.execPath, [runApp, "web", "dev"], {
      cwd: root,
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let childOutput = "";
    const collect = chunk => { childOutput = (childOutput + chunk.toString()).slice(-20_000); };
    webProcess.stdout.on("data", collect);
    webProcess.stderr.on("data", collect);
    const endpoint = `http://127.0.0.1:${webPort}`;
    const readyDeadline = Date.now() + 120_000;
    let ready = false;
    while (!ready && Date.now() < readyDeadline) {
      if (webProcess.exitCode !== null || webProcess.signalCode !== null) assert.fail(`owned Next dev process exited before HTTP readiness (exit=${webProcess.exitCode}, signal=${webProcess.signalCode})`);
      try {
        const response = await fetch(endpoint + "/client/login", { headers: { connection: "close" }, signal: AbortSignal.timeout(5_000) });
        ready = response.status === 200;
        if (ready) await response.body?.cancel();
      } catch {
        await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
      }
    }
    assert.ok(ready, `owned Next dev process became ready on its OS-selected loopback port${childOutput ? `; output: ${childOutput.slice(-1500)}` : ""}`);
    const pages = [
      ["/client/login", "Workspace 登录"],
      ["/client/register", "创建账号"],
      ["/client/verify-email", "验证客户邮箱"],
      ["/client/forgot-password", "找回密码"],
      ["/client/reset-password", "设置新密码"]
    ];
    for (const [path, heading] of pages) {
      const response = await fetch(endpoint + path, { headers: { connection: "close" }, signal: AbortSignal.timeout(45_000) });
      assert.equal(response.status, 200, `${path} must be served by the real Next HTTP consumer`);
      assert.equal(new URL(response.url).pathname, path, `${path} must not be satisfied by a redirect to an unrelated route`);
      const html = await response.text();
      assert.ok(html.includes(heading), `${path} includes the visible customer-auth heading`);
      assert.ok(html.includes("__next"), `${path} contains Next's actual rendered document`);
    }
  } finally {
    if (webProcess && webProcess.exitCode === null) {
      let stopTimer;
      const exited = new Promise(resolveExit => webProcess.once("exit", resolveExit));
      webProcess.kill("SIGTERM");
      try {
        await Promise.race([
          exited,
          new Promise((_, rejectTimeout) => { stopTimer = setTimeout(() => rejectTimeout(new Error("owned Next dev process did not stop after SIGTERM")), 15_000); })
        ]);
      } finally { clearTimeout(stopTimer); }
    }
    for (const [path, content] of webConfigFiles) writeFileSync(path, content);
    for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
