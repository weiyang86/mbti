import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createPersonalWorkflowExecutionClient, createPersonalWorkflowsClient, validatePersonalWorkflowDraft } from "../../packages/sdk/dist/index.mjs";
import { createWorkflowExecutionState, parseWorkflowExecutionInput, workflowExecutionIssue } from "../../apps/web/app/components/client-workflow-execution-state.mjs";

// Real compiled public SDK and controller, synthetic transport only: no DB/HTTP/browser acceptance claim.
const publicationId = "11111111-1111-4111-8111-111111111111";
const oldPublicationId = "22222222-2222-4222-8222-222222222222";
const key = "33333333-3333-4333-8333-333333333333";
const permissions = ["workspace.ai.assets.read", "workspace.ai.assets.manage", "workspace.ai.workflows.publish", "workspace.ai.execute", "workspace.ai.read", "workspace.ai.workflows.execute"];
const graph = validatePersonalWorkflowDraft({ schemaVersion: 1, inputKeys: ["question"], nodes: [
  { id: "start", type: "start" }, { id: "agent", type: "agent", agentId: "agent1", revision: 1 }, { id: "end", type: "end" }
], edges: [{ from: "start", port: "next", to: "agent", input: "in" }, { from: "agent", port: "next", to: "end", input: "in" }] });
const graphDigest = createHash("sha256").update(graph.canonical).digest("hex");
const scope = { memberId: "member1", workspaceId: "workspace1", workflowId: "workflow1", revision: 1, graphDigest };
const ref = (patch = {}) => ({ id: publicationId, workflowId: "workflow1", workflowVersionId: "workflowVersion1", revision: 1, graphDigest,
  publicationEpoch: 1, nodeId: "agent", agentId: "agent1", agentVersionId: "agentVersion1", agentRevision: 1, agentPublicationEpoch: 1, ...patch });
const run = (patch = {}, origin = ref()) => ({ origin, run: { id: "run1", agentCode: "personal:agent1", status: "succeeded", output: { text: "私有测试输出 <script>literal</script>" },
  failureCode: null, estimatedCostNanos: "120", budgetStatus: "settled", imageAssetId: null, createdAt: "2026-11-07T10:00:00.000Z", expiresAt: "2026-11-14T10:00:00.000Z", ...patch } });
