import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import { prepareUi1, stopUi1, expireUi1 } from "./ui1-manual.mjs";
import { stopAuthManual } from "./auth-manual.mjs";
import { withDatabase, readDatabaseEnvironment } from "../database/connection.mjs";
import { applicationSessions } from "./readiness-support.mjs";
import { inspectApi } from "./readiness-manual.mjs";

test("UI1 integrated production host handoff uses persistent sessions and owned services", { timeout: 90000 }, async t => {
  let state, cookie, csrf;
  const task = "AF-029", origin = "http://localhost:3655", secrets = [];
  const query = op => withDatabase("test", readDatabaseEnvironment("test", process.env, state.acceptanceId), op, { acceptanceId: state.acceptanceId });
  async function request(path, status, options = {}) {
    const response = await fetch("http://127.0.0.1:3656/api/" + path, { ...options, signal: AbortSignal.timeout(8000) });
    assert.equal(response.status, status, path); const body = await response.json();
    for (const value of secrets) assert.ok(!JSON.stringify(body).includes(value), "No credential in response");
    return { data: body.data, headers: response.headers };
  }
  async function login() {
    const account = JSON.parse(readFileSync(state.initialPasswordFile)); secrets.push(account.password);
    const response = await request("auth/browser-login", 200, { method: "POST", headers: { origin, "x-aij-client": "web", "content-type": "application/json" }, body: JSON.stringify({ username: account.username, password: account.password }) });
    assert.ok(!("accessToken" in response.data)); cookie = response.headers.get("set-cookie").split(";", 1)[0]; secrets.push(cookie.split("=")[1]);
    csrf = (await request("auth/session", 200, { headers: { cookie } })).data.csrfToken;
  }
  try {
    await t.test("occupied Web port rejects preparation and leaves its existing listener alive", async () => {
      const server = createServer((_, response) => response.end("owned conflict fixture"));
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(3655, "127.0.0.1", resolve); });
      try { await assert.rejects(prepareUi1(task)); assert.equal(await (await fetch("http://127.0.0.1:3655")).text(), "owned conflict fixture"); }
      finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    });
    state = await prepareUi1(task);
    await t.test("built pages serve while anonymous session and bad credentials fail closed", async () => {
      for (const path of ["/login", "/admin"]) { const response = await fetch(origin + path); assert.equal(response.status, 200); assert.ok(!(await response.text()).includes("aij-admin")); }
      await request("ready", 200); await request("auth/session", 401);
      await request("auth/browser-login", 401, { method: "POST", headers: { origin, "x-aij-client": "web", "content-type": "application/json" }, body: JSON.stringify({ username: "aij-admin", password: "synthetic-wrong-password" }) });
      await login(); assert.equal((await request("auth/session", 200, { headers: { cookie } })).data.user.username, "aij-admin");
    });
    await t.test("current session persists with no token value, unsafe logout is rejected and audited logout invalidates", async () => {
      await query(async client => { const rows = (await client.query("SELECT namespace,transport,revoked_at FROM public.admin_auth_session WHERE revoked_at IS NULL AND expires_at>NOW()" )).rows; assert.ok(rows.some(row => row.namespace === "aij-foundation:test" && row.transport === "cookie")); });
      await request("auth/logout", 403, { method: "POST", headers: { cookie, origin } });
      const response = await request("auth/logout", 200, { method: "POST", headers: { cookie, origin, "x-aij-csrf": csrf } }); assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
      await request("auth/session", 401, { headers: { cookie } });
      await query(async client => { const rows = (await client.query("SELECT action,request_summary FROM public.audit_log WHERE module='auth' AND action='logout'" )).rows; assert.ok(rows.length > 0); for (const secret of [...secrets, csrf]) assert.ok(!JSON.stringify(rows).includes(secret)); });
    });
    await t.test("explicit expiration affects only owned synthetic admin sessions and returns 401", async () => {
      await login(); const result = await expireUi1(task); assert.ok(result.expiredSyntheticBrowserSessions >= 1); assert.equal(result.database, state.database);
      await request("auth/session", 401, { headers: { cookie } });
    });
    await t.test("owned API restart keeps Web, account, credential file and valid database session", async () => {
      await login(); const old = { ...state }, digest = createHash("sha256").update(readFileSync(state.initialPasswordFile)).digest("hex");
      await stopAuthManual(task); assert.equal(inspectApi(old.apiPid), undefined); assert.deepEqual(await applicationSessions(state.acceptanceId, task), []);
      state = await prepareUi1(task); assert.notEqual(state.apiPid, old.apiPid); assert.equal(state.process.pid, old.process.pid); assert.equal(state.database, old.database);
      assert.equal(createHash("sha256").update(readFileSync(state.initialPasswordFile)).digest("hex"), digest);
      await request("auth/session", 200, { headers: { cookie } });
      const again = await prepareUi1(task); assert.equal(again.apiPid, state.apiPid); assert.equal(again.process.pid, state.process.pid);
    });
    await t.test("exactly owned Web/API stop leaves zero pools and retains synthetic data", async () => {
      await stopUi1(task); assert.equal(inspectApi(state.process.pid), undefined); assert.equal(inspectApi(state.apiPid), undefined); assert.deepEqual(await applicationSessions(state.acceptanceId, task), []);
      await query(async client => assert.equal((await client.query("SELECT count(*)::int AS n FROM public.sys_user WHERE username='aij-admin'" )).rows[0].n, 1)); state = undefined;
    });
  } finally { if (state) await stopUi1(task); }
});
