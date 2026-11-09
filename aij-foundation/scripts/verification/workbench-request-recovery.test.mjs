import assert from "node:assert/strict";
import test from "node:test";
import { createAiClient, createAiRunRecoveryClient, createClientApi } from "../../packages/sdk/dist/index.mjs";
import { createWorkbench, parseRecoveryReference } from "../../apps/web/app/components/client-ai-workbench-state.mjs";

const permissions = ["workspace.ai.read", "workspace.ai.execute"];
const agent = { code: "general-text", name: "任务", revision: 1, inputFields: ["goal"], outputFormat: "text", capability: "text", maximumEstimatedCostNanos: "100" };
const bucket = "aij.client.ai.pending.v1:member-1";
const reference = (extra = {}) => ({ id: "run-1", agentCode: agent.code, status: "queued", budgetStatus: "reserved",
  createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-08T00:00:00.000Z", contentAvailable: true, ...extra });
const result = (extra = {}) => { const ref = { ...reference() }; delete ref.contentAvailable; return { ...ref, output: null, imageAssetId: null, failureCode: null, estimatedCostNanos: "100", ...extra }; };
const entry = (extra = {}) => ({ memberId: "member-1", workspaceId: "ws-a", agentCode: agent.code, key: "original-key", digest: "a".repeat(64), runId: null, status: "unconfirmed", ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const until = async fn => { for (let i = 0; i < 200 && !fn(); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(fn()); };
const memory = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, val) => data.set(key, val) }; };
const serialLock = () => { let tail = Promise.resolve(); return (_name, fn) => { const next = tail.then(fn); tail = next.catch(() => {}); return next; }; };

function harness(t, { route, saved = memory(), lock = serialLock(), grants = permissions, requestImage } = {}) {
  const calls = [], stores = [];
  let keys = 0, redirected = 0;
  const put = value => saved.setItem(bucket, JSON.stringify(value ? [value] : []));
  const journal = () => JSON.parse(saved.getItem(bucket) ?? "[]");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname.replace(/^\/api/, "") + new URL(url).search;
    const call = { path, options, workspaceId: options.headers.get("x-aij-workspace-id") }; calls.push(call);
    let data = await route?.(call);
    if (data === undefined) {
      if (path === "/client/auth/me") data = { id: "member-1" };
      else if (path.startsWith("/client/workspaces?")) data = { items: ["ws-a", "ws-b"].map(id => ({ workspace: { id, name: id }, role: { name: "成员" } })), total: 2 };
      else if (path === "/client/workspaces/context") data = { workspaceId: call.workspaceId, workspaceName: call.workspaceId, permissions: grants };
      else if (path === "/client/ai/agents") data = [agent];
      else if (path.startsWith("/client/ai/run-requests/")) data = reference();
      else data = result();
    }
    return data instanceof Response ? data : new Response(JSON.stringify({ success: true, data, message: "ok" }), { status: options.method === "POST" ? 202 : 200, headers: { "content-type": "application/json" } });
  });
  function mount() {
    const store = createWorkbench({ request: createClientApi(() => "http://test.invalid/api"), aiClientFactory: createAiClient,
      aiRecoveryClientFactory: createAiRunRecoveryClient, journalStorage: () => saved, withRecoveryLock: lock, requestImage,
      makeKey: () => `new-key-${++keys}`, schedule: () => 1, unschedule: () => {}, onUnauthorized: () => redirected++ });
    stores.push(store); return store;
  }
  t.after(() => stores.forEach(s => s.dispose()));
  return { mount, calls, put, journal, saved, keys: () => keys, redirected: () => redirected,
    posts: () => calls.filter(c => c.options.method === "POST"), lookups: () => calls.filter(c => c.path.startsWith("/client/ai/run-requests/")) };
}
const fill = store => store.setInput("goal", "PRIVATE ORIGINAL PROMPT");

