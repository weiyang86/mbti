import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../database/connection.mjs";
import { applicationSessions } from "./readiness-support.mjs";
import { inspectApi } from "./readiness-manual.mjs";
import { prepareClientAuthManual, stopClientAuthManual } from "./client-auth-manual.mjs";

test("real customer main process, safe preparation idempotency and precise stop", { timeout: 45000 }, async t => {
  let state;
  const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
  try {
    await t.test("prepare owns the real main, synthetic member credentials and isolated DB", async () => {
      state = await prepareClientAuthManual(); assert.equal(state.status, "PREPARED"); assert.equal(state.task, "AF-025-A");
      const actual = inspectApi(state.pid); assert.equal(actual.command, process.execPath + " " + join(repositoryRoot, "apps/api/dist/main.js")); assert.equal(actual.cwd, join(repositoryRoot, "apps/api")); assert.equal((await applicationSessions(state.acceptanceId, "AF-025-A")).length, 1);
      const account = JSON.parse(readFileSync(state.customerPasswordFile)).accounts[0];
      const login = await fetch(state.loginUrl, { method: "POST", headers: { origin: state.requiredOrigin, "content-type": "application/json" }, body: JSON.stringify({ email: account.email, password: account.password }) });
      assert.equal(login.status, 200); const text = await login.text(); assert.ok(!text.includes(account.password)); assert.ok(!text.includes("accessToken"));
      const me = await fetch(state.meUrl, { headers: { cookie: login.headers.get("set-cookie").split(";")[0] } }); assert.equal(me.status, 200); assert.equal((await me.json()).data.id, account.id);
      assert.equal((await fetch(state.meUrl)).status, 401);
      // Recheck administrator main on this fresh current-schema control fixture;
      // never rewrite the old AF-013 manual lease to adopt a newer Schema.
      const adminPassword = JSON.parse(readFileSync(state.initialPasswordFile)).password;
      const admin = await fetch("http://127.0.0.1:3656/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "aij-admin", password: adminPassword }) });
      assert.equal(admin.status, 200); const adminToken = (await admin.json()).data.accessToken;
      assert.equal((await fetch("http://127.0.0.1:3656/api/auth/me", { headers: { authorization: "Bearer " + adminToken } })).status, 200);
    });
    await t.test("repeated prepare preserves PID, accounts and credential/key files", async () => {
      const files = [state.customerPasswordFile, state.clientKeyFile, state.initialPasswordFile, state.jwtKeyFile], before = files.map(hash);
      const repeated = await prepareClientAuthManual(); assert.equal(repeated.pid, state.pid); assert.equal(repeated.acceptanceId, state.acceptanceId); assert.deepEqual(files.map(hash), before);
    });
    await t.test("extra task arguments are rejected without changing the active owned process", () => {
      const result = spawnSync(process.execPath, ["scripts/verification/client-auth-manual.mjs", "prepare", "--task", "AF-025-B"], { cwd: repositoryRoot, encoding: "utf8" });
      assert.equal(result.status, 2); assert.ok(inspectApi(state.pid));
    });
    await t.test("recorded PID/PPID/CWD/command/birth are checked before SIGTERM and pool closure", async () => {
      const stopped = await stopClientAuthManual(); assert.equal(stopped.status, "STOPPED"); assert.equal(inspectApi(state.pid), undefined); assert.deepEqual(await applicationSessions(state.acceptanceId, "AF-025-A"), []);
    });
  } finally { if (state && inspectApi(state.pid)) await stopClientAuthManual(); }
});