const error = status => Object.assign(new Error("synthetic transport failure"), { status });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(options = {}) {
  const calls = []; let changed = 0, hook = null, keysMade = 0;
  let me = { id: "member1", nickname: "私有昵称" };
  let context = { workspaceId: "workspace1", workspaceCode: "space1", roleId: "role1", roleCode: "owner", sessionGeneration: "a".repeat(64), permissions: [...permissions] };
  let head = { id: "workflow1", code: "private-workflow", name: "私有流程", revision: 1, graphDigest, graph: graph.graph, agentBindings: [] };
  let metadata = { workflowId: "workflow1", revision: 1, publishedRevision: 1, publicationEpoch: 1, publication: ref(), dependencyReadiness: { ready: true, reason: "ready" } };
  let preview = { publication: ref(), inputFields: ["question"], maximumEstimatedCostNanos: "500", modelExecutionConfigured: true };
  let result = run(), recovered = null;
  function setPublished(published) {
    const epoch = metadata.publicationEpoch + 1;
    metadata = { workflowId: "workflow1", revision: head.revision, publicationEpoch: epoch, publishedRevision: published ? head.revision : null,
      publication: published ? ref({ revision: head.revision, graphDigest: head.graphDigest, publicationEpoch: epoch }) : null,
      dependencyReadiness: { ready: published, reason: published ? "ready" : "not_published" } };
  }
  const request = async (path, init = {}) => {
    calls.push({ path, init });
    const alternate = await hook?.(path, init); if (alternate !== undefined) return structuredClone(alternate);
    if (path === "/client/auth/me") return structuredClone(me);
    if (path === "/client/workspaces/context") return structuredClone(context);
    if (path === "/client/ai/personal-workflows/workflow1") return structuredClone(head);
    if (path === "/client/workflow-executions/publications/workflow1") return structuredClone(metadata);
    if (path === "/client/workflow-executions/publications" && init.method === "POST") { setPublished(true); return structuredClone(metadata); }
    if (path === "/client/workflow-executions/publications/workflow1/unpublish" && init.method === "POST") { setPublished(false); return structuredClone(metadata); }
    if (path.startsWith("/client/workflow-executions/capability?")) return structuredClone(preview);
    if (path === "/client/workflow-executions/runs" && init.method === "POST") return structuredClone(result);
    if (path === "/client/workflow-executions/runs/run1") return structuredClone(result);
    if (path === `/client/workflow-executions/requests/${key}`) {
      if (recovered) return structuredClone(recovered);
      const r = result.run;
      return { origin: structuredClone(result.origin), request: { id: r.id, agentCode: r.agentCode, status: r.status, budgetStatus: r.budgetStatus,
        createdAt: r.createdAt, expiresAt: r.expiresAt, contentAvailable: true } };
    }
    throw new Error("Unexpected synthetic request");
  };
  const store = createWorkflowExecutionState({ request, executionClientFactory: createPersonalWorkflowExecutionClient, workflowsClientFactory: createPersonalWorkflowsClient,
    makeKey: () => { keysMade++; return key; }, onWorkflowChanged: () => { changed++; }, onScopeRejected: options.onScopeRejected, timeoutMs: options.timeoutMs ?? 8000 });
  return { store, calls, request, setPublished, get changed() { return changed; }, get keysMade() { return keysMade; },
    setHook: v => { hook = v; }, setContext: v => { context = { ...context, ...v }; }, setMe: v => { me = v; }, setHead: v => { head = { ...head, ...v }; },
    setMetadata: v => { metadata = v; }, setPreview: v => { preview = { ...preview, ...v }; }, setRun: v => { result = v; }, setRecovery: v => { recovered = v; } };
}
const posts = f => f.calls.filter(c => c.init.method === "POST");
const recoveries = f => f.calls.filter(c => c.path.includes("/requests/"));
async function ready(f, s = scope) { f.store.setScope(s); await f.store.readPublication(); assert.equal(f.store.getSnapshot().busy, false); }
async function submit(f) { await ready(f); await f.store.preview(); f.store.setField("input", '{"question":"请回答"}'); f.store.requestConfirmation("run"); await f.store.confirmSubmit(); }
function cleared(f) {
  const s = f.store.getSnapshot();
  for (const k of ["scope", "auth", "publication", "preview", "result", "recovery", "review", "confirmation"]) assert.equal(s[k], null, k);
  assert.equal(s.input, ""); assert.equal(s.runId, ""); assert.equal(s.busy, false);
  assert.ok(!JSON.stringify(s).includes("私有测试输出"));
}

test("flat JSON accepts exact approved keys and rejects duplicates, unknown keys, invalid JSON, prototypes, nesting and bounds", () => {
  assert.deepEqual(parseWorkflowExecutionInput('{"question":"hello"}', ["question"]), { question: "hello" });
  assert.deepEqual(parseWorkflowExecutionInput("{}", []), {});
  const invalid = ["", "null", "[]", "true", '{"question":4}', '{"question":null}', '{"question":{}}', '{"question":[]}', '{"question":""}',
    '{"question":"   "}', '{"question":"x","other":"y"}', "{}", '{"question":"x","question":"y"}', '{"question":"x","\\u0071uestion":"y"}',
    '{"__proto__":"x"}', '{"constructor":"x"}', '{"prototype":"x"}', '{"question":"x",}', '{"question":"x"}{}', '{"question":"\\ud800"}',
    JSON.stringify({ question: "x".repeat(2001) }), " ".repeat(65537)];
  for (const raw of invalid) assert.throws(() => parseWorkflowExecutionInput(raw, ["question"]));
  assert.throws(() => parseWorkflowExecutionInput("{}", ["question", "question"]));
  assert.throws(() => parseWorkflowExecutionInput("{}", ["__proto__"]));
});

test("scope assignment is zero network; explicit publication read uses only original endpoints with before/after authorization", async () => {
  const f = fixture(); f.store.setScope(scope); assert.equal(f.calls.length, 0);
  await f.store.readPublication();
  assert.deepEqual(f.calls.map(c => c.path), ["/client/auth/me", "/client/workspaces/context", "/client/ai/personal-workflows/workflow1",
    "/client/workflow-executions/publications/workflow1", "/client/auth/me", "/client/workspaces/context", "/client/ai/personal-workflows/workflow1"]);
  assert.ok(f.calls.every(c => c.init.signal instanceof AbortSignal && c.init.cache === "no-store"));
  assert.equal(posts(f).length, 0); assert.equal(f.store.getSnapshot().publication.publication.id, publicationId);
});

