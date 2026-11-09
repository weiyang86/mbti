import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions } from "./readiness-support.mjs";
import { inspectApi } from "./readiness-manual.mjs";

test("manual auth preparation owns actual main, preserves credentials and shuts down cleanly", { timeout: 55000 }, async t => {
  await assertPortAvailable(3656);
  const parent = join(repositoryRoot, ".artifacts/af-013/manual-test"); mkdirSync(parent, { recursive: true }); const root = mkdtempSync(join(parent, "run-")); let state;
  const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
  function run(action) {
    const r = spawnSync(process.execPath, ["scripts/verification/auth-manual.mjs", action], { cwd: repositoryRoot, encoding: "utf8", timeout: 40000, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    assert.equal(r.status, 0, r.stderr); writeFileSync(join(root, action + ".json"), JSON.stringify({ command: [process.execPath, "scripts/verification/auth-manual.mjs", action], exitCode: r.status, stdout: r.stdout, stderr: r.stderr }, null, 2) + "\n"); return JSON.parse(r.stdout);
  }
  try {
    await t.test("safe hook reports actual URLs/credential paths; real login and Bearer me succeed", async () => {
      state = run("prepare"); assert.equal(state.status, "PREPARED"); assert.equal(state.username, "aij-admin");
      const password = JSON.parse(readFileSync(state.initialPasswordFile)).password, key = JSON.parse(readFileSync(state.jwtKeyFile)).JWT_SECRET;
      for (const secret of [password, key, readFileSync(state.databasePasswordFile, "utf8").trim()]) {
        assert.ok(!JSON.stringify(state).includes(secret)); assert.ok(!readFileSync(state.logFile, "utf8").includes(secret));
      }
      const login = await fetch(state.loginUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: state.username, password }), signal: AbortSignal.timeout(5000) }); assert.equal(login.status, 200);
      const token = (await login.json()).data.accessToken;
      const me = await fetch(state.meUrl, { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(5000) }); assert.equal(me.status, 200); assert.equal((await me.json()).data.username, state.username);
      assert.equal((await applicationSessions(state.acceptanceId, "AF-013")).length, 1);
    });
    await t.test("repeat preparation keeps owned process, database and initial/JWT files byte-identical", () => {
      const before = [state.initialPasswordFile, state.jwtKeyFile].map(hash), actual = inspectApi(state.pid), repeated = run("prepare");
      assert.equal(repeated.pid, state.pid); assert.equal(repeated.acceptanceId, state.acceptanceId); assert.equal(inspectApi(state.pid).birth, actual.birth);
      assert.deepEqual([state.initialPasswordFile, state.jwtKeyFile].map(hash), before);
    });
    await t.test("verified exact PID SIGTERM closes main and all its application sessions", async () => {
      const stopped = run("stop"); assert.equal(stopped.status, "STOPPED"); assert.deepEqual(await applicationSessions(state.acceptanceId, "AF-013"), []); await assertPortAvailable(3656); state = undefined;
    });
  } finally { if (state) run("stop"); }
});
