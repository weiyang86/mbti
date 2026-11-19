import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readDatabaseEnvironment, withDatabase } from "../database/connection.mjs";

export const origin = "http://localhost:3655";
export function queryFor(state) { return operation => withDatabase("test", readDatabaseEnvironment("test", process.env, state.acceptanceId), operation, { acceptanceId: state.acceptanceId }); }
export async function browserSession(state, username = "aij-admin") {
  const initial = JSON.parse(readFileSync(state.initialPasswordFile));
  const manual = JSON.parse(readFileSync(state.apiState));
  const credentials = username === initial.username ? initial : JSON.parse(readFileSync(manual.accounts[0].initialPasswordFile)).accounts.find(a => a.username === username);
  assert.ok(credentials);
  const login = await fetch("http://127.0.0.1:3656/api/auth/browser-login", { method: "POST", headers: { "content-type": "application/json", origin, "x-aij-client": "web" }, body: JSON.stringify({ username, password: credentials.password }), signal: AbortSignal.timeout(8000) });
  assert.equal(login.status, 200, "Synthetic cookie login"); const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const session = await fetch("http://127.0.0.1:3656/api/auth/session", { headers: { cookie }, signal: AbortSignal.timeout(8000) }); assert.equal(session.status, 200);
  const { data } = await session.json();
  return { cookie, csrf: data.csrfToken, user: data.user };
}
export async function call(session, path, status = 200, method = "GET", body) {
  const response = await fetch("http://127.0.0.1:3656/api" + path, { method, headers: { "content-type": "application/json", origin, "x-correlation-id": "ui2-real-http", ...(session ? { cookie: session.cookie, "x-aij-csrf": session.csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  assert.equal(response.status, status, method + " " + path); const text = await response.text(); assert.ok(!/passwordHash|password_hash|\$2[aby]\$|accessToken/.test(text), "No credential fields in management responses");
  return JSON.parse(text).data;
}