test("publication read needs assets.read only; read/recover permissions do not inherit preview/submit permissions", async () => {
  const f = fixture(); f.setContext({ permissions: ["workspace.ai.assets.read", "workspace.ai.read", "workspace.ai.workflows.execute"] });
  f.setPreview({ modelExecutionConfigured: false }); await ready(f);
  assert.ok(f.store.getSnapshot().publication); assert.equal(f.store.canPublish(), false); assert.equal(f.store.canSubmit(), false);
  await f.store.preview(); assert.equal(f.calls.some(c => c.path.includes("/capability")), false);
  f.store.setField("runId", "run1"); await f.store.readRun(); assert.equal(f.store.getSnapshot().result.run.output.text.includes("私有"), true);
  assert.equal(posts(f).length, 0);
});

test("default-off preview blocks submit but does not preempt authorized old result GET", async () => {
  const f = fixture(); await ready(f); f.setPreview({ modelExecutionConfigured: false }); await f.store.preview();
  assert.equal(f.store.getSnapshot().preview.modelExecutionConfigured, false); assert.equal(f.store.canSubmit(), false);
  f.store.requestConfirmation("run"); await f.store.confirmSubmit(); assert.equal(posts(f).length, 0);
  f.store.setField("runId", "run1"); await f.store.readRun(); assert.equal(f.store.getSnapshot().result.run.id, "run1");
});

test("publication and preview service failure cannot preempt independent authorized existing result access", async () => {
  const f = fixture(); f.store.setScope(scope);
  f.setHook(path => { if (path.includes("/publications/") || path.includes("/capability?")) throw error(503); });
  await f.store.readPublication(); cleared(f);
  f.store.setScope(scope); await f.store.verifyAccess();
  assert.ok(f.store.getSnapshot().auth); assert.equal(f.store.getSnapshot().publication, null);
  f.store.setField("runId", "run1"); await f.store.readRun(); assert.equal(f.store.getSnapshot().result.run.id, "run1");
  assert.equal(posts(f).length, 0);
});

test("execution configuration turning off at final preview produces zero submit POST", async () => {
  const f = fixture(); await ready(f); await f.store.preview(); f.store.setField("input", '{"question":"x"}'); f.store.requestConfirmation("run");
  f.setPreview({ modelExecutionConfigured: false }); await f.store.confirmSubmit(); assert.equal(posts(f).length, 0); assert.equal(f.keysMade, 0);
});

test("publish and unpublish require separate explicit confirmations and exact original CAS payloads", async () => {
  const f = fixture(); await ready(f); await f.store.confirmPublication(); assert.equal(posts(f).length, 0);
  f.store.requestConfirmation("publish"); f.store.cancelConfirmation(); await f.store.confirmPublication(); assert.equal(posts(f).length, 0);
  f.store.requestConfirmation("publish"); await f.store.confirmPublication();
  assert.equal(posts(f).length, 1); assert.deepEqual(JSON.parse(posts(f)[0].init.body), { workflowId: "workflow1", expectedRevision: 1, expectedPublicationEpoch: 1 });
  assert.equal(f.changed, 1); assert.equal(f.store.getSnapshot().locked, false);
  f.store.requestConfirmation("unpublish"); await f.store.confirmPublication();
  assert.deepEqual(JSON.parse(posts(f)[1].init.body), { expectedRevision: 1, expectedPublicationEpoch: 2 });
  assert.equal(f.store.getSnapshot().publication.publication, null); assert.equal(f.changed, 2);
});

test("publication epoch CAS drift is caught before POST; graph/head drift clears all private content", async () => {
  const f = fixture(); await ready(f); f.store.requestConfirmation("publish"); f.setPublished(true); await f.store.confirmPublication();
  cleared(f); assert.equal(posts(f).length, 0); assert.equal(f.store.getSnapshot().locked, false);
  for (const patch of [{ revision: 2 }, { graphDigest: "b".repeat(64) }, { id: "other" }]) {
    const g = fixture(); await ready(g); g.setHead(patch); await g.store.preview(); cleared(g); assert.equal(posts(g).length, 0);
  }
});

test("complex graphs stay intact and cannot be advertised publishable", async () => {
  for (const type of ["agent", "condition", "parallel", "loop", "human-approval"]) {
    const f = fixture(); const complex = structuredClone(graph.graph); complex.nodes.push({ id: "extra", type });
    const before = JSON.stringify(complex); f.setHead({ graph: complex }); await ready(f);
    assert.equal(f.store.getSnapshot().singleAgent, false); assert.equal(f.store.canPublish(), false);
    f.store.requestConfirmation("publish"); await f.store.confirmPublication(); assert.equal(posts(f).length, 0); assert.equal(JSON.stringify(complex), before);
  }
});