// This suite imports compiled @aij/sdk modules; no SDK implementation is reproduced.
test("lost POST response -> unmount/reload -> explicit real SDK GET binds original ID without input or another POST", async t => {
  const h = harness(t, { route: ({ options }) => { if (options.method === "POST") throw new TypeError("admitted, response lost"); } });
  const first = h.mount(); await first.start(); fill(first); await first.submit();
  const key = h.journal()[0].key; first.dispose();
  const store = h.mount(); await store.start();
  assert.deepEqual(store.getSnapshot().input, {}); assert.equal(store.getSnapshot().recoveryNeedsInput, true);
  assert.equal(h.lookups().length, 0, "lookup is an explicit user action");
  await store.recoverRequest();
  assert.equal(h.posts().length, 1); assert.equal(h.keys(), 1);
  assert.equal(h.lookups()[0].path, `/client/ai/run-requests/${key}`);
  assert.equal(h.lookups()[0].options.method, "GET"); assert.equal(h.lookups()[0].options.body, undefined);
  assert.equal(h.lookups()[0].workspaceId, "ws-a"); assert.equal(h.lookups()[0].options.credentials, "include"); assert.equal(h.lookups()[0].options.cache, "no-store");
  assert.ok(h.lookups()[0].options.signal instanceof AbortSignal);
  assert.equal(store.getSnapshot().run, null); assert.equal(store.getSnapshot().recoveryReference.id, "run-1");
  assert.equal(h.journal()[0].runId, "run-1"); assert.equal(h.journal()[0].key, key);
  assert.deepEqual(Object.keys(h.journal()[0]).sort(), ["agentCode", "digest", "key", "memberId", "runId", "status", "workspaceId"]);
  assert.ok(!h.saved.getItem(bucket).includes("PRIVATE"));
});

test("404 while original POST is in flight preserves same-key barrier and permits only exact-input original-key confirmation", async t => {
  const admitted = deferred(); let postCount = 0;
  const h = harness(t, { route: ({ path, options }) => {
    if (options.method === "POST" && ++postCount === 1) return admitted.promise;
    if (path.startsWith("/client/ai/run-requests/")) return new Response("{}", { status: 404 });
  } });
  const first = h.mount(); await first.start(); fill(first); const pending = first.submit(); await until(() => h.posts().length === 1);
  const key = h.journal()[0].key; first.dispose();
  const store = h.mount(); await store.start(); await store.recoverRequest();
  assert.equal(store.getSnapshot().issue.status, 404); assert.match(store.getSnapshot().issue.message, /仍在处理/);
  assert.equal(h.journal()[0].key, key); store.newTask();
  store.setInput("goal", "different"); await store.submit(); assert.equal(h.posts().length, 1);
  fill(store); await store.submit(); assert.equal(h.posts().length, 2); assert.equal(h.keys(), 1);
  assert.equal(JSON.parse(h.posts()[1].options.body).idempotencyKey, key);
  admitted.resolve(result()); await pending;
  assert.equal(h.journal()[0].runId, "run-1"); assert.equal(first.getSnapshot().run, null);
});

for (const mode of ["workspace", "reload", "dispose"]) test(`late GET after ${mode} ignores even a transport that ignores abort`, async t => {
  const wait = deferred(); const h = harness(t, { route: ({ path }) => path.startsWith("/client/ai/run-requests/") ? wait.promise : undefined }); h.put(entry());
  const store = h.mount(); await store.start(); const pending = store.recoverRequest(); await until(() => h.lookups().length === 1);
  if (mode === "workspace") await store.selectWorkspace("ws-b"); else if (mode === "reload") await store.start(); else store.dispose();
  assert.equal(h.lookups()[0].options.signal.aborted, true);
  wait.resolve(reference({ status: "succeeded", budgetStatus: "settled" })); await pending;
  assert.equal(store.getSnapshot().run, null); assert.equal(store.getSnapshot().recoveryReference, null); assert.equal(h.journal()[0].key, "original-key");
});

for (const late of ["queued", "succeeded"]) test(`Web Lock compare/update: late ${late} metadata cannot overwrite/remove another page's newer key`, async t => {
  const wait = deferred(); let lookups = 0;
  const h = harness(t, { route: ({ path }) => path.startsWith("/client/ai/run-requests/") ? (++lookups === 1 ? wait.promise : reference({ status: "succeeded", budgetStatus: "settled" })) : undefined });
  h.put(entry()); const a = h.mount(), b = h.mount(); await a.start(); await b.start();
  const pending = a.recoverRequest(); await until(() => h.lookups().length === 1);
  await b.recoverRequest(); assert.deepEqual(h.journal(), []); b.newTask(); fill(b); await b.submit();
  const newer = h.journal()[0]; assert.notEqual(newer.key, "original-key");
  wait.resolve(reference(late === "succeeded" ? { status: late, budgetStatus: "settled" } : {})); await pending;
  assert.deepEqual(h.journal(), [newer]); assert.equal(a.getSnapshot().recovery.key, newer.key);
  assert.equal(a.getSnapshot().recoveryReference, null); assert.equal(a.getSnapshot().run, null);
});

