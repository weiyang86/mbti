import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
import test from "node:test";
import environment from "../runtime-environment.cjs";

test("AIJ defaults are independent loopback ports and an empty plugin set", () => {
  const config = environment.resolveRuntimeEnvironment({});
  assert.equal(config.webPort, 3655);
  assert.equal(config.apiPort, 3656);
  assert.equal(config.apiUrl, "http://localhost:3656/api");
  assert.deepEqual(config.enabledPlugins, []);
  assert.equal(config.asyncRuntimeEnabled, false);
});

test("durable async runtime stays off by default and fails closed without auth/database", () => {
  assert.throws(() => environment.resolveRuntimeEnvironment({ ASYNC_RUNTIME_ENABLED: "yes" }), /ASYNC_RUNTIME_ENABLED/);
  assert.throws(() => environment.resolveRuntimeEnvironment({ ASYNC_RUNTIME_ENABLED: "true" }), /requires administrator auth and the database capability/);
});

test("old product ports and malformed port settings fail before startup", () => {
  for (const env of [{ API_PORT: "3556" }, { WEB_PORT: "3555" }, { API_PORT: "3656junk" }, { WEB_PORT: "" }]) {
    assert.throws(() => environment.resolveRuntimeEnvironment(env), /must be/);
  }
});

test("API and Web configuration rejects old/external targets and credential URLs", () => {
  for (const apiUrl of ["http://localhost:3556/api", "https://example.com/api", "http://user:secret@localhost:3656/api", "http://localhost:3656/api?key=secret", "http://localhost:3656/other"]) {
    assert.throws(() => environment.resolveRuntimeEnvironment({ NEXT_PUBLIC_API_URL: apiUrl }), /NEXT_PUBLIC_API_URL/);
  }
  assert.throws(() => environment.resolveRuntimeEnvironment({ WEB_URL: "http://localhost:3555" }), /WEB_URL/);
  assert.equal(environment.resolveRuntimeEnvironment({ NEXT_PUBLIC_API_URL: "http://127.0.0.1:3656/api" }).apiUrl, "http://127.0.0.1:3656/api");
});

test("proxy hops and plugin codes are validated without echoing arbitrary values", () => {
  for (const hops of ["-1", "1.5", "11", "garbage"]) assert.throws(() => environment.resolveRuntimeEnvironment({ TRUST_PROXY_HOPS: hops }), /TRUST_PROXY_HOPS/);
  assert.throws(() => environment.resolveRuntimeEnvironment({ ENABLED_PLUGINS: "bad/code" }), /invalid plugin code/);
  assert.deepEqual(environment.resolveRuntimeEnvironment({ ENABLED_PLUGINS: "aij-ai, aij-ai" }).enabledPlugins, ["aij-ai"]);
});

test("the reviewed example has no startup requirement for unmigrated database/auth", () => {
  const example = parseEnv(readFileSync(resolve(environment.repositoryRoot, ".env.example"), "utf8"));
  assert.equal(example.JWT_SECRET, "");
  assert.equal(example.POSTGRES_PASSWORD, "");
  assert.deepEqual(environment.resolveRuntimeEnvironment(example).enabledPlugins, []);
});

test("environment root is fixed to the new workspace independently of app cwd", () => {
  const helper = resolve(environment.repositoryRoot, "scripts/runtime-environment.cjs");
  const child = spawnSync(process.execPath, ["-e", `process.stdout.write(require(${JSON.stringify(helper)}).repositoryRoot)`], {
    cwd: resolve(environment.repositoryRoot, "apps/web"), encoding: "utf8"
  });
  assert.equal(child.status, 0);
  assert.equal(child.stdout, environment.repositoryRoot);
});

test("unknown plugin settings reject the real launcher before it binds a port", () => {
  const child = spawnSync(process.execPath, ["scripts/run-app.mjs", "api", "start"], {
    cwd: environment.repositoryRoot,
    env: { ...process.env, ENABLED_PLUGINS: "unknown-plugin" }, encoding: "utf8"
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /not in the registered launch allowlist/);
});