test("exact input plus one opaque original key is submitted once; terminal POST reply alone never releases lock", async () => {
  const f = fixture(); await submit(f);
  assert.equal(posts(f).length, 1); assert.equal(f.keysMade, 1);
  assert.deepEqual(JSON.parse(posts(f)[0].init.body), { publicationId, input: { question: "请回答" }, idempotencyKey: key });
  assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.store.canResolveRun(), false); assert.equal(f.store.getSnapshot().input, "");
  f.store.requestConfirmation("run"); await f.store.confirmSubmit(); assert.equal(posts(f).length, 1);
  await f.store.recover(); assert.equal(f.store.canResolveRun(), true); assert.equal(f.store.getSnapshot().locked, true);
  await f.store.resolveRun(); assert.equal(f.store.getSnapshot().locked, false); assert.equal(posts(f).length, 1);
  assert.equal(recoveries(f).length, 2); assert.ok(recoveries(f).every(c => c.path.endsWith(key)));
});

test("invalid or unknown input never reaches POST or consumes a key", async () => {
  for (const input of ['{"question":"x","unknown":"y"}', '{"question":"x","question":"y"}', '{"question":false}', "{invalid}"]) {
    const f = fixture(); await ready(f); await f.store.preview(); f.store.setField("input", input); f.store.requestConfirmation("run"); await f.store.confirmSubmit();
    assert.equal(posts(f).length, 0); assert.equal(f.keysMade, 0); assert.ok(f.store.getSnapshot().issue);
  }
});

test("preview changed approved keys or original publication cannot silently submit", async () => {
  for (const preview of [{ inputFields: ["other"] }, { publication: ref({ id: oldPublicationId }) }, { publication: ref({ graphDigest: "b".repeat(64) }) }]) {
    const f = fixture(); await ready(f); await f.store.preview(); f.store.setField("input", '{"question":"x"}'); f.store.requestConfirmation("run");
    f.setPreview(preview); await f.store.confirmSubmit(); cleared(f); assert.equal(posts(f).length, 0);
  }
});

test("every attempted publication failure, even committed then 4xx, retains lock until read plus separate authorized ack", async () => {
  for (const kind of ["publish", "unpublish"]) for (const status of [400, 401, 403, 404, 409, 410, 503, 0]) {
    const f = fixture(); await ready(f); f.store.requestConfirmation(kind);
    f.setHook((path, init) => { if (init.method === "POST") { f.setPublished(kind === "publish"); throw error(status); } });
    await f.store.confirmPublication(); cleared(f); assert.equal(f.store.getSnapshot().locked, true); assert.equal(posts(f).length, 1);
    f.setHook(null); await ready(f);
    await f.store.acknowledgePublicationWrite(); assert.equal(f.store.getSnapshot().locked, true); // no review yet
    await f.store.reviewPublicationWrite(); assert.ok(f.store.getSnapshot().review); assert.equal(f.store.getSnapshot().locked, true);
    await f.store.acknowledgePublicationWrite(); assert.equal(f.store.getSnapshot().locked, false); assert.equal(posts(f).length, 1);
  }
});

test("publication ack compares fresh publication and head; intervening drift never unlocks", async () => {
  const f = fixture(); await ready(f); f.store.requestConfirmation("publish"); f.setHook((p, init) => { if (init.method === "POST") throw error(503); });
  await f.store.confirmPublication(); f.setHook(null); await ready(f); await f.store.reviewPublicationWrite(); f.setPublished(false);
  await f.store.acknowledgePublicationWrite(); cleared(f); assert.equal(f.store.getSnapshot().locked, true);
});

test("run POST failures retain the SAME key/publication across null, other owner, scope resume and default-off reads", async () => {
  for (const status of [400, 401, 403, 404, 409, 410, 503, 0]) {
    const f = fixture(); f.setHook((path, init) => { if (path.endsWith("/runs") && init.method === "POST") throw error(status); }); await submit(f);
    cleared(f); assert.equal(f.store.getSnapshot().locked, true);
    f.store.setScope(null); f.store.setScope({ ...scope, memberId: "other" }); assert.equal(f.store.getSnapshot().pending, null);
    assert.equal(f.store.canSubmit(), false); f.setHook(null); await ready(f); f.setPreview({ modelExecutionConfigured: false });
    await f.store.preview(); assert.equal(f.store.getSnapshot().pending.key, key);
    await f.store.recover(); await f.store.resolveRun(); assert.equal(f.store.getSnapshot().locked, false);
    assert.equal(posts(f).length, 1); assert.equal(f.keysMade, 1); assert.equal(recoveries(f).length, 2);
  }
});

