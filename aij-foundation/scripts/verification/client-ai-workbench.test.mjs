import assert from "node:assert/strict";
import test from "node:test";
import * as sdk from "../../packages/sdk/dist/index.mjs";
import { createWorkbench, describeRun, parseAgents, parseRun } from "../../apps/web/app/components/client-ai-workbench-state.mjs";

const EXECUTE = "workspace.ai.execute", READ = "workspace.ai.read";
const permissions = [EXECUTE, READ];
const agent = { code: "general-task", name: "通用任务", revision: 1, inputFields: ["Goal", "context"], outputFormat: "text", capability: "text", maximumEstimatedCostNanos: "1000" };
const run = (status = "queued", extra = {}) => ({ id: "run-1", agentCode: agent.code, status, output: status === "succeeded" ? "完成" : null,
  failureCode: null, estimatedCostNanos: "1000", budgetStatus: status === "succeeded" ? "settled" : status === "failed" ? "released" : "reserved",
  imageAssetId: null, createdAt: "2026-11-05T00:00:00.000Z", expiresAt: "2026-11-12T00:00:00.000Z", ...extra });
const workspace = id => ({ workspace: { id, name: `空间 ${id}` }, role: { name: "成员" } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
const until = async predicate => { for (let i = 0; i < 1000 && !predicate(); i += 1) await flush(); assert.ok(predicate(), "expected asynchronous request to start"); };
const storage = () => { const data = new Map(); return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };

function harness(t, { route, grants = permissions, agents = [agent], maxPolls = 120, requestImage, journalStorage, withRecoveryLock } = {}) {
  const calls = [], timers = new Map();
  let nextTimer = 0, unauthorized = 0, keys = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname.replace(/^\/api/, "") + new URL(url).search;
    const call = { path, options, workspaceId: options.headers.get("x-aij-workspace-id") };
    calls.push(call);
    let data = route ? await route(call) : undefined;
    if (data === undefined) {
      if (path === "/client/auth/me") data = { id: "member-1", nickname: "客户" };
      else if (path.startsWith("/client/workspaces?")) data = { items: [workspace("ws-a"), workspace("ws-b")], total: 2 };
      else if (path === "/client/workspaces/context") data = { workspaceId: call.workspaceId, workspaceName: `空间 ${call.workspaceId}`, permissions: grants };
      else if (path === "/client/ai/agents") data = agents;
      else if (options.method === "POST") data = run();
      else data = run("succeeded");
    }
    if (data instanceof Response) return data;
    return new Response(JSON.stringify({ success: true, data, message: "ok" }), { status: options.method === "POST" ? 202 : 200, headers: { "content-type": "application/json" } });
  });
  const store = createWorkbench({ request: sdk.createClientApi(() => "http://test.invalid/api"), aiClientFactory: sdk.createAiClient, aiRecoveryClientFactory: sdk.createAiRunRecoveryClient,
    requestImage, maxPolls, journalStorage, withRecoveryLock, onUnauthorized: () => { unauthorized += 1; }, makeKey: () => `request-${++keys}`,
    schedule(fn) { const timer = ++nextTimer; timers.set(timer, fn); return timer; }, unschedule(timer) { timers.delete(timer); } });
  t.after(() => store.dispose());
  return { store, calls, timers, unauthorized: () => unauthorized, keys: () => keys,
    async tick() { const [timer, fn] = timers.entries().next().value ?? []; assert.ok(fn, "poll timer expected"); timers.delete(timer); fn(); await flush(); } };
}
const fill = store => { store.setInput("Goal", "整理计划"); store.setInput("context", "合成输入"); };
const posts = h => h.calls.filter(call => call.options.method === "POST");