test("absent journal cleared by another page never resurrects a stale local unconfirmed key", async t => {
  const h = harness(t, { route: ({ path }) => path.startsWith("/client/ai/run-requests/") ? reference({ status: "succeeded", budgetStatus: "settled" }) : undefined });
  h.put(entry()); const a = h.mount(), b = h.mount(); await a.start(); await b.start(); await b.recoverRequest();
  await a.start(); assert.equal(a.getSnapshot().recovery, null); assert.deepEqual(h.journal(), []);
  fill(a); await a.submit(); assert.equal(h.keys(), 1); assert.notEqual(h.journal()[0].key, "original-key");
});

for (const contentAvailable of [true, false]) test(`expired unknown/reserved stays protected (contentAvailable=${contentAvailable}) without retry, refund, output or new key`, async t => {
  const h = harness(t, { route: ({ path }) => path.startsWith("/client/ai/run-requests/") ? reference({ status: "unknown", contentAvailable }) : undefined });
  h.put(entry()); const store = h.mount(); await store.start(); await store.recoverRequest();
  assert.equal(store.getSnapshot().recovery.status, "unknown"); assert.equal(store.getSnapshot().run, null);
  store.newTask(); fill(store); await store.submit(); assert.equal(h.posts().length, 0); assert.equal(h.keys(), 0);
  if (!contentAvailable) { const before = h.calls.length; await store.readRun(); assert.equal(h.calls.length, before); }
  assert.equal(h.journal()[0].key, "original-key");
});

for (const status of ["succeeded", "failed"]) test(`expired safe ${status} metadata exposes explicit new-task path without fabricating full output`, async t => {
  const h = harness(t, { route: ({ path }) => path.startsWith("/client/ai/run-requests/") ? reference({ status, budgetStatus: status === "succeeded" ? "settled" : "released", contentAvailable: false }) : undefined });
  h.put(entry()); const store = h.mount(); await store.start(); await store.recoverRequest();
  assert.equal(store.getSnapshot().recovery, null); assert.equal(store.getSnapshot().run, null);
  assert.equal(store.getSnapshot().contentUnavailable, true); assert.deepEqual(h.journal(), []);
  fill(store); await store.submit(); assert.equal(h.posts().length, 0, "must explicitly start new");
  const before = h.calls.length; await store.readRun("run-1"); assert.equal(h.calls.length, before);
  store.newTask(); assert.equal(store.getSnapshot().recoveryReference, null); fill(store); await store.submit(); assert.equal(h.posts().length, 1);
});

test("available metadata requires separate authorized full-result read; unavailable projection clears even already cached output", async t => {
  let available = true;
  const h = harness(t, { route: ({ path }) => path.startsWith("/client/ai/run-requests/") ? reference({ contentAvailable: available }) : path.startsWith("/client/ai/runs/") ? result({ output: "PRIVATE CACHED CONTENT" }) : undefined });
  h.put(entry()); const store = h.mount(); await store.start(); await store.recoverRequest();
  assert.equal(store.getSnapshot().run, null); await store.readRun(); assert.equal(store.getSnapshot().run.output, "PRIVATE CACHED CONTENT");
  available = false; await store.recoverRequest(); assert.equal(store.getSnapshot().run, null); assert.equal(store.getSnapshot().imageBlob, null);
  assert.equal(store.getSnapshot().contentUnavailable, true); const before = h.calls.length; await store.readRun(); await store.readImage(); assert.equal(h.calls.length, before);
});

test("available settled reference loads actual successful result, never a synthetic output placeholder", async t => {
  const h = harness(t, { route: ({ path }) => path.startsWith("/client/ai/run-requests/") ? reference({ status: "succeeded", budgetStatus: "settled" }) : path.startsWith("/client/ai/runs/") ? result({ status: "succeeded", budgetStatus: "settled", output: "ACTUAL FULL RESULT" }) : undefined });
  h.put(entry()); const store = h.mount(); await store.start(); await store.recoverRequest(); assert.equal(store.getSnapshot().run, null);
  await store.readRun(); assert.equal(store.getSnapshot().run.output, "ACTUAL FULL RESULT"); assert.equal(h.posts().length, 0);
});