test("unknown and reserved budget never unlock; failed released original-key GET plus explicit resolve can unlock", async () => {
  for (const [status, budgetStatus] of [["unknown", "reserved"], ["running", "reserved"], ["succeeded", "reserved"], ["failed", "reserved"], ["unknown", "released"]]) {
    const f = fixture(); f.setRun(run({ status, budgetStatus })); await submit(f); await f.store.recover();
    assert.equal(f.store.canResolveRun(), false); await f.store.resolveRun(); assert.equal(f.store.getSnapshot().locked, true); assert.equal(posts(f).length, 1);
  }
  const f = fixture(); f.setRun(run({ status: "failed", budgetStatus: "released" })); await submit(f); await f.store.recover();
  assert.equal(f.store.canResolveRun(), true); await f.store.resolveRun(); assert.equal(f.store.getSnapshot().locked, false);
});

test("recovery of mismatching origin or original Run is fenced; arbitrary manual GET cannot resolve original key", async () => {
  const f = fixture(); await submit(f); f.store.setField("runId", "run1"); await f.store.readRun(); assert.equal(f.store.canResolveRun(), false);
  f.setRun(run({}, ref({ id: oldPublicationId }))); await f.store.recover(); cleared(f); assert.equal(f.store.getSnapshot().locked, true);
  await ready(f); f.setRun(run({ id: "differentRun" })); await f.store.recover(); cleared(f); assert.equal(f.store.getSnapshot().locked, true);
});

test("authorized older Run reads preserve original publication reference rather than rewriting it to current head", async () => {
  const f = fixture(); f.setHead({ revision: 2, graphDigest: "b".repeat(64) });
  f.setMetadata({ workflowId: "workflow1", revision: 2, publishedRevision: 1, publicationEpoch: 1,
    publication: ref(), dependencyReadiness: { ready: false, reason: "revision_changed" } });
  await ready(f, { ...scope, revision: 2, graphDigest: "b".repeat(64) });
  f.setRun(run({}, ref({ id: oldPublicationId })));
  f.store.setField("runId", "run1"); await f.store.readRun(); assert.equal(f.store.getSnapshot().result.origin.id, oldPublicationId);
  assert.equal(f.store.getSnapshot().result.origin.revision, 1); assert.equal(f.store.getSnapshot().scope.revision, 2);
  assert.equal(f.store.getSnapshot().result.origin.graphDigest, graphDigest); assert.equal(posts(f).length, 0);
});

test("terminal acknowledgement rechecks same-key status/budget and late authorization before releasing lock", async () => {
  const f = fixture(); await submit(f); await f.store.recover(); assert.equal(f.store.canResolveRun(), true);
  f.setRun(run({ status: "unknown", budgetStatus: "reserved" })); await f.store.resolveRun(); cleared(f); assert.equal(f.store.getSnapshot().locked, true);
  await ready(f); f.setRun(run()); await f.store.recover();
  f.setHook(path => { if (path.includes("/requests/")) f.setContext({ sessionGeneration: "b".repeat(64) }); });
  await f.store.resolveRun(); cleared(f); assert.equal(f.store.getSnapshot().locked, true); assert.equal(posts(f).length, 1);
});

test("missing read permissions refuse old Run/recovery without borrowing submit permissions", async () => {
  const f = fixture(); f.setContext({ permissions: permissions.filter(p => p !== "workspace.ai.read") }); await submit(f);
  f.store.setField("runId", "run1"); await f.store.readRun(); await f.store.recover();
  assert.equal(recoveries(f).length, 0); assert.equal(f.calls.some(c => c.path.endsWith("/runs/run1")), false);
  assert.equal(f.store.getSnapshot().locked, true);
});

test("actual auth/me and context member, workspace, role, permissions and 64hex session changes fence actions", async () => {
  const patches = [{ workspaceId: "other" }, { workspaceCode: "changed" }, { roleId: "other" }, { roleCode: "reader" },
    { permissions: permissions.filter(p => p !== "workspace.ai.execute") }, { sessionGeneration: "b".repeat(64) },
    { sessionGeneration: "invalid" }, { sessionGeneration: "" }, { permissions: [...permissions, permissions[0]] }];
  for (const patch of patches) {
    const f = fixture(); await ready(f); f.setContext(patch); await f.store.preview(); cleared(f); assert.equal(posts(f).length, 0);
  }
  const f = fixture(); await ready(f); f.setMe({ id: "other" }); await f.store.preview(); cleared(f);
});