test("real SDK transport: authorized context, exact Agent fields, Cookie and workspace selector, queued to running to text result", async t => {
  let reads = 0;
  const h = harness(t, { route: ({ path }) => path === "/client/ai/runs/run-1" ? run(++reads === 1 ? "running" : "succeeded") : undefined });
  await h.store.start("ws-b");
  assert.equal(h.store.getSnapshot().workspaceId, "ws-b");
  assert.equal(h.store.getSnapshot().phase, "ready");
  fill(h.store); await h.store.submit();
  assert.equal(h.store.getSnapshot().run.status, "queued");
  assert.deepEqual(JSON.parse(posts(h)[0].options.body), { input: { Goal: "整理计划", context: "合成输入" }, idempotencyKey: "request-1" });
  assert.equal(posts(h)[0].workspaceId, "ws-b");
  for (const call of h.calls) {
    assert.equal(call.options.credentials, "include"); assert.equal(call.options.cache, "no-store");
    assert.ok(call.options.signal instanceof AbortSignal);
  }
  await h.tick(); assert.equal(h.store.getSnapshot().run.status, "running");
  await h.tick(); assert.equal(h.store.getSnapshot().run.output, "完成");
  assert.equal(h.timers.size, 0); assert.equal(h.store.getSnapshot().polling, false);
});

test("workspaces paginate; untrusted URL ID only falls back to a listed membership", async t => {
  const h = harness(t, { route: ({ path }) => path === "/client/workspaces?page=1&pageSize=100" ? { total: 2, items: [workspace("ws-a")] }
    : path === "/client/workspaces?page=2&pageSize=100" ? { total: 2, items: [workspace("ws-b")] } : undefined });
  await h.store.start("foreign");
  assert.equal(h.store.getSnapshot().workspaceId, "ws-a");
  const count = h.calls.length;
  await h.store.selectWorkspace("foreign");
  assert.equal(h.calls.length, count); assert.equal(h.store.getSnapshot().issue.kind, "forbidden");
  assert.equal(h.store.getSnapshot().context, null);
});

test("context binding mismatch fails closed and never loads Agents", async t => {
  const h = harness(t, { route: ({ path }) => path === "/client/workspaces/context" ? { workspaceId: "foreign", workspaceName: "其他空间", permissions } : undefined });
  await h.store.start();
  assert.equal(h.store.getSnapshot().issue.kind, "invalid-response");
  assert.equal(h.store.getSnapshot().context, null);
  assert.ok(!h.calls.some(call => call.path === "/client/ai/agents"));
});

test("read-only grants never request Agents or submit, but can read their existing run", async t => {
  const h = harness(t, { grants: [READ] }); await h.store.start();
  await h.store.submit(); await h.store.readRun("run-1");
  assert.equal(posts(h).length, 0); assert.ok(!h.calls.some(call => call.path === "/client/ai/agents"));
  assert.equal(h.store.getSnapshot().run.status, "succeeded");
});

test("execute-only grants accept submit response without unauthorized polling or reads", async t => {
  const h = harness(t, { grants: [EXECUTE] }); await h.store.start(); fill(h.store);
  await h.store.submit(); await h.store.readRun();
  assert.equal(h.store.getSnapshot().run.status, "queued"); assert.equal(h.timers.size, 0);
  assert.ok(!h.calls.some(call => call.path.startsWith("/client/ai/runs/")));
});

test("no AI grants means no AI request even through direct state actions", async t => {
  const h = harness(t, { grants: [] }); await h.store.start();
  h.store.selectAgent(agent.code); fill(h.store); await h.store.submit(); await h.store.readRun("run-1");
  assert.ok(!h.calls.some(call => call.path.startsWith("/client/ai/")));
});

test("empty authorized Agent catalog is distinct from 503 and malformed catalog", async t => {
  const h = harness(t, { agents: [] }); await h.store.start();
  assert.equal(h.store.getSnapshot().agents.length, 0); assert.equal(h.store.getSnapshot().issue, null);
});

test("no memberships is a ready empty state, without invented personal space or AI access", async t => {
  const h = harness(t, { route: ({ path }) => path.startsWith("/client/workspaces?") ? { total: 0, items: [] } : undefined });
  await h.store.start("foreign");
  assert.equal(h.store.getSnapshot().phase, "ready"); assert.equal(h.store.getSnapshot().issue, null);
  assert.equal(h.store.getSnapshot().workspaceId, ""); assert.equal(h.store.getSnapshot().context, null);
  assert.ok(!h.calls.some(call => call.path === "/client/workspaces/context" || call.path.startsWith("/client/ai/")));
});

