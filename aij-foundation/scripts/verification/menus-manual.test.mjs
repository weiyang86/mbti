import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../database/connection.mjs";
import { assertPortAvailable } from "../port-availability.mjs";
import { applicationSessions } from "./readiness-support.mjs";

test("Menu manual fixture uses owned main, distinct local accounts, idempotent credentials and verified shutdown", { timeout: 55000 }, async t => {
  await assertPortAvailable(3656);
  const parent = join(repositoryRoot, ".artifacts/af-020/manual-test"); mkdirSync(parent, { recursive: true }); const root = mkdtempSync(join(parent, "run-")); let state;
  const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
  function run(action) {
    const r = spawnSync(process.execPath, ["scripts/verification/menus-manual.mjs", action], { cwd: repositoryRoot, encoding: "utf8", timeout: 40000, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    writeFileSync(join(root, action + ".json"), JSON.stringify({ command: [process.execPath, "scripts/verification/menus-manual.mjs", action], exitCode: r.status, stdout: r.stdout, stderr: r.stderr }, null, 2) + "\n"); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
  }
  try {
    await t.test("real super/granted/denied accounts authenticate and receive menu management / own tree 200/200/403", async () => {
      state = run("prepare"); assert.equal(state.status, "PREPARED"); assert.equal(state.task, "AF-020"); assert.equal(state.accounts.length, 2);
      const admin = JSON.parse(readFileSync(state.initialPasswordFile)), accounts = JSON.parse(readFileSync(state.accounts[0].initialPasswordFile)).accounts;
      for (const [account, expected] of [[admin, 200], [accounts[0], 200], [accounts[1], 403]]) {
        const login = await fetch(state.loginUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: account.username, password: account.password }), signal: AbortSignal.timeout(8000) }); assert.equal(login.status, 200);
        const token = (await login.json()).data.accessToken;
        const catalog = await fetch("http://localhost:3656/api/admin/menus", { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(8000) }); assert.equal(catalog.status, expected);
        const definitions = await fetch("http://localhost:3656/api/admin/menus/my", { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(8000) }); assert.equal(definitions.status, 200); assert.deepEqual((await definitions.json()).data, []);
        assert.ok(!JSON.stringify(state).includes(account.password)); assert.ok(!readFileSync(state.logFile, "utf8").includes(account.password));
      }
      assert.equal((await applicationSessions(state.acceptanceId, "AF-020")).length, 1);
    });
    await t.test("repeat preparation preserves exact PID, database and both account/JWT files", () => {
      const paths = [state.initialPasswordFile, state.accounts[0].initialPasswordFile, state.jwtKeyFile], before = paths.map(hash), repeated = run("prepare");
      assert.equal(repeated.pid, state.pid); assert.equal(repeated.acceptanceId, state.acceptanceId); assert.deepEqual(paths.map(hash), before);
    });
    await t.test("wrong-task ownership record rejects preparation before reusing or stopping the live API", async () => {
      const path = join(repositoryRoot, ".artifacts/af-020/manual.json"), before = readFileSync(path);
      try {
        writeFileSync(path, JSON.stringify({ ...state, task: "AF-013" }) + "\n");
        const r = spawnSync(process.execPath, ["scripts/verification/menus-manual.mjs", "prepare"], { cwd: repositoryRoot, encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
        assert.equal(r.status, 2); assert.equal(JSON.parse(r.stderr).status, "REJECTED");
        assert.equal((await fetch(state.healthUrl, { signal: AbortSignal.timeout(5000) })).status, 200);
        assert.equal((await applicationSessions(state.acceptanceId, "AF-020")).length, 1);
        writeFileSync(join(root, "wrong-task.json"), JSON.stringify({ exitCode: r.status, liveApiPreserved: true }) + "\n");
      } finally { writeFileSync(path, before); }
    });
    await t.test("exact owned PID shutdown closes main and its real pool without deleting fixture data", async () => {
      const stopped = run("stop"); assert.equal(stopped.status, "STOPPED"); assert.deepEqual(await applicationSessions(state.acceptanceId, "AF-020"), []); await assertPortAvailable(3656); state = undefined;
    });
  } finally { if (state) run("stop"); }
});
