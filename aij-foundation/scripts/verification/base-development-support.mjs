import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertRepository, paths, profile, readLocalState } from "../base-development/config.mjs";
import { inspectResources, localDocker } from "../base-development/docker.mjs";
import { withBaseDatabase } from "../base-development/database.mjs";
import { hasBuild } from "../base-development/build.mjs";

export const baseOrigin = "http://127.0.0.1:3855";
export const baseApi = "http://127.0.0.1:3856/api";
export async function basePreflight() {
  assertRepository();
  const state = readLocalState();
  assert.equal(state.owner.initialized, true, "Explicit persistent Base initialization is required");
  assert.equal(inspectResources(localDocker(state.owner), state.owner)?.State.Running, true);
  assert.equal(hasBuild(state.owner), true, "Isolated API/Web builds must be ready");
  await withBaseDatabase(state.values, async () => {});
  return { project: profile.project, environment: profile.environment, port: profile.dbPort, isolated: true };
}
export async function baseSession(credentials = JSON.parse(readFileSync(paths.credentials, "utf8"))) {
  const response = await fetch(baseApi + "/auth/browser-login", {
    method: "POST", headers: { "content-type": "application/json", origin: baseOrigin, "x-aij-client": "web" },
    body: JSON.stringify({ username: credentials.username, password: credentials.password }), signal: AbortSignal.timeout(8000)
  });
  assert.equal(response.status, 200, "Base browser login with the local initial credential");
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie, "Successful login must establish the independent Base cookie");
  const session = await fetch(baseApi + "/auth/session", { headers: { cookie }, signal: AbortSignal.timeout(8000) });
  assert.equal(session.status, 200);
  const { data } = await session.json();
  assert.ok(data.csrfToken);
  return { cookie, csrf: data.csrfToken, user: data.user };
}
export async function baseCall(session, path, status = 200, method = "GET", body) {
  const response = await fetch(baseApi + path, {
    method, headers: { "content-type": "application/json", origin: baseOrigin, "x-correlation-id": "af134-base-verification",
      ...(session ? { cookie: session.cookie, "x-aij-csrf": session.csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000)
  });
  assert.equal(response.status, status, method + " " + path);
  const text = await response.text();
  assert.ok(!/passwordHash|password_hash|\$2[aby]\$|accessToken/.test(text), "Management responses contain no credential fields");
  return JSON.parse(text).data;
}