test("catalog configuration/strategy 503 stays service unavailable and can recover", async t => {
  let down = true;
  const h = harness(t, { route: ({ path }) => path === "/client/ai/agents" && down ? new Response("{}", { status: 503 }) : undefined });
  await h.store.start(); assert.equal(h.store.getSnapshot().issue.kind, "service-unavailable");
  assert.match(h.store.getSnapshot().issue.message, /执行策略/);
  down = false; await h.store.selectWorkspace("ws-a");
  assert.equal(h.store.getSnapshot().issue, null); assert.equal(h.store.getSnapshot().agents.length, 1);
});

test("duplicate clicks share one in-flight submit; uncertain network result keeps original key and input for confirmation", async t => {
  const waiting = deferred(); let first = true;
  const h = harness(t, { route: ({ options }) => options.method === "POST" && first ? (first = false, waiting.promise) : undefined });
  await h.store.start(); fill(h.store);
  const pending = h.store.submit(); await h.store.submit();
  await until(() => posts(h).length > 0);
  assert.equal(posts(h).length, 1);
  waiting.reject(new TypeError("offline")); await pending;
  assert.equal(h.store.getSnapshot().submissionUnconfirmed, true);
  h.store.setInput("Goal", "changed"); h.store.selectAgent(agent.code);
  await h.store.submit();
  assert.deepEqual(posts(h).map(call => JSON.parse(call.options.body)), [JSON.parse(posts(h)[0].options.body), JSON.parse(posts(h)[0].options.body)]);
  assert.equal(h.keys(), 1); assert.equal(h.store.getSnapshot().run.status, "queued");
  await h.store.submit(); assert.equal(posts(h).length, 2);
});

test("HTTP 503 after submit is unconfirmed; retry confirms with same idempotency key", async t => {
  let first = true;
  const h = harness(t, { route: ({ options }) => options.method === "POST" && first ? (first = false, new Response("{}", { status: 503 })) : undefined });
  await h.store.start(); fill(h.store); await h.store.submit();
  assert.equal(h.store.getSnapshot().issue.kind, "service-unavailable"); assert.equal(h.store.getSnapshot().submissionUnconfirmed, true);
  await h.store.submit(); assert.equal(h.keys(), 1); assert.equal(h.store.getSnapshot().submissionUnconfirmed, false);
});

test("invalid input is rejected before POST; correcting a server 400 input permits submission", async t => {
  let reject = true;
  const h = harness(t, { route: ({ options }) => options.method === "POST" && reject ? (reject = false, new Response("{}", { status: 400 })) : undefined });
  await h.store.start(); h.store.setInput("Goal", "  "); await h.store.submit(); assert.equal(posts(h).length, 0);
  fill(h.store); await h.store.submit(); assert.equal(h.store.getSnapshot().issue.kind, "input");
  h.store.setInput("context", "更正参数"); await h.store.submit(); assert.equal(posts(h).length, 2); assert.equal(h.keys(), 2);
});

test("unknown is terminal uncertainty: never poll, resubmit, or reset it as failed", async t => {
  const h = harness(t, { route: ({ options }) => options.method === "POST" ? run("unknown", { failureCode: "UPSTREAM_RESULT_UNCERTAIN" }) : undefined });
  await h.store.start(); fill(h.store); await h.store.submit();
  const display = describeRun(h.store.getSnapshot().run);
  assert.equal(display.label, "结果未知"); assert.match(display.message, /上游可能已执行/);
  h.store.newTask(); h.store.selectAgent(agent.code); await h.store.submit();
  assert.equal(h.store.getSnapshot().run.status, "unknown"); assert.equal(h.timers.size, 0); assert.equal(posts(h).length, 1);
  await h.store.readRun(); assert.equal(h.store.getSnapshot().run.status, "succeeded");
});

test("failed is distinct from unknown and explicit new task receives a fresh key", async t => {
  const h = harness(t, { route: ({ options }) => options.method === "POST" ? run("failed", { failureCode: "AI_EXECUTION_DENIED" }) : undefined });
  await h.store.start(); fill(h.store); await h.store.submit();
  assert.equal(describeRun(h.store.getSnapshot().run).label, "执行失败"); assert.equal(h.timers.size, 0);
  h.store.newTask(); await h.store.submit(); assert.equal(h.keys(), 2); assert.equal(posts(h).length, 2);
});