const malformed = [null, {}, reference({ output: "forged" }), reference({ id: "../bad" }), reference({ agentCode: "other-agent" }), reference({ contentAvailable: "true" }),
  reference({ createdAt: "yesterday" }), reference({ expiresAt: "2025-01-01T00:00:00.000Z" }), reference({ createdAt: "2026-02-30T00:00:00.000Z" }),
  reference({ status: "succeeded" }), reference({ status: "failed", budgetStatus: "reserved" }), reference({ status: "unknown", budgetStatus: "released" }), reference({ status: "invented" })];
test("malformed projection, identity, status, budget and dates never bind or clear journal", async t => {
  for (const [i, value] of malformed.entries()) await t.test(String(i), async child => {
    const h = harness(child, { route: ({ path }) => path.startsWith("/client/ai/run-requests/") ? new Response(JSON.stringify({ success: true, data: value, message: "ok" }), { headers: { "content-type": "application/json" } }) : undefined });
    h.put(entry()); const store = h.mount(); await store.start(); await store.recoverRequest();
    assert.equal(store.getSnapshot().issue.kind, "invalid-response"); assert.equal(store.getSnapshot().recoveryReference, null);
    assert.deepEqual(h.journal(), [entry()]); store.newTask(); assert.equal(h.posts().length, 0);
  });
  assert.throws(() => parseRecoveryReference(reference(), { runId: "wrong-id" }));
});

for (const status of [401, 403]) test(`${status} clears private state and authorization while journal protection survives revalidation`, async t => {
  const h = harness(t, { route: ({ path }) => path.startsWith("/client/ai/run-requests/") ? new Response("{}", { status }) : undefined });
  h.put(entry()); const store = h.mount(); await store.start(); fill(store); await store.recoverRequest();
  assert.equal(store.getSnapshot().context, null); assert.deepEqual(store.getSnapshot().input, {}); assert.equal(store.getSnapshot().run, null);
  assert.equal(store.getSnapshot().recoveryReference, null); assert.equal(h.redirected(), status === 401 ? 1 : 0);
  assert.deepEqual(h.journal(), [entry()]); await store.submit(); assert.equal(h.posts().length, 0);
  await store.start(); assert.equal(store.getSnapshot().recovery.key, "original-key"); assert.deepEqual(store.getSnapshot().input, {});
});

test("recovery requires server read grant and never reads unverified or foreign member/space journal", async t => {
  const h = harness(t, { grants: ["workspace.ai.execute"] }); h.put(entry()); const store = h.mount(); await store.start(); await store.recoverRequest(); assert.equal(h.lookups().length, 0);
  await store.selectWorkspace("foreign"); await store.recoverRequest(); assert.equal(h.lookups().length, 0); assert.equal(store.getSnapshot().context, null);
});

for (const mode of ["read", "write", "lock", "corrupt"]) test(`recovery ${mode} failure keeps original protection and blocks new submissions`, async t => {
  const data = memory(); data.setItem(bucket, JSON.stringify([entry()])); let fail = false;
  const saved = { getItem: key => { if (fail && mode === "read") throw new Error("denied"); return fail && mode === "corrupt" ? "{" : data.getItem(key); },
    setItem: (key, value) => { if (fail && mode === "write") throw new Error("denied"); data.setItem(key, value); } };
  const h = harness(t, { saved, lock: (_name, fn) => { if (fail && mode === "lock") throw new Error("denied"); return fn(); } });
  const store = h.mount(); await store.start(); fail = true; await store.recoverRequest();
  assert.equal(store.getSnapshot().recoveryBlocked, true); assert.equal(store.getSnapshot().issue.kind, "recovery"); assert.equal(store.getSnapshot().recoveryReference, null);
  assert.deepEqual(JSON.parse(data.getItem(bucket)), [entry()]); store.newTask(); fill(store); await store.submit(); assert.equal(h.posts().length, 0);
});

