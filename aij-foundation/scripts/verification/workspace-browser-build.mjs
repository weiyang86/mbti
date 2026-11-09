import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertPortAvailable } from "../port-availability.mjs";
import { repositoryRoot } from "../database/connection.mjs";

const require = createRequire(join(repositoryRoot, "apps/web/package.json"));
const webRoot = join(repositoryRoot, "apps/web");
const nextBin = require.resolve("next/dist/bin/next");
const outputDir = join(repositoryRoot, ".artifacts/af-058");
const tsconfig = join(webRoot, "tsconfig.json");
const baselineTsconfig = readFileSync(tsconfig);

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await assertPortAvailable(port);
  return port;
}

assert.equal(process.versions.node.split(".")[0], "24", "AIJ build uses pinned Node 24 runtime");
const webPort = await freePort();
let apiPort = await freePort();
while (apiPort === webPort) apiPort = await freePort();
const projectId = "aij-g10-06";
const runtime = {
  RUNTIME_PROFILE: "project", PROJECT_ID: projectId, APP_ENV: "test", NODE_ENV: "production",
  WEB_PORT: String(webPort), API_PORT: String(apiPort),
  WEB_URL: "http://127.0.0.1:" + webPort,
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:" + apiPort + "/api",
  JWT_ISSUER: "urn:aij:" + projectId + ":test:web", COOKIE_PREFIX: "aij_g10_06_test",
  LOCAL_STORAGE_ROOT: ".local-data/" + projectId + "/test/storage",
  AUTH_ENABLED: "false", CLIENT_AUTH_ENABLED: "false", DATABASE_ENABLED: "false",
  STORAGE_ENABLED: "false", ASYNC_RUNTIME_ENABLED: "false", ENABLED_PLUGINS: "",
  AIJ_NEXT_DIST_DIR: ".next-af058"
};
const command = [process.execPath, nextBin, "build", "--webpack"];
const result = spawnSync(command[0], command.slice(1), {
  cwd: webRoot, env: { ...process.env, ...runtime }, stdio: "inherit", timeout: 600000
});
const exitCode = result.status ?? (result.error?.code === "ETIMEDOUT" ? 124 : 1);
if (!readFileSync(tsconfig).equals(baselineTsconfig)) writeFileSync(tsconfig, baselineTsconfig);
mkdirSync(outputDir, { recursive: true, mode: 0o700 });
const evidence = {
  task: "AF-058", command, cwd: "apps/web", exitCode,
  webOrigin: runtime.WEB_URL, webUrl: runtime.WEB_URL + "/client/login",
  apiUrl: runtime.NEXT_PUBLIC_API_URL, projectId, appEnvironment: "test",
  distDirectory: runtime.AIJ_NEXT_DIST_DIR, tsconfigRestored: readFileSync(tsconfig).equals(baselineTsconfig),
  completedAt: new Date().toISOString()
};
writeFileSync(join(outputDir, "browser-build.json"), JSON.stringify(evidence, null, 2) + "\n", { flag: "w", mode: 0o600 });
console.log(JSON.stringify({ task: evidence.task, command, exitCode, webUrl: evidence.webUrl, apiUrl: evidence.apiUrl, tsconfigRestored: evidence.tsconfigRestored }));
if (!evidence.tsconfigRestored) process.exitCode = 1;
else if (exitCode) process.exitCode = exitCode;
