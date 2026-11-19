import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import {
  createSuccessEnvelope,
  isSuccessEnvelope
} from "@aij/contracts";
import {
  ClientRequestFailure,
  clientRequestMessage,
  createClientApi
} from "@aij/sdk";

test("contracts exports a stable success envelope and rejects malformed envelopes", async t => {
  const envelope = createSuccessEnvelope({ value: 7 });
  assert.deepEqual(envelope, { success: true, data: { value: 7 }, message: "ok" });
  assert.equal(isSuccessEnvelope(envelope), true);
  assert.equal(isSuccessEnvelope(createSuccessEnvelope(null, "done")), true);
  for (const invalid of [null, [], {}, { success: false, data: 1, message: "ok" },
    { success: true, message: "missing data" }, { success: true, data: 1, message: 2 }]) {
    assert.equal(isSuccessEnvelope(invalid), false, `reject ${JSON.stringify(invalid)}`);
  }

  await t.test("CommonJS and ESM resolve equivalent runtime exports", () => {
    const require = createRequire(import.meta.url);
    const cjs = require("@aij/contracts");
    assert.deepEqual(cjs.createSuccessEnvelope("cjs"), createSuccessEnvelope("cjs"));
    assert.equal(cjs.isSuccessEnvelope(envelope), true);
  });
});

test("SDK client preserves the existing credentialed request contract", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let observed;
  globalThis.fetch = async (url, options) => {
    observed = { url, options };
    return new globalThis.Response(JSON.stringify(createSuccessEnvelope({ workspaceId: "server-owned" })), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  const api = createClientApi(() => "http://127.0.0.1:4567/api");
  const result = await api("/client/workspaces/context", { method: "POST", body: "{}", workspaceId: "selector" });
  assert.deepEqual(result, { workspaceId: "server-owned" });
  assert.equal(observed.url, "http://127.0.0.1:4567/api/client/workspaces/context");
  assert.equal(observed.options.method, "POST");
  assert.equal(observed.options.credentials, "include");
  assert.equal(observed.options.cache, "no-store");
  assert.ok(observed.options.signal instanceof globalThis.AbortSignal);
  const headers = new globalThis.Headers(observed.options.headers);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("x-aij-workspace-id"), "selector");
});

test("SDK fails closed without a base URL and does not send a request", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("unexpected fetch"); };
  const api = createClientApi(() => undefined);
  await assert.rejects(api("/private"), error => error instanceof ClientRequestFailure && error.status === 503);
  assert.equal(called, false);
});

test("SDK preserves HTTP denial status and maps it to a safe user message", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new globalThis.Response(JSON.stringify({ success: false, error: { detail: "do not surface" } }), { status: 403 });
  const api = createClientApi(() => "http://127.0.0.1/api");
  await assert.rejects(api("/forbidden"), error => {
    assert.ok(error instanceof ClientRequestFailure);
    assert.equal(error.status, 403);
    assert.match(clientRequestMessage(error), /无权访问/);
    assert.doesNotMatch(clientRequestMessage(error), /do not surface/);
    return true;
  });
});

test("SDK rejects malformed or unsuccessful response envelopes", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const api = createClientApi(() => "http://127.0.0.1/api");
  for (const body of ["not-json", JSON.stringify({ success: true }), JSON.stringify({ success: false, data: 1, message: "bad" })]) {
    globalThis.fetch = async () => new globalThis.Response(body, { status: 200 });
    await assert.rejects(api("/invalid-envelope"), error => error instanceof ClientRequestFailure && error.status === 503);
  }
});

test("SDK keeps status-specific safe message mapping", () => {
  for (const [status, expected] of [[400, /检查输入/], [401, /重新登录/], [404, /刷新页面/], [409, /冲突/], [500, /稍后重试/]]) {
    assert.match(clientRequestMessage(new ClientRequestFailure(status)), expected);
  }
  assert.match(clientRequestMessage(new Error("secret")), /稍后重试/);
});
