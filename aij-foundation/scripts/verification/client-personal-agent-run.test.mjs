import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createAiClient, createAiRunRecoveryClient, createPersonalAgentRunPreviewsClient, createPersonalAgentRunsClient, createPersonalAgentsClient, createClientApi } from "../../packages/sdk/dist/index.mjs";
import { createPersonalAgentRun, parsePersonalPreview, parsePersonalJournal, parsePersonalRun, personalJournalKey } from "../../apps/web/app/components/client-personal-agent-run-state.mjs";

// OFFLINE synthetic transport only: actual compiled SDK + page state. No API/PG/JobService claim.
const agentId = "7ac902e2-d7fa-44f0-82bd-2a4c27f7c009", otherAgent = "e39285c8-78eb-45bc-81c5-9be1bfcdaf3b";
const createdAt = "2026-11-05T00:00:00.000Z", expiresAt = "2099-11-12T00:00:00.000Z";
const safePreview = () => ({ personalAgentId: agentId, code: "own-agent", name: "我的研究助手", revision: 2, inputFields: ["question"], outputFormat: "text", outputFields: [], capability: "text", modelCode: "advice-text", modelRevision: 1, catalogVersion: 4, maximumEstimatedCostNanos: "12000000", modelExecutionConfigured: true });
const result = (status = "succeeded") => ({ id: "run-1", agentCode: `personal:${agentId}`, status, budgetStatus: status === "succeeded" ? "settled" : status === "failed" ? "released" : "reserved", output: status === "succeeded" ? "OUTPUT_PRIVATE_SENTINEL <script>" : null, failureCode: null, estimatedCostNanos: "12", imageAssetId: null, createdAt, expiresAt });
const reference = run => Object.fromEntries([...Object.entries(run).filter(([k]) => ["id", "agentCode", "status", "budgetStatus", "createdAt", "expiresAt"].includes(k)), ["contentAvailable", true]]);
const journalEntry = (patch = {}) => ({ memberId: "owner", workspaceId: "space", agentId, revision: 2, key: "original-key-001", digest: "a".repeat(64), runId: null, status: "unconfirmed", ...patch });
const encode = entry => JSON.stringify({ version: 1, entries: [entry] });
function memoryStorage() {
  const values = new Map();
  return { values, getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
}
function locks() {
  const tails = new Map();
  return (name, fn) => { const p = (tails.get(name) ?? Promise.resolve()).then(fn); tails.set(name, p.catch(() => {})); return p; };
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await tick(); } assert.fail("barrier not reached"); }
function fixture(options = {}) {
  const state = { member: "owner", permissions: ["workspace.ai.execute", "workspace.ai.assets.read", "workspace.ai.read"], preview: safePreview(), enabled: true,
    calls: [], admitted: new Map(), run: result(), counters: { posts: 0, recovery: 0, reads: 0 }, ...options.state };
  const storage = options.storage ?? memoryStorage(), withRecoveryLock = options.withRecoveryLock ?? locks();
  const request = async (path, init = {}) => {
    state.calls.push({ path, ...init });
    if (state.onRequest) await state.onRequest(path, init);
    if (path === "/client/auth/me") return { id: state.member };
    if (path.startsWith("/client/workspaces?")) return { total: 2, items: ["space", "other"].map(id => ({ workspace: { id, name: id }, role: { name: "测试角色" } })) };
    if (path === "/client/workspaces/context") return { workspaceId: init.workspaceId, workspaceName: init.workspaceId, permissions: state.permissions };
    if (path.includes("/run-preview?")) { if (state.previewError) throw { status: state.previewError }; return state.preview; }
    if (path.includes("/run-requests/")) {
      state.counters.recovery++; if (state.recoveryError) throw { status: state.recoveryError };
      const key = path.split("/").at(-1); const run = state.admitted.get(key); if (!run) throw { status: 404 }; return state.reference ?? reference(run);
    }
    if (path.startsWith("/client/ai/runs/")) { state.counters.reads++; if (state.readError) throw { status: state.readError }; return state.readRun ?? [...state.admitted.values()].find(r => r.id === path.split("/").at(-1)); }
    if (path.endsWith("/runs") && init.method === "POST") {
      state.counters.posts++; const body = JSON.parse(init.body); assert.deepEqual(Object.keys(body).sort(), ["expectedRevision", "idempotencyKey", "input"]);
      if (state.submitError) throw { status: state.submitError };
      state.admitted.set(body.idempotencyKey, state.run);
      if (state.afterAdmit) await state.afterAdmit(path, init);
      return state.run;
    }
    if (path.startsWith("/client/ai/personal-agents?")) return { items: [{ id: agentId, revision: state.preview.revision, enabled: state.enabled }], nextCursor: null };
    assert.fail("Unexpected API path " + path);
  };
  const store = createPersonalAgentRun({ agentId, request, journalStorage: () => storage, withRecoveryLock, previewsClientFactory: createPersonalAgentRunPreviewsClient,
    runsClientFactory: createPersonalAgentRunsClient, aiClientFactory: createAiClient, recoveryClientFactory: createAiRunRecoveryClient, agentsClientFactory: createPersonalAgentsClient,
    makeKey: () => "test-key-001", ...options.store });
  const prepare = async () => { await store.start("space"); store.setInput("question", "INPUT_PRIVATE_SENTINEL"); store.requestConfirmation(); };
  return { store, state, storage, request, withRecoveryLock, prepare };
}