for (const response of ["submit", "read"]) test(`late full ${response} response cannot clear a newer page's pending key or display its stale run`, async t => {
  const wait = deferred(); let first = true;
  const h = harness(t, { route: ({ path, options }) => {
    if (first && (response === "submit" ? options.method === "POST" : path.startsWith("/client/ai/runs/"))) { first = false; return wait.promise; }
  } });
  if (response === "read") h.put(entry({ runId: "run-1", status: "queued" }));
  const a = h.mount(); await a.start(); fill(a);
  const pending = response === "submit" ? a.submit() : a.readRun();
  await until(() => h.calls.some(c => response === "submit" ? c.options.method === "POST" : c.path.startsWith("/client/ai/runs/")));
  const newer = entry({ key: "newer-pending-key", digest: "b".repeat(64) }); h.put(newer);
  wait.resolve(result({ status: "succeeded", budgetStatus: "settled", output: "STALE" })); await pending;
  assert.deepEqual(h.journal(), [newer]); assert.equal(a.getSnapshot().recovery.key, newer.key); assert.equal(a.getSnapshot().run, null);
});

test("lookup run ID must agree with an already bound journal ID", async t => {
  const h = harness(t); h.put(entry({ runId: "bound-run", status: "unknown" }));
  const store = h.mount(); await store.start(); await store.recoverRequest();
  assert.equal(store.getSnapshot().issue.kind, "invalid-response"); assert.equal(h.journal()[0].runId, "bound-run");
  assert.equal(store.getSnapshot().recoveryReference, null);
});

test("lock failure during compare/update after a real GET cannot bind metadata or clear protection", async t => {
  let lockCalls = 0;
  const h = harness(t, { lock: (_name, fn) => { if (++lockCalls === 2) throw new Error("lock revoked"); return fn(); } }); h.put(entry());
  const store = h.mount(); await store.start(); await store.recoverRequest();
  assert.equal(h.lookups().length, 1); assert.equal(store.getSnapshot().recoveryBlocked, true);
  assert.equal(store.getSnapshot().recoveryReference, null); assert.deepEqual(h.journal(), [entry()]);
});

test("scope switch while waiting for the compare/update Web Lock prevents its callback from mutating storage", async t => {
  const gate = deferred(); let lockCalls = 0, waiting = false;
  const h = harness(t, { lock: (_name, fn) => ++lockCalls === 2 ? (waiting = true, gate.promise.then(fn)) : fn() }); h.put(entry());
  const store = h.mount(); await store.start(); const pending = store.recoverRequest(); await until(() => waiting);
  await store.selectWorkspace("ws-b"); gate.resolve(); await pending;
  assert.deepEqual(h.journal(), [entry()]); assert.equal(store.getSnapshot().workspaceId, "ws-b"); assert.equal(store.getSnapshot().recoveryReference, null);
});

for (const status of [401, 403]) test(`stale lookup ${status} cannot revoke a newly verified scope`, async t => {
  const wait = deferred(); const h = harness(t, { route: ({ path }) => path.startsWith("/client/ai/run-requests/") ? wait.promise : undefined }); h.put(entry());
  const store = h.mount(); await store.start(); const pending = store.recoverRequest(); await until(() => h.lookups().length === 1);
  await store.selectWorkspace("ws-b"); wait.resolve(new Response("{}", { status })); await pending;
  assert.equal(store.getSnapshot().context.workspaceId, "ws-b"); assert.equal(store.getSnapshot().issue, null); assert.equal(h.redirected(), 0);
  assert.deepEqual(h.journal(), [entry()]);
});

test("unavailable recovery projection purges a cached private image and cannot fetch it again", async t => {
  let images = 0;
  const h = harness(t, { requestImage: async () => { images++; return new Blob(["PRIVATE"], { type: "image/png" }); }, route: ({ path }) =>
    path.startsWith("/client/ai/run-requests/") ? reference({ status: "succeeded", budgetStatus: "settled", contentAvailable: false }) :
      path.startsWith("/client/ai/runs/") ? result({ status: "succeeded", budgetStatus: "settled", output: { imageCount: 1 }, imageAssetId: "image-1" }) : undefined });
  h.put(entry()); const store = h.mount(); await store.start();
  await store.readRun("run-1"); await store.readImage(); assert.ok(store.getSnapshot().imageBlob); assert.equal(images, 1);
  await store.recoverRequest(); assert.equal(store.getSnapshot().imageBlob, null); assert.equal(store.getSnapshot().run, null);
  await store.readImage(); await store.readRun(); assert.equal(images, 1); assert.equal(store.getSnapshot().contentUnavailable, true);
});