test("workspace switch aborts delayed context; even transport ignoring abort cannot contaminate new scope", async t => {
  const waiting = deferred();
  const h = harness(t, { route: ({ path, workspaceId }) => path === "/client/workspaces/context" && workspaceId === "ws-a" ? waiting.promise : undefined });
  const pending = h.store.start(); await flush();
  const old = h.calls.find(call => call.path === "/client/workspaces/context");
  await h.store.selectWorkspace("ws-b"); assert.equal(old.options.signal.aborted, true);
  waiting.resolve({ workspaceId: "ws-a", workspaceName: "旧空间", permissions }); await pending;
  assert.equal(h.store.getSnapshot().context.workspaceId, "ws-b");
  assert.ok(!h.calls.some(call => call.path === "/client/ai/agents" && call.workspaceId === "ws-a"));
});

test("delayed submit success after scope switch is discarded and all form/run state is cleared", async t => {
  const waiting = deferred();
  const h = harness(t, { route: ({ options }) => options.method === "POST" ? waiting.promise : undefined });
  await h.store.start(); fill(h.store); const pending = h.store.submit();
  await until(() => posts(h).length > 0);
  await h.store.selectWorkspace("ws-b"); assert.equal(posts(h)[0].options.signal.aborted, true);
  waiting.resolve(run()); await pending;
  assert.equal(h.store.getSnapshot().run, null); assert.deepEqual(h.store.getSnapshot().input, {});
  assert.equal(h.store.getSnapshot().submitting, false); assert.equal(h.timers.size, 0);
});

test("late Agent 401 from an old workspace neither redirects nor removes the current grant", async t => {
  const waiting = deferred();
  const h = harness(t, { route: ({ path, workspaceId }) => path === "/client/ai/agents" && workspaceId === "ws-a" ? waiting.promise : undefined });
  const pending = h.store.start(); await flush();
  const old = h.calls.find(call => call.path === "/client/ai/agents");
  await h.store.selectWorkspace("ws-b"); assert.equal(old.options.signal.aborted, true);
  waiting.resolve(new Response("{}", { status: 401 })); await pending;
  assert.equal(h.unauthorized(), 0); assert.equal(h.store.getSnapshot().workspaceId, "ws-b");
  assert.equal(h.store.getSnapshot().agents.length, 1); assert.equal(h.store.getSnapshot().issue, null);
});

test("old poll response and cancelled timer cannot mutate a new workspace", async t => {
  const waiting = deferred();
  const h = harness(t, { route: ({ path }) => path === "/client/ai/runs/run-1" ? waiting.promise : undefined });
  await h.store.start(); fill(h.store); await h.store.submit();
  const oldCallback = [...h.timers.values()][0]; await h.tick();
  const read = h.calls.find(call => call.path === "/client/ai/runs/run-1");
  await h.store.selectWorkspace("ws-b"); assert.equal(read.options.signal.aborted, true);
  waiting.resolve(run("succeeded", { output: "旧结果" })); await flush();
  const before = h.calls.length; oldCallback(); await flush();
  assert.equal(h.calls.length, before); assert.equal(h.store.getSnapshot().run, null); assert.equal(h.timers.size, 0);
});

test("dispose aborts active requests, clears timers and ignores late 401 without navigating", async t => {
  const waiting = deferred();
  const h = harness(t, { route: ({ path }) => path === "/client/ai/runs/run-1" ? waiting.promise : undefined });
  await h.store.start(); fill(h.store); await h.store.submit(); const pending = h.store.readRun();
  const call = h.calls.at(-1); h.store.dispose(); assert.equal(call.options.signal.aborted, true); assert.equal(h.timers.size, 0);
  waiting.resolve(new Response("{}", { status: 401 })); await pending; assert.equal(h.unauthorized(), 0);
});

test("current 401 redirects to original client login callback; current 403 clears sensitive run and authorization", async t => {
  let status = 401;
  const h = harness(t, { route: ({ path }) => path === "/client/ai/runs/run-1" ? new Response("{}", { status }) : undefined });
  await h.store.start(); await h.store.readRun("run-1"); assert.equal(h.unauthorized(), 1); assert.equal(h.store.getSnapshot().principal, null);
  status = 403; await h.store.start(); fill(h.store); await h.store.submit(); await h.store.readRun();
  assert.equal(h.store.getSnapshot().issue.kind, "forbidden"); assert.equal(h.store.getSnapshot().context, null); assert.equal(h.store.getSnapshot().run, null);
  const count = posts(h).length; await h.store.submit(); assert.equal(posts(h).length, count);
});