test("compiled SDK exports ESM and CJS and strict safe preflight binds exact source/revision/shape", () => {
  const cjs = createRequire(import.meta.url)("../../packages/sdk/dist/index.cjs");
  for (const name of ["createPersonalAgentRunPreviewsClient", "createPersonalAgentRunsClient", "createAiClient", "createAiRunRecoveryClient"]) assert.equal(typeof cjs[name], "function");
  assert.deepEqual(parsePersonalPreview(safePreview(), agentId, 2), safePreview());
  for (const patch of [{ personalAgentId: otherAgent }, { revision: 3 }, { revision: "2" }, { modelExecutionConfigured: "true" }, { inputFields: ["__proto__"] }, { inputFields: ["x", "x"] }, { outputFormat: "json", outputFields: [] }, { capability: "image" }, { instructions: "PRIVATE" }, { modelRevision: 0 }, { maximumEstimatedCostNanos: "-1" }]) assert.throws(() => parsePersonalPreview({ ...safePreview(), ...patch }, agentId, 2));
  assert.throws(() => parsePersonalPreview(Object.assign(Object.create({ injected: true }), safePreview()), agentId, 2));
  const entry = journalEntry();
  for (const patch of [{ agentCode: `personal:${otherAgent}` }, { status: "unknown", budgetStatus: "settled" }, { output: ["x"] }, { output: { answer: 4 } }, { output: JSON.parse('{"__proto__":"x"}') }, { privateFragment: "x" }, { imageAssetId: "other" }]) assert.throws(() => parsePersonalRun({ ...result(), ...patch }, entry));
  const p = { ...safePreview(), outputFormat: "json", outputFields: ["answer"] };
  assert.deepEqual(parsePersonalRun({ ...result(), output: { answer: "<script>safe text" } }, entry, false, p).output, { answer: "<script>safe text" });
  for (const output of ["wrong", { other: "x" }, { answer: "x", extra: "x" }]) assert.throws(() => parsePersonalRun({ ...result(), output }, entry, false, p));
});
test("manual bounded fields + conditional confirmation submits once with exact original revision", async () => {
  const f = fixture(); await f.store.start("space"); await f.store.confirmSubmit(); assert.equal(f.state.counters.posts, 0);
  f.store.requestConfirmation(); assert.equal(f.store.getSnapshot().confirmation, false);
  f.store.setInput("question", "x".repeat(2001)); assert.equal(f.store.getSnapshot().input.question, undefined);
  f.store.setInput("question", "INPUT_PRIVATE_SENTINEL"); f.store.requestConfirmation(); assert.equal(f.store.getSnapshot().confirmation, true);
  await Promise.all([f.store.confirmSubmit(), f.store.confirmSubmit()]); assert.equal(f.state.counters.posts, 1);
  assert.equal(f.store.getSnapshot().confirmation, false); assert.equal(f.store.getSnapshot().run.status, "succeeded");
  const raw = f.storage.values.get(personalJournalKey("owner")), entries = parsePersonalJournal(raw, "owner");
  assert.equal(entries[0].revision, 2); assert.equal(entries[0].status, "succeeded");
  assert.equal(entries[0].digest, createHash("sha256").update(JSON.stringify([agentId, 2, [["question", "INPUT_PRIVATE_SENTINEL"]]])).digest("hex"));
  for (const secret of ["INPUT_PRIVATE_SENTINEL", "OUTPUT_PRIVATE_SENTINEL", "我的研究助手", "instructions", "memory"]) assert.ok(!raw.includes(secret));
  assert.ok(f.state.calls.every(c => !c.path.includes("SENTINEL") && !c.path.includes("memory") && !c.path.includes("versions") && !c.path.endsWith(agentId)));
  f.store.dispose();
});
test("lost admitted reply + reload recovers original key through GET while flags/config/Agent are off", async () => {
  const f = fixture({ state: { afterAdmit: async () => { throw new Error("lost synthetic reply"); } } }); await f.prepare(); await f.store.confirmSubmit();
  assert.equal(f.store.getSnapshot().journal.status, "unconfirmed"); assert.equal(f.state.counters.posts, 1); f.store.dispose();
  const g = fixture({ storage: f.storage, state: { admitted: f.state.admitted, previewError: 503, enabled: false } }); await g.store.start("space");
  assert.equal(g.state.counters.posts, 0); assert.equal(g.state.counters.recovery, 1); assert.equal(g.store.getSnapshot().run.output, result().output);
  assert.ok(g.state.calls.some(c => c.path.endsWith("/run-requests/test-key-001"))); assert.equal(g.store.getSnapshot().preview, null);
  assert.ok(g.state.calls.findIndex(c => c.path.includes("run-requests")) < g.state.calls.findIndex(c => c.path.includes("personal-agents?")));
  g.store.dispose();
});
test("timeout bounds an abort-ignoring admitted transport; original key remains and late reply cannot write", async () => {
  const wait = deferred(), f = fixture({ state: { afterAdmit: () => wait.promise }, store: { timeoutMs: 25 } });
  await f.prepare(); const promise = f.store.confirmSubmit(); const keepAlive = setTimeout(() => {}, 1000); await promise; clearTimeout(keepAlive);
  assert.equal(f.state.counters.posts, 1); assert.equal(f.store.getSnapshot().journal.status, "unconfirmed");
  const raw = f.storage.values.get(personalJournalKey("owner")); f.store.dispose(); wait.resolve(); await tick(); assert.equal(f.storage.values.get(personalJournalKey("owner")), raw);
  await f.store.start("space"); assert.equal(f.store.getSnapshot().run.status, "succeeded"); assert.equal(f.state.counters.posts, 1); f.store.dispose();
});
test("two stores share lock: concurrent confirmation admits exactly one; loser only restores original", async () => {
  const storage = memoryStorage(), lock = locks(), gate = deferred(), first = fixture({ storage, withRecoveryLock: lock, state: { afterAdmit: () => gate.promise } }), second = fixture({ storage, withRecoveryLock: lock });
  await first.prepare(); await second.prepare(); const a = first.store.confirmSubmit(); await until(() => first.state.counters.posts === 1);
  const b = second.store.confirmSubmit(); gate.resolve(); await Promise.all([a, b]);
  assert.equal(first.state.counters.posts + second.state.counters.posts, 1); assert.equal(second.store.getSnapshot().storageBlocked, true);
  assert.equal(parsePersonalJournal(storage.values.get(personalJournalKey("owner")), "owner")[0].runId, "run-1"); first.store.dispose(); second.store.dispose();
});
test("strict journal: fields/prototype/schema/size/cap/duplicate/foreign/key all fail closed", () => {
  assert.deepEqual(parsePersonalJournal(null, "owner"), []);
  const bad = ["", "[]", "{}", "x".repeat(16385), JSON.stringify({ version: 2, entries: [] }), JSON.stringify({ version: 1, entries: [], output: "x" }),
    encode(journalEntry({ memberId: "foreign" })), encode(journalEntry({ workspaceId: "../space" })), encode(journalEntry({ agentId: "personal:" + agentId })),
    encode(journalEntry({ revision: 0 })), encode(journalEntry({ key: "x" })), encode(journalEntry({ digest: "x" })), encode(journalEntry({ status: "unknown" })), encode(journalEntry({ runId: "run-1" })), encode(journalEntry({ input: "private" })),
    JSON.stringify({ version: 1, entries: [journalEntry(), journalEntry()] }), JSON.stringify({ version: 1, entries: Array.from({ length: 33 }, (_, i) => journalEntry({ workspaceId: "s" + i })) }),
    encode(journalEntry()).replace('"revision":2', '"__proto__":{},"revision":2')];
  for (const raw of bad) assert.throws(() => parsePersonalJournal(raw, "owner"));
});
test("read/write/quota/silent write/CAS readback/lock failures prevent any POST", async () => {
  for (const mode of ["get", "set", "silent", "cas", "lock", "corrupt"]) {
    const storage = memoryStorage(); let armed = false;
    const get = storage.getItem, set = storage.setItem;
    storage.getItem = k => { if (armed && mode === "get") throw new Error("read denied"); if (mode === "corrupt") return "{}"; return get(k); };
    storage.setItem = (k, v) => { if (mode === "set") throw new Error("quota"); if (mode === "silent") return; set(k, mode === "cas" ? encode(journalEntry({ key: "other-key-001" })) : v); };
    const f = fixture({ storage, ...(mode === "lock" ? { withRecoveryLock: async () => { throw new Error("locks unavailable"); } } : {}) });
    await f.prepare(); armed = true; await f.store.confirmSubmit(); assert.equal(f.state.counters.posts, 0, mode); assert.equal(f.store.getSnapshot().storageBlocked, true, mode); f.store.dispose();
  }
});
test("stale scope during digest/lock/read/submit late success and rejection never posts or writes into new scope", async () => {
  for (const reject of [false, true]) {
    const gate = deferred(), f = fixture({ state: { afterAdmit: () => gate.promise } }); await f.prepare(); const pending = f.store.confirmSubmit(); await until(() => f.state.counters.posts === 1);
    const raw = f.storage.values.get(personalJournalKey("owner")); await f.store.selectWorkspace("other"); if (reject) gate.reject(new Error("late failure")); else gate.resolve(); await pending;
    assert.equal(f.store.getSnapshot().workspaceId, "other"); assert.equal(f.store.getSnapshot().run, null); assert.equal(f.storage.values.get(personalJournalKey("owner")), raw); assert.equal(f.state.counters.posts, 1); f.store.dispose();
  }
  const gate = deferred(), f = fixture(); await f.prepare(); f.store.dispose(); await f.store.confirmSubmit(); assert.equal(f.state.counters.posts, 0);
  const g = fixture({ withRecoveryLock: async (_name, fn) => { await gate.promise; return fn(); } }); const start = g.store.start("space"); await tick(); g.store.dispose(); gate.resolve(); await start; assert.equal(g.store.getSnapshot().run, null); assert.equal(g.storage.values.size, 0);
});
test("scope invalidation before transport dispatch prevents old-scope POST even after key persistence", async () => {
  const storage = memoryStorage(), f = fixture({ storage }); await f.prepare();
  const set = storage.setItem; storage.setItem = (k, v) => { set(k, v); f.store.dispose(); };
  await f.store.confirmSubmit(); assert.equal(f.state.counters.posts, 0); assert.equal(f.store.getSnapshot().run, null);
});
test("permissions/config/disabled/stale/missing dependencies and foreign selectors never enable submit", async () => {
  for (const state of [{ permissions: ["workspace.ai.assets.read"] }, { permissions: ["workspace.ai.execute"] }, { enabled: false }, { preview: { ...safePreview(), modelExecutionConfigured: false } }, ...[401, 403, 404, 409, 503].map(previewError => ({ previewError }))]) {
    const f = fixture({ state }); await f.prepare(); await f.store.confirmSubmit(); assert.equal(f.state.counters.posts, 0); assert.equal(f.store.ready(), false); f.store.dispose();
  }
  for (const space of ["foreign", "../space"]) { const f = fixture(); await f.store.start(space); assert.equal(f.store.getSnapshot().context, null); assert.equal(f.state.counters.posts, 0); assert.ok(!f.state.calls.some(c => c.path.includes("personal-agents"))); f.store.dispose(); }
  const f = fixture({ state: { submitError: 409 } }); await f.prepare(); await f.store.confirmSubmit(); assert.equal(f.store.getSnapshot().preview, null); assert.equal(f.store.getSnapshot().journal.status, "unconfirmed"); await f.store.confirmSubmit(); assert.equal(f.state.counters.posts, 1); f.store.dispose();
});
test("401/403/404/410/503 recovery never guesses a different owner/space or retries POST", async () => {
  for (const recoveryError of [401, 403, 404, 410, 503]) {
    const storage = memoryStorage(); storage.setItem(personalJournalKey("owner"), encode(journalEntry()));
    const f = fixture({ storage, state: { recoveryError } }); await f.store.start("space"); await f.store.confirmSubmit();
    assert.equal(f.state.counters.posts, 0); assert.equal(f.store.getSnapshot().run, null); assert.equal(parsePersonalJournal(storage.getItem(personalJournalKey("owner")), "owner")[0].key, "original-key-001");
    assert.ok(f.state.calls.filter(c => c.path.includes("run-requests")).every(c => c.workspaceId === "space" && c.path.endsWith("original-key-001")));
    if ([401, 403].includes(recoveryError)) { assert.equal(f.store.getSnapshot().context, null); assert.equal(f.store.getSnapshot().preview, null); }
    f.store.dispose();
  }
});
test("unknown stays reserved; expired and purged are distinct; no new task from unknown", async () => {
  for (const content of ["available", "expired", "purged"]) {
    const storage = memoryStorage(), run = result("unknown"); storage.setItem(personalJournalKey("owner"), encode(journalEntry({ runId: run.id, status: "unknown" })));
    const ref = { ...reference(run), ...(content === "expired" ? { expiresAt: "2026-11-05T00:01:00.000Z", contentAvailable: false } : content === "purged" ? { contentAvailable: false } : {}) };
    const f = fixture({ storage, state: { admitted: new Map([["original-key-001", run]]), reference: ref } }); await f.store.start("space"); await f.store.newTask(); await f.store.confirmSubmit();
    assert.equal(f.state.counters.posts, 0); assert.equal(f.store.getSnapshot().journal.status, "unknown"); assert.equal(f.store.getSnapshot().contentState, content); if (content !== "available") assert.equal(f.state.counters.reads, 0); f.store.dispose();
  }
});
test("safe terminal new task is deliberate, removes exact entry by CAS and requires new preview+input+review", async () => {
  const f = fixture(); await f.prepare(); await f.store.confirmSubmit(); await f.store.newTask(); assert.equal(f.store.getSnapshot().run, null); assert.equal(f.store.getSnapshot().confirmation, false); assert.deepEqual(f.store.getSnapshot().input, {});
  await f.store.confirmSubmit(); assert.equal(f.state.counters.posts, 1); assert.equal(f.store.getSnapshot().preview.revision, 2); f.store.dispose();
});
test("changed revision on lifecycle re-entry requires explicit fresh preview and review; never switches source silently", async () => {
  const f = fixture(); await f.prepare(); assert.equal(f.store.getSnapshot().confirmation, true); f.store.dispose();
  f.state.preview = { ...safePreview(), revision: 3, modelCode: "new-model" }; await f.store.start("space");
  assert.equal(f.store.getSnapshot().preview, null); assert.equal(f.store.getSnapshot().previewIssue.kind, "stale"); assert.equal(f.store.getSnapshot().confirmation, false);
  await f.store.confirmSubmit(); assert.equal(f.state.counters.posts, 0); await f.store.refreshPreview();
  assert.equal(f.store.getSnapshot().preview.revision, 3); assert.deepEqual(f.store.getSnapshot().input, {}); assert.equal(f.store.getSnapshot().confirmation, false); f.store.dispose();
});
test("reload principal and explicit space are resolved before touching a scoped journal", async () => {
  const storage = memoryStorage(); storage.setItem(personalJournalKey("owner"), encode(journalEntry()));
  const f = fixture({ storage, state: { member: "new-member" } }); await f.store.start("space");
  assert.equal(f.state.counters.recovery, 0); assert.equal(f.store.getSnapshot().journal, null); assert.equal(f.store.getSnapshot().principal.id, "new-member");
  assert.ok(storage.getItem(personalJournalKey("owner"))); f.store.dispose();
  const g = fixture({ storage }); await g.store.start("other"); assert.equal(g.state.counters.recovery, 0); assert.equal(g.store.getSnapshot().journal, null); g.store.dispose();
});
test("authorized existing result recovery needs only the actual result-read permission, without new admission grants", async () => {
  const storage = memoryStorage(), run = result(); storage.setItem(personalJournalKey("owner"), encode(journalEntry({ runId: run.id, status: "succeeded" })));
  const f = fixture({ storage, state: { permissions: ["workspace.ai.read"], admitted: new Map([["original-key-001", run]]), previewError: 503 } });
  await f.store.start("space"); assert.equal(f.store.getSnapshot().run.output, run.output); assert.equal(f.store.getSnapshot().preview, null); assert.equal(f.store.ready(), false); assert.equal(f.state.counters.posts, 0);
  assert.ok(!f.state.calls.some(c => c.path.includes("personal-agents"))); f.store.dispose();
});
test("late recovery success/rejection after a real scope epoch change cannot expose content or rewrite original journal", async () => {
  for (const reject of [false, true]) {
    const storage = memoryStorage(), run = result(); storage.setItem(personalJournalKey("owner"), encode(journalEntry({ runId: run.id, status: "succeeded" })));
    const entered = deferred(), release = deferred(); let once = true;
    const f = fixture({ storage, state: { admitted: new Map([["original-key-001", run]]), onRequest: async path => { if (path.includes("run-requests") && once) { once = false; entered.resolve(); await release.promise; } } } });
    const pending = f.store.start("space"); await entered.promise; const raw = storage.getItem(personalJournalKey("owner")); await f.store.selectWorkspace("other");
    if (reject) release.resolve(Promise.reject(new Error("late rejection"))); else release.resolve(); await pending;
    assert.equal(f.store.getSnapshot().workspaceId, "other"); assert.equal(f.store.getSnapshot().run, null); assert.equal(storage.getItem(personalJournalKey("owner")), raw); assert.equal(f.state.counters.posts, 0); f.store.dispose();
  }
});
test("foreign run/recovery identity and post-response CAS conflicts never publish output", async () => {
  const f = fixture({ state: { run: { ...result(), agentCode: `personal:${otherAgent}` } } }); await f.prepare(); await f.store.confirmSubmit();
  assert.equal(f.store.getSnapshot().run, null); assert.equal(f.store.getSnapshot().issue.kind, "invalid-response"); assert.equal(f.store.getSnapshot().journal.status, "unconfirmed"); f.store.dispose();
  const g = fixture(); await g.prepare(); g.state.afterAdmit = async () => { g.storage.setItem(personalJournalKey("owner"), encode(journalEntry({ key: "noncooperating-key" }))); };
  await g.store.confirmSubmit(); assert.equal(g.state.counters.posts, 1); assert.equal(g.store.getSnapshot().run, null); assert.equal(g.store.getSnapshot().storageBlocked, true); assert.equal(parsePersonalJournal(g.storage.getItem(personalJournalKey("owner")), "owner")[0].key, "noncooperating-key"); g.store.dispose();
});
test("polling is GET-only, bounded, pause/resume and scope invalidation cancel its callbacks", async () => {
  let scheduled = [], removed = [];
  const f = fixture({ state: { run: result("running") }, store: { maxPolls: 2, schedule: fn => { scheduled.push(fn); return scheduled.length; }, unschedule: id => removed.push(id) } });
  await f.prepare(); await f.store.confirmSubmit(); assert.equal(scheduled.length, 0); f.store.resumePolling(); assert.equal(scheduled.length, 1);
  scheduled[0](); await until(() => !f.store.getSnapshot().busy); assert.equal(scheduled.length, 2); scheduled[1](); await until(() => !f.store.getSnapshot().busy);
  assert.equal(f.store.getSnapshot().pollPaused, true); assert.equal(f.state.counters.posts, 1); assert.equal(f.state.counters.recovery, 2);
  f.store.resumePolling(); f.store.pausePolling(); assert.ok(removed.length > 0); const calls = f.state.calls.length; f.store.dispose(); scheduled.at(-1)(); await tick(); assert.equal(f.state.calls.length, calls);
});
test("retention deadline removes cached output without a POST; old expiry callbacks cannot affect another scope", async () => {
  const deadlines = []; let time = Date.parse(createdAt);
  const run = { ...result(), expiresAt: new Date(time + 1000).toISOString() };
  const f = fixture({ state: { run }, store: { now: () => time, scheduleExpiry: (fn, ms) => { deadlines.push({ fn, ms }); return deadlines.length; }, unscheduleExpiry: () => {} } });
  await f.prepare(); await f.store.confirmSubmit(); assert.equal(f.store.getSnapshot().run.output, run.output); assert.equal(deadlines[0].ms, 1000);
  time += 1000; deadlines[0].fn(); assert.equal(f.store.getSnapshot().run, null); assert.equal(f.store.getSnapshot().contentState, "expired"); assert.equal(f.store.getSnapshot().reference.contentAvailable, false); assert.equal(f.state.counters.posts, 1);
  await f.store.selectWorkspace("other"); const snapshot = f.store.getSnapshot(); deadlines[0].fn(); assert.equal(f.store.getSnapshot(), snapshot); f.store.dispose();
});
test("actual compiled ClientApi uses synthetic loopback HTTP with opaque workspace header and no URL plaintext", async () => {
  const seen = [], server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c); seen.push({ method: req.method, url: req.url, workspace: req.headers["x-aij-workspace-id"], body: Buffer.concat(chunks).toString() });
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ success: true, data: req.method === "POST" ? result() : req.url.includes("run-preview") ? safePreview() : reference(result()), message: "ok" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const api = createClientApi(() => `http://127.0.0.1:${server.address().port}`);
    await createPersonalAgentRunPreviewsClient(api).preview("space", agentId, 2);
    await createPersonalAgentRunsClient(api).submit("space", agentId, { input: { question: "PRIVATE_INPUT" }, idempotencyKey: "original-key", expectedRevision: 2 });
    await createAiRunRecoveryClient(api).recoverRequest("space", "original-key");
    assert.equal(seen.filter(c => c.method === "POST").length, 1); assert.ok(seen.every(c => c.workspace === "space" && !c.url.includes("PRIVATE_INPUT")));
    assert.deepEqual(Object.keys(JSON.parse(seen[1].body)).sort(), ["expectedRevision", "idempotencyKey", "input"]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