test("late revocation after successful submit hides output and keeps recovery lock; no callback can imply acceptance", async () => {
  const f = fixture(); f.setHook((path, init) => { if (path.endsWith("/runs") && init.method === "POST") f.setContext({ sessionGeneration: "b".repeat(64) }); });
  await submit(f); cleared(f); assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.changed, 0); assert.equal(posts(f).length, 1);
});

test("late revocation after publication success hides metadata and keeps opaque publication lock", async () => {
  const f = fixture(); await ready(f); f.store.requestConfirmation("publish");
  f.setHook((path, init) => { if (init.method === "POST") f.setContext({ roleId: "revoked" }); });
  await f.store.confirmPublication(); cleared(f); assert.equal(f.store.getSnapshot().locked, true); assert.equal(f.changed, 0);
});

test("late revocation after GET never exposes private output", async () => {
  const f = fixture(); await ready(f); f.store.setField("runId", "run1");
  f.setHook(path => { if (path.endsWith("/runs/run1")) f.setContext({ permissions: [] }); });
  await f.store.readRun(); cleared(f); assert.equal(posts(f).length, 0);
});

test("null/edit/hidden/blur suspension aborts in-flight work, drops private data and ignores an uncooperative late reply", async () => {
  for (const leave of [f => f.store.suspend(), f => f.store.setScope(null), f => f.store.setScope({ ...scope, revision: 2 })]) {
    const f = fixture(); await ready(f); await f.store.preview(); f.store.setField("input", '{"question":"私有输入"}'); f.store.requestConfirmation("run");
    const gate = deferred(), arrived = deferred();
    f.setHook(async (path, init) => { if (path.endsWith("/runs") && init.method === "POST") { arrived.resolve(); await gate.promise; return run(); } });
    const work = f.store.confirmSubmit(); await arrived.promise; const signal = posts(f)[0].init.signal;
    leave(f); assert.equal(signal.aborted, true); assert.equal(f.store.getSnapshot().input, "");
    gate.resolve(); await work; assert.equal(f.store.getSnapshot().result, null); assert.equal(f.store.getSnapshot().locked, true);
    assert.equal(f.changed, 0); assert.equal(posts(f).length, 1);
  }
});

test("timeout fences late response and retains one original key", async () => {
  const f = fixture({ timeoutMs: 30 }); await ready(f); await f.store.preview(); f.store.setField("input", '{"question":"x"}'); f.store.requestConfirmation("run");
  const gate = deferred(), arrived = deferred(); f.setHook(async (path, init) => { if (init.method === "POST") { arrived.resolve(); await gate.promise; return run(); } });
  const work = f.store.confirmSubmit(); await arrived.promise; await delay(70); cleared(f); assert.equal(f.store.getSnapshot().locked, true);
  gate.resolve(); await work; cleared(f); assert.equal(posts(f).length, 1); assert.equal(f.keysMade, 1);
});

test("malformed SDK response including extra transport keys is rejected without showing output or unlocking", async () => {
  const f = fixture(); f.setRun({ ...run(), unexpected: "not approved" }); await submit(f); cleared(f); assert.equal(f.store.getSnapshot().locked, true);
  f.setHook(null); await ready(f); f.setRecovery({ origin: ref(), request: { ...run().run, contentAvailable: true } });
  await f.store.recover(); cleared(f); assert.equal(f.store.getSnapshot().locked, true);
});

test("all required current HTTP failures provide distinct actionable messages without body logging", () => {
  const statuses = [401, 403, 404, 409, 410, 503]; const issues = statuses.map(status => workflowExecutionIssue(error(status)));
  assert.deepEqual(issues.map(i => i.status), statuses); assert.equal(new Set(issues.map(i => i.message)).size, statuses.length);
  assert.ok(issues.every(i => !i.message.includes("synthetic transport failure")));
});


test("current authority fence clears private state before notifying the original parent", async () => {
  let rejected = 0;
  const f = fixture({ onScopeRejected: () => { rejected++; assert.equal(f.store.getSnapshot().result, null); assert.equal(f.store.getSnapshot().auth, null); } });
  f.store.setScope(scope); await f.store.readPublication(); f.setContext({ permissions: [] }); await f.store.verifyAccess();
  assert.equal(rejected, 1); assert.equal(f.calls.filter(c => c.init.method === "POST").length, 0); f.store.suspend();
});