test("poll transport failure preserves original run, stops polling, then manual read recovers", async t => {
  let down = true;
  const h = harness(t, { route: ({ path }) => path === "/client/ai/runs/run-1" && down ? new Response("{}", { status: 503 }) : undefined });
  await h.store.start(); fill(h.store); await h.store.submit(); await h.tick();
  assert.equal(h.store.getSnapshot().run.status, "queued"); assert.equal(h.store.getSnapshot().issue.kind, "service-unavailable"); assert.equal(h.timers.size, 0);
  down = false; await h.store.readRun(); assert.equal(h.store.getSnapshot().run.status, "succeeded"); assert.equal(h.store.getSnapshot().issue, null);
});

test("bounded polling pauses and explicit read resumes without executing again", async t => {
  const h = harness(t, { maxPolls: 1, route: ({ path }) => path === "/client/ai/runs/run-1" ? run("running") : undefined });
  await h.store.start(); fill(h.store); await h.store.submit(); await h.tick();
  assert.equal(h.store.getSnapshot().pollPaused, true); assert.equal(h.timers.size, 0);
  await h.store.readRun(); assert.equal(h.timers.size, 1); assert.equal(posts(h).length, 1);
});

test("response model validation rejects invented statuses, wrong run IDs, missing fields, unsafe input keys and malformed success envelopes", async t => {
  assert.throws(() => parseRun(run("invented")));
  assert.throws(() => parseRun(run(), { id: "other" }));
  assert.throws(() => parseRun(run(), { agentCode: "other-agent" }));
  assert.throws(() => parseRun(run("succeeded", { output: null })));
  assert.throws(() => parseRun(run("queued", { budgetStatus: "paid" })));
  assert.throws(() => parseAgents([{ ...agent, inputFields: ["constructor"] }]));
  assert.throws(() => parseAgents([{ ...agent, inputFields: [] }]));
  assert.deepEqual(parseAgents([agent])[0].inputFields, ["Goal", "context"]);
  const h = harness(t, { route: ({ options }) => options.method === "POST" ? new Response(JSON.stringify({ success: false, data: run() }), { status: 202 }) : undefined });
  await h.store.start(); fill(h.store); await h.store.submit();
  assert.equal(h.store.getSnapshot().run, null); assert.equal(h.store.getSnapshot().submissionUnconfirmed, true);
});

test("wrong run identity cannot replace original run; JSON output is preserved verbatim", async t => {
  let wrong = true;
  const h = harness(t, { route: ({ path }) => path === "/client/ai/runs/run-1" ? run("succeeded", { id: wrong ? "other" : "run-1", output: { result: "<script>not HTML</script>" } }) : undefined });
  await h.store.start(); fill(h.store); await h.store.submit(); await h.store.readRun();
  assert.equal(h.store.getSnapshot().run.status, "queued"); assert.equal(h.store.getSnapshot().issue.kind, "invalid-response"); assert.equal(h.timers.size, 0);
  wrong = false; await h.store.readRun(); assert.deepEqual(h.store.getSnapshot().run.output, { result: "<script>not HTML</script>" });
});

test("HTTP 404, 409 and 410 keep distinct error semantics and never invent a run", async t => {
  let status = 404;
  const h = harness(t, { route: ({ path }) => path === "/client/ai/runs/run-1" ? new Response("{}", { status }) : undefined });
  await h.store.start();
  for (const [value, kind] of [[404, "unavailable"], [409, "conflict"], [410, "expired"]]) {
    status = value; await h.store.readRun("run-1"); assert.equal(h.store.getSnapshot().issue.kind, kind); assert.equal(h.store.getSnapshot().run, null);
  }
});

test("private image uses SDK image path and scoped abort; stale image never appears in new workspace", async t => {
  const waiting = deferred(); const images = [];
  const h = harness(t, { requestImage: (path, options) => { images.push({ path, options }); return waiting.promise; },
    route: ({ options }) => options.method === "POST" ? run("succeeded", { output: { imageCount: 1 }, imageAssetId: "image-1" }) : undefined });
  await h.store.start(); fill(h.store); await h.store.submit(); const pending = h.store.readImage();
  assert.equal(images[0].path, "/client/ai/runs/run-1/image"); assert.equal(images[0].options.workspaceId, "ws-a");
  await h.store.selectWorkspace("ws-b"); assert.equal(images[0].options.signal.aborted, true);
  waiting.resolve(new Blob(["synthetic-png"], { type: "image/png" })); await pending;
  assert.equal(h.store.getSnapshot().imageBlob, null);
});

test("image success and rejected binary response use the real state image path", async t => {
  let valid = false;
  const h = harness(t, { requestImage: async () => new Blob(["synthetic-content"], { type: valid ? "image/png" : "text/html" }),
    route: ({ options }) => options.method === "POST" ? run("succeeded", { output: { imageCount: 1 }, imageAssetId: "image-1" }) : undefined });
  await h.store.start(); fill(h.store); await h.store.submit(); await h.store.readImage();
  assert.equal(h.store.getSnapshot().issue.kind, "invalid-response"); assert.equal(h.store.getSnapshot().imageBlob, null);
  valid = true; await h.store.readImage(); assert.equal(h.store.getSnapshot().imageBlob.type, "image/png");
  h.store.newTask(); assert.equal(h.store.getSnapshot().imageBlob, null);
});

test("expired image read discards previously loaded private Blob", async t => {
  let expired = false;
  const h = harness(t, { requestImage: async () => {
    if (expired) throw new sdk.ClientRequestFailure(410);
    return new Blob(["synthetic-image"], { type: "image/png" });
  }, route: ({ options }) => options.method === "POST" ? run("succeeded", { output: { imageCount: 1 }, imageAssetId: "image-1" }) : undefined });
  await h.store.start(); fill(h.store); await h.store.submit(); await h.store.readImage();
  assert.ok(h.store.getSnapshot().imageBlob);
  expired = true; await h.store.readImage();
  assert.equal(h.store.getSnapshot().imageBlob, null); assert.equal(h.store.getSnapshot().issue.kind, "expired");
});

test("F1 regression: lost submit response survives A to B to A and confirms exact input with the original key", async t => {
  let first = true;
  const h = harness(t, { route: ({ options }) => {
    if (options.method === "POST" && first) { first = false; throw new TypeError("synthetic response loss"); }
  } });
  await h.store.start("ws-a"); fill(h.store); await h.store.submit();
  assert.equal(h.store.getSnapshot().submissionUnconfirmed, true);
  await h.store.selectWorkspace("ws-b"); assert.equal(h.store.getSnapshot().recovery, null);
  await h.store.selectWorkspace("ws-a");
  assert.equal(h.store.getSnapshot().recovery.key, "request-1");
  assert.equal(h.store.getSnapshot().submissionUnconfirmed, true);
  assert.deepEqual(h.store.getSnapshot().input, {}); // Scope changes discard private input.
  h.store.setInput("Goal", "different"); h.store.setInput("context", "different");
  await h.store.submit(); assert.equal(posts(h).length, 1); // Wrong digest is blocked.
  fill(h.store); await h.store.submit();
  assert.deepEqual(JSON.parse(posts(h)[0].options.body), JSON.parse(posts(h)[1].options.body));
  assert.equal(h.keys(), 1);
});

test("F1 regression: unknown survives revalidation and cannot be replaced until its own valid terminal result", async t => {
  let result = "unknown";
  const h = harness(t, { route: ({ options, path }) => options.method === "POST" || path.startsWith("/client/ai/runs/") ? run(result) : undefined });
  await h.store.start(); fill(h.store); await h.store.submit();
  await h.store.start();
  assert.equal(h.store.getSnapshot().recovery.status, "unknown");
  assert.equal(h.store.getSnapshot().recovery.runId, "run-1");
  fill(h.store); h.store.newTask(); await h.store.submit();
  assert.equal(posts(h).length, 1); assert.equal(h.keys(), 1);
  await h.store.readRun(); assert.equal(h.store.getSnapshot().run.status, "unknown");
  result = "succeeded"; await h.store.readRun();
  assert.equal(h.store.getSnapshot().recovery, null);
  h.store.newTask(); fill(h.store); await h.store.submit();
  assert.equal(h.keys(), 2); assert.equal(posts(h).length, 2);
});

test("F2 regression: 410 purges private output and pending retry cannot resurrect it; only a new valid result restores content", async t => {
  let reads = 0;
  const waiting = deferred();
  const h = harness(t, { route: ({ path }) => {
    if (!path.startsWith("/client/ai/runs/")) return;
    reads += 1;
    if (reads === 1) return run("succeeded", { output: "PRIVATE_EXPIRED_TEXT" });
    if (reads === 2) return new Response("{}", { status: 410 });
    return waiting.promise;
  } });
  await h.store.start(); await h.store.readRun("run-1"); await h.store.readRun();
  assert.equal(h.store.getSnapshot().run.output, null);
  assert.equal(h.store.getSnapshot().contentUnavailable, true);
  const pending = h.store.readRun();
  assert.equal(h.store.getSnapshot().reading, true); assert.equal(h.store.getSnapshot().issue, null);
  assert.equal(h.store.getSnapshot().contentUnavailable, true); assert.equal(h.store.getSnapshot().run.output, null);
  waiting.resolve(run("succeeded", { output: "NEW_VALID_RESULT" })); await pending;
  assert.equal(h.store.getSnapshot().contentUnavailable, false); assert.equal(h.store.getSnapshot().run.output, "NEW_VALID_RESULT");
});

test("persistent recovery stores only opaque metadata, requires exact digest after reload, and never mints a replacement key", async t => {
  const saved = storage();
  const h = harness(t, { journalStorage: () => saved, route: ({ options }) => { if (options.method === "POST") throw new TypeError("response lost"); } });
  await h.store.start(); fill(h.store); await h.store.submit(); h.store.dispose();
  const serialized = [...saved.data.values()].join("");
  assert.ok(!serialized.includes("整理计划") && !serialized.includes("合成输入") && !serialized.includes("output") && !serialized.includes("password") && !serialized.includes("token"));
  const entry = JSON.parse(serialized)[0];
  assert.deepEqual(Object.keys(entry).sort(), ["agentCode", "digest", "key", "memberId", "runId", "status", "workspaceId"]);
  assert.match(entry.digest, /^[a-f0-9]{64}$/);
  const resumed = harness(t, { journalStorage: () => saved }); await resumed.store.start();
  assert.equal(resumed.store.getSnapshot().recoveryNeedsInput, true);
  assert.deepEqual(resumed.store.getSnapshot().input, {});
  resumed.store.setInput("Goal", "different"); resumed.store.setInput("context", "different"); await resumed.store.submit();
  assert.equal(posts(resumed).length, 0); assert.equal(resumed.keys(), 0);
  assert.equal(resumed.store.getSnapshot().recovery.key, entry.key);
  fill(resumed.store); await resumed.store.submit();
  assert.equal(JSON.parse(posts(resumed)[0].options.body).idempotencyKey, entry.key); assert.equal(resumed.keys(), 0);
});

test("persistent unknown reference survives unmount/new store without persisting private run content", async t => {
  const saved = storage();
  const h = harness(t, { journalStorage: () => saved, route: ({ options }) => options.method === "POST" ? run("unknown") : undefined });
  await h.store.start(); fill(h.store); await h.store.submit(); h.store.dispose();
  const resumed = harness(t, { journalStorage: () => saved }); await resumed.store.start();
  assert.equal(resumed.store.getSnapshot().recovery.status, "unknown");
  assert.equal(resumed.store.getSnapshot().recovery.runId, "run-1");
  assert.equal(resumed.store.getSnapshot().run, null);
  fill(resumed.store); await resumed.store.submit(); assert.equal(posts(resumed).length, 0); assert.equal(resumed.keys(), 0);
  await resumed.store.readRun(); assert.equal(resumed.store.getSnapshot().run.status, "succeeded");
  assert.equal(resumed.store.getSnapshot().recovery, null);
});

test("recovery is bound to the server-verified member plus workspace and never imports another member's original input", async t => {
  const saved = storage(); let member = "member-1";
  const h = harness(t, { journalStorage: () => saved, route: ({ options, path }) => path === "/client/auth/me" ? { id: member }
    : options.method === "POST" ? run("unknown") : undefined });
  await h.store.start("ws-a"); fill(h.store); await h.store.submit();
  await h.store.selectWorkspace("ws-b"); assert.equal(h.store.getSnapshot().recovery, null);
  member = "member-2"; await h.store.start("ws-a");
  assert.equal(h.store.getSnapshot().recovery, null); assert.deepEqual(h.store.getSnapshot().input, {});
  member = "member-1"; await h.store.start("ws-a");
  assert.equal(h.store.getSnapshot().recovery.status, "unknown");
  await h.store.submit(); assert.equal(posts(h).length, 1);
});

test("pagehide-style dispose/start loses private original input but preserves same-key recovery barrier", async t => {
  const h = harness(t, { route: ({ options }) => { if (options.method === "POST") throw new TypeError("response loss"); } });
  await h.store.start(); fill(h.store); await h.store.submit(); h.store.dispose(); await h.store.start();
  assert.equal(h.store.getSnapshot().recoveryNeedsInput, true); assert.deepEqual(h.store.getSnapshot().input, {});
  fill(h.store); await h.store.submit();
  assert.equal(h.keys(), 1); assert.equal(JSON.parse(posts(h)[0].options.body).idempotencyKey, JSON.parse(posts(h)[1].options.body).idempotencyKey);
});

test("reading an unrelated successful run cannot release an unconfirmed submission barrier", async t => {
  const h = harness(t, { route: ({ options, path }) => {
    if (options.method === "POST") throw new TypeError("response lost");
    if (path === "/client/ai/runs/other") return run("succeeded", { id: "other" });
  } });
  await h.store.start(); fill(h.store); await h.store.submit(); await h.store.readRun("other");
  assert.equal(h.store.getSnapshot().recovery.key, "request-1");
  h.store.newTask(); await h.store.submit(); assert.equal(posts(h).length, 1); assert.equal(h.keys(), 1);
});

test("storage corruption/write failure and unavailable journal lock fail closed before POST", async t => {
  for (const mode of ["corrupt", "write", "lock"]) await t.test(mode, async child => {
    const saved = { getItem: () => mode === "corrupt" ? "invalid-json" : null,
      setItem: () => { if (mode === "write") throw new Error("storage denied"); } };
    const h = harness(child, { journalStorage: () => saved, withRecoveryLock: mode === "lock" ? () => { throw new Error("lock unavailable"); } : undefined });
    await h.store.start(); fill(h.store); await h.store.submit();
    assert.equal(posts(h).length, 0); assert.equal(h.store.getSnapshot().recoveryBlocked, true);
    assert.equal(h.store.getSnapshot().issue.kind, "recovery");
  });
});

test("shared journal lock prevents two mounted stores from minting different keys for the same unresolved request", async t => {
  const saved = storage(); let tail = Promise.resolve();
  const lock = (_name, fn) => { const next = tail.then(fn); tail = next.catch(() => {}); return next; };
  const a = harness(t, { journalStorage: () => saved, withRecoveryLock: lock });
  const b = harness(t, { journalStorage: () => saved, withRecoveryLock: lock });
  await a.store.start(); await b.store.start(); fill(a.store); fill(b.store);
  await Promise.all([a.store.submit(), b.store.submit()]);
  assert.equal(a.keys() + b.keys(), 1);
  const keys = posts(b).map(call => JSON.parse(call.options.body).idempotencyKey);
  assert.ok(keys.length >= 1); assert.equal(new Set(keys).size, 1);
});

test("404 also clears private cache; invalid retry response cannot remove the independent unavailable flag", async t => {
  let reads = 0;
  const h = harness(t, { route: ({ path }) => {
    if (!path.startsWith("/client/ai/runs/")) return;
    reads += 1;
    return reads === 1 ? run("succeeded", { output: "PRIVATE" }) : reads === 2 ? new Response("{}", { status: 404 }) : run("invented");
  } });
  await h.store.start(); await h.store.readRun("run-1"); await h.store.readRun(); await h.store.readRun();
  assert.equal(h.store.getSnapshot().run.output, null); assert.equal(h.store.getSnapshot().contentUnavailable, true);
  assert.equal(h.store.getSnapshot().issue.kind, "invalid-response");
});
