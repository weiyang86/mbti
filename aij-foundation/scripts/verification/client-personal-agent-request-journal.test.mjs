// Offline candidate: actual new storage/CAS implementation + Node's native exclusive Web Locks.
// StorageLike is a synchronous in-memory backend; browser/API/DB acceptance remains with root.
import test from "node:test";
import assert from "node:assert/strict";
import {
  PersonalRequestJournalError, personalJournalKey, parsePersonalJournal, samePersonalJournalEntry,
  findPersonalJournalEntry, createPersonalRequestJournalStorage, createDocumentGenerationJournal
} from "../../apps/web/app/components/client-personal-agent-request-journal.mjs";

const memberId = "member-1", workspaceId = "space-1", owner = { memberId, workspaceId };
const agentId = "22345678-1234-4234-8234-123456789abc", otherAgent = "32345678-1234-4234-8234-123456789abc";
const digest = "d".repeat(64), bucket = personalJournalKey(memberId), guard = () => true;
const signal = () => new AbortController().signal;
const docSelector = { family: "document-generation", workspaceId };
const agentSelector = { family: "personal-agent", workspaceId, agentId };
const encode = entries => JSON.stringify({ version: 1, entries });
function origin() {
  return { format: "aij-document-generation-v1", document: { format: "aij-document-section-source-v1", indexFormat: "aij-plain-sections-v1",
    documentId: "12345678-1234-4234-8234-123456789abc", revision: 7, bodySha256: "b".repeat(64), sectionId: "section-0", start: 0, end: 12, sectionSha256: "c".repeat(64) },
  agentId, agentVersionId: "version-1", agentRevision: 3, agentPublicationEpoch: 4, catalogVersion: 5, modelCode: "text-model", modelRevision: 6,
  instructionSha256: "a".repeat(64), inputSha256: "e".repeat(64), maximumEstimatedCostNanos: "9223372036854775807" };
}
function legacy(patch = {}) { return { memberId, workspaceId, agentId, revision: 3, key: "original-key-001", digest, runId: null, status: "unconfirmed", ...patch }; }
function generation(patch = {}) { return { ...legacy(), family: "document-generation", origin: origin(), attempted: true, ...patch }; }
function envelope(ref = origin(), status = "succeeded") {
  return { origin: ref, run: { id: "run-1", agentCode: `personal:${ref.agentId}`, status, budgetStatus: status === "succeeded" ? "settled" : status === "failed" ? "released" : "reserved",
    output: status === "succeeded" ? "OUTPUT_PRIVATE_SENTINEL" : null, failureCode: ["failed", "unknown"].includes(status) ? "UNAVAILABLE" : null,
    estimatedCostNanos: status === "failed" ? "0" : "123", imageAssetId: null, createdAt: "2026-11-09T00:00:00.000Z", expiresAt: "2026-11-16T00:00:00.000Z" } };
}
function recovery(ref = origin(), status = "succeeded") {
  const { id, agentCode, budgetStatus, createdAt, expiresAt } = envelope(ref, status).run;
  return { request: { id, agentCode, status, budgetStatus, createdAt, expiresAt, contentAvailable: false }, origin: ref, documentCurrent: false };
}
function memory(initial = []) {
  const values = new Map(initial.length ? [[bucket, encode(initial)]] : []), writes = [], reads = [];
  return { values, writes, reads, getItem(name) { reads.push(name); return values.get(name) ?? null; }, setItem(name, raw) { writes.push([name, raw]); values.set(name, raw); } };
}
const nativeLock = (name, fn) => globalThis.navigator.locks.request(name, { mode: "exclusive" }, fn);
function fixture(initial = [], options = {}) {
  const storage = options.storage ?? memory(initial), lockNames = [];
  const withRecoveryLock = Object.hasOwn(options, "withRecoveryLock") ? options.withRecoveryLock : (name, fn) => { lockNames.push(name); return nativeLock(name, fn); };
  const config = { journalStorage: () => storage, withRecoveryLock, makeKey: () => "generated-key-001", ...options.config };
  return { storage, lockNames, config, journal: createDocumentGenerationJournal(config), facade: createPersonalRequestJournalStorage(config) };
}
const intent = (ref = origin()) => ({ owner: { ...owner }, origin: ref, digest });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await tick(); } assert.fail("barrier not reached"); }
const safeError = e => e instanceof PersonalRequestJournalError && !e.message.includes("PRIVATE");
function getter(target, field, seen) { Object.defineProperty(target, field, { enumerable: true, get() { seen.calls++; throw Error("PRIVATE getter"); } }); }
const bound = (patch = {}) => generation({ runId: "run-1", status: "succeeded", ...patch });

// Compatibility and routing are asserted through the new owner, not a copied CAS implementation.
test("legacy eight-key entries, original bucket/version and family-specific uniqueness remain intact", () => {
  assert.equal(bucket, "aij.client.personal-agent.pending.v1:member-1");
  const list = [legacy(), generation(), generation({ workspaceId: "other-space" }), legacy({ agentId: otherAgent })];
  assert.deepEqual(parsePersonalJournal(encode(list), memberId), list);
  assert.deepEqual(Object.keys(parsePersonalJournal(encode([legacy()]), memberId)[0]), Object.keys(legacy()));
  assert.deepEqual(findPersonalJournalEntry(list, agentSelector), legacy());
  assert.deepEqual(findPersonalJournalEntry(list, docSelector), generation());
  assert.equal(findPersonalJournalEntry([generation()], agentSelector), null);
  assert.equal(findPersonalJournalEntry([legacy()], docSelector), null);
  for (const pair of [[legacy(), legacy()], [generation(), generation({ agentId: otherAgent, origin: { ...origin(), agentId: otherAgent } })]]) {
    assert.throws(() => parsePersonalJournal(encode(pair), memberId), safeError);
  }
});
test("strict schema, cap, raw size, entry shape, status and member validation fail closed", () => {
  assert.deepEqual(parsePersonalJournal(null, memberId), []);
  for (const raw of ["", "[]", "{}", "a".repeat(16385), encode([legacy({ memberId: "foreign" })]), encode([legacy({ revision: 0 })]),
    encode([legacy({ key: "short" })]), encode([legacy({ digest: "A".repeat(64) })]), encode([legacy({ runId: "run-1" })]), encode([legacy({ status: "unknown" })]),
    encode([legacy({ output: "PRIVATE" })]), encode([generation({ attempted: false })]), encode([generation({ family: "personal-agent" })]),
    JSON.stringify({ version: 2, entries: [] }), JSON.stringify({ version: 1, entries: [], body: "PRIVATE" }),
    encode(Array.from({ length: 33 }, (_, i) => legacy({ workspaceId: `space-${i}` }))),
    encode([legacy()]).replace('"revision":3', '"__proto__":{},"revision":3')]) assert.throws(() => parsePersonalJournal(raw, memberId), safeError);
  assert.throws(() => parsePersonalJournal(null, "../foreign"), safeError);
});
test("every W24 ref constraint is enforced without coercion", () => {
  const patches = [r => { r.format = "future"; }, r => { r.agentId = otherAgent; }, r => { r.agentVersionId = "../version"; }, r => { r.agentRevision = 4; },
    r => { r.agentPublicationEpoch = -0; }, r => { r.catalogVersion = 2147483648; }, r => { r.modelCode = "Text"; }, r => { r.modelRevision = 1.5; },
    r => { r.instructionSha256 = "A".repeat(64); }, r => { r.inputSha256 = "x"; }, r => { r.maximumEstimatedCostNanos = "01"; }, r => { r.maximumEstimatedCostNanos = "9223372036854775808"; },
    r => { r.document.format = "future"; }, r => { r.document.indexFormat = "future"; }, r => { r.document.documentId = "not-id"; }, r => { r.document.revision = 201; },
    r => { r.document.bodySha256 = null; }, r => { r.document.sectionId = "section-01"; }, r => { r.document.sectionId = "section-128"; },
    r => { r.document.start = -1; }, r => { r.document.end = r.document.start; }, r => { r.document.end = 2001; }, r => { r.document.start = 65536; r.document.end = 65537; },
    r => { r.document.sectionSha256 = 1; }, r => { r.document.body = "PRIVATE"; }, r => { r.instructions = "PRIVATE"; }];
  for (const mutate of patches) { const ref = origin(); mutate(ref); assert.throws(() => parsePersonalJournal(encode([generation({ origin: ref })]), memberId), safeError); }
  assert.throws(() => parsePersonalJournal(encode([generation()]).replace('"start":0', '"start":-0'), memberId), safeError);
  const ref = origin(); ref.document.documentId = ref.document.documentId.toUpperCase();
  assert.equal(parsePersonalJournal(encode([generation({ origin: ref })]), memberId).length, 1);
});
test("descriptor/prototype/hidden/symbol checks never execute input getters at any depth", async () => {
  let sends = 0;
  for (const place of ["intent", "owner", "origin", "document"]) {
    const raw = intent(), target = place === "intent" ? raw : place === "document" ? raw.origin.document : raw[place];
    const field = place === "intent" ? "digest" : place === "owner" ? "memberId" : place === "origin" ? "agentId" : "start", seen = { calls: 0 };
    getter(target, field, seen); const f = fixture();
    await assert.rejects(f.journal.submitOnce(raw, async () => { sends++; return envelope(); }, signal()), safeError); assert.equal(seen.calls, 0); assert.equal(f.storage.writes.length, 0);
    for (const change of [v => Object.defineProperty(v, "hidden", { value: true }), v => { v[Symbol("PRIVATE")] = true; }, v => Object.setPrototypeOf(v, { PRIVATE: true })]) {
      const value = intent(), object = place === "intent" ? value : place === "document" ? value.origin.document : value[place]; change(object);
      await assert.rejects(f.journal.submitOnce(value, async () => { sends++; return envelope(); }, signal()), safeError);
    }
  }
  for (const field of ["family", "memberId", "origin", "key"]) {
    const value = generation(), seen = { calls: 0 }; getter(value, field, seen);
    assert.equal(samePersonalJournalEntry(value, generation()), false);
    assert.throws(() => findPersonalJournalEntry([value], docSelector), safeError);
    const f = fixture(); assert.throws(() => f.facade.compareExchange(memberId, docSelector, null, value, guard), safeError); assert.equal(seen.calls, 0);
  }
  const sparse = new Array(1), accessors = [generation()], seen = { calls: 0 }; getter(accessors, "0", seen);
  for (const list of [sparse, accessors, Object.assign([generation()], { extra: true })]) assert.throws(() => findPersonalJournalEntry(list, docSelector), safeError);
  assert.equal(seen.calls, 0); assert.equal(sends, 0);
});
test("full equality ignores insertion order and includes all entry/ref/section metadata", () => {
  const a = generation(), reversed = Object.fromEntries(Object.entries(a).reverse());
  reversed.origin = Object.fromEntries(Object.entries(a.origin).reverse()); reversed.origin.document = Object.fromEntries(Object.entries(a.origin.document).reverse());
  assert.equal(samePersonalJournalEntry(a, reversed), true);
  for (const patch of [{ memberId: "other" }, { workspaceId: "other" }, { key: "different-key" }, { digest: "f".repeat(64) }, { runId: "run-1", status: "running" }, { attempted: false }]) assert.equal(samePersonalJournalEntry(a, { ...a, ...patch }), false);
  const changes = [r => { r.agentVersionId = "other-version"; }, r => { r.agentPublicationEpoch++; }, r => { r.catalogVersion++; }, r => { r.modelCode = "other-model"; },
    r => { r.modelRevision++; }, r => { r.instructionSha256 = "f".repeat(64); }, r => { r.inputSha256 = "f".repeat(64); }, r => { r.maximumEstimatedCostNanos = "0"; },
    r => { r.document.documentId = otherAgent; }, r => { r.document.revision++; }, r => { r.document.bodySha256 = "f".repeat(64); }, r => { r.document.sectionId = "section-1"; },
    r => { r.document.start++; }, r => { r.document.end++; }, r => { r.document.sectionSha256 = "f".repeat(64); }];
  for (const mutate of changes) { const b = generation(); mutate(b.origin); assert.equal(samePersonalJournalEntry(a, b), false); }
  assert.equal(samePersonalJournalEntry(legacy(), generation()), false); assert.equal(samePersonalJournalEntry(null, null), true);
});
test("actual CAS preserves the other family and space byte-for-byte in each entry's JSON shape", async () => {
  const other = generation({ workspaceId: "other-space", origin: Object.fromEntries(Object.entries(origin()).reverse()) });
  const initial = [legacy(), generation(), other], f = fixture(initial), untouched = [initial[0], other].map(JSON.stringify);
  await f.facade.locked(memberId, guard, () => f.facade.compareExchange(memberId, docSelector, initial[1], bound(), guard));
  const after = f.facade.read(memberId, guard);
  assert.deepEqual(after.filter(e => e.workspaceId !== workspaceId || !e.family).map(JSON.stringify), untouched);
  await f.facade.locked(memberId, guard, () => f.facade.compareExchange(memberId, agentSelector, initial[0], null, guard));
  assert.equal(f.facade.read(memberId, guard).length, 2); assert.deepEqual(findPersonalJournalEntry(f.facade.read(memberId, guard), docSelector), bound());
  assert.deepEqual(new Set(f.storage.writes.map(([name]) => name)), new Set([bucket])); assert.ok(f.lockNames.every(name => name === bucket));
  assert.throws(() => f.facade.compareExchange(memberId, agentSelector, bound(), null, guard), safeError);
  assert.throws(() => f.facade.compareExchange(memberId, docSelector, bound(), generation({ key: "new-bypass-key" }), guard), safeError);
});
test("complete CAS rejects changed expected identity/ref/status and a foreign replacement without any write", () => {
  const stored = bound(), f = fixture([stored]);
  for (const patch of [{ digest: "f".repeat(64) }, { key: "different-key" }, { runId: "other-run" }, { status: "running" }, { origin: { ...origin(), catalogVersion: 6 } }]) {
    assert.throws(() => f.facade.compareExchange(memberId, docSelector, { ...stored, ...patch }, null, guard), safeError);
  }
  for (const replacement of [bound({ memberId: "other" }), bound({ workspaceId: "other" }), bound({ runId: "other-run" }), bound({ origin: { ...origin(), modelRevision: 9 } })]) {
    assert.throws(() => f.facade.compareExchange(memberId, docSelector, stored, replacement, guard), safeError);
  }
  assert.equal(f.storage.writes.length, 0); assert.equal(f.storage.getItem(bucket), encode([stored]));
});
test("missing/denied/nonentering locks and corrupt/failed/silent/rewritten storage produce zero sends", async () => {
  for (const mode of ["missing-lock", "denied-lock", "nonentering-lock", "corrupt", "oversize", "get", "set", "silent", "readback"]) {
    const storage = memory(), get = storage.getItem.bind(storage), set = storage.setItem.bind(storage); let sends = 0;
    if (["corrupt", "oversize"].includes(mode)) storage.values.set(bucket, mode === "corrupt" ? "{}" : "a".repeat(16385));
    storage.getItem = name => { if (mode === "get") throw Error("PRIVATE storage"); return get(name); };
    storage.setItem = (name, raw) => { if (mode === "set") throw Error("PRIVATE quota"); if (mode === "silent") return; set(name, mode === "readback" ? raw + " " : raw); };
    const f = fixture([], { storage, ...(["missing-lock", "denied-lock", "nonentering-lock"].includes(mode) ? { withRecoveryLock: mode === "missing-lock" ? undefined : mode === "denied-lock" ? async () => { throw Error("denied"); } : async () => null } : {}) });
    await assert.rejects(f.journal.submitOnce(intent(), async () => { sends++; return envelope(); }, signal()), safeError); assert.equal(sends, 0, mode);
  }
});
test("32-entry cap and serialized size exhaustion never delete entries to admit a send", async () => {
  const sizeEntries = [];
  while (encode([...sizeEntries, generation({ workspaceId: `other-${sizeEntries.length}` })]).length <= 16384) sizeEntries.push(generation({ workspaceId: `other-${sizeEntries.length}` }));
  assert.ok(encode([...sizeEntries, generation({ key: "generated-key-001" })]).length > 16384);
  for (const initial of [Array.from({ length: 32 }, (_, i) => legacy({ workspaceId: `other-${i}` })), sizeEntries]) {
    const f = fixture(initial), before = f.storage.getItem(bucket); let sends = 0;
    assert.equal(parsePersonalJournal(before, memberId).length, initial.length);
    await assert.rejects(f.journal.submitOnce(intent(), async () => { sends++; return envelope(); }, signal()), safeError);
    assert.equal(sends, 0); assert.equal(f.storage.getItem(bucket), before);
  }
});
test("two journal instances hold the same native exclusive Web Lock: durable attempted precedes exactly one send", async () => {
  assert.equal(typeof globalThis.navigator.locks.request, "function");
  const f = fixture([legacy(), generation({ workspaceId: "other-space" })]), second = createDocumentGenerationJournal({ ...f.config, makeKey: () => "second-key-001" });
  const gate = deferred(); let sends = 0;
  const send = async k => { sends++; assert.equal(k, "generated-key-001"); const pending = findPersonalJournalEntry(f.facade.read(memberId, guard), docSelector); assert.equal(pending.attempted, true); assert.equal(pending.status, "unconfirmed"); return gate.promise; };
  const a = f.journal.submitOnce(intent(), send, signal()); await until(() => sends === 1);
  const altered = origin(); altered.document.documentId = otherAgent; altered.agentId = otherAgent; altered.agentRevision++;
  const b = second.submitOnce(intent(altered), send, signal()); await tick(); assert.equal(sends, 1);
  gate.resolve(envelope()); const [result, rejectedNew] = await Promise.all([a, b]);
  assert.equal(result.run.id, "run-1"); assert.equal(rejectedNew, null); assert.equal(sends, 1);
  assert.equal(second.getSnapshot(owner).key, "generated-key-001"); assert.equal(f.facade.read(memberId, guard).length, 3);
  assert.ok(f.lockNames.every(name => name === bucket)); assert.equal(f.storage.values.size, 1);
  const raw = f.storage.getItem(bucket); assert.ok(!raw.includes("OUTPUT_PRIVATE_SENTINEL"));
});
test("double call in one instance and pending entries in all states block a new key", async () => {
  const f = fixture(); let sends = 0;
  await Promise.all([f.journal.submitOnce(intent(), async () => { sends++; return envelope(); }, signal()), f.journal.submitOnce(intent(), async () => { sends++; return envelope(); }, signal())]);
  assert.equal(sends, 1);
  for (const status of ["unconfirmed", "queued", "running", "unknown", "succeeded", "failed"]) {
    const entry = generation({ status, runId: status === "unconfirmed" ? null : "run-1" }), g = fixture([entry]);
    assert.equal(await g.journal.submitOnce(intent(), async () => { sends++; return envelope(); }, signal()), null);
    assert.deepEqual(g.journal.getSnapshot(owner), entry); assert.equal(g.storage.writes.length, 0);
  }
  assert.equal(sends, 1);
});
test("lost response retains the original key; a fresh instance loads and binds only metadata with no resubmit", async () => {
  const f = fixture(); let sends = 0;
  await assert.rejects(f.journal.submitOnce(intent(), async () => { sends++; throw Error("lost response"); }, signal()));
  const raw = f.storage.getItem(bucket), second = createDocumentGenerationJournal(f.config);
  assert.equal(second.getSnapshot(owner), null); await tick(); assert.equal(sends, 1); assert.equal(f.storage.getItem(bucket), raw);
  const loaded = await second.load(owner, signal()); assert.equal(loaded.status, "unconfirmed"); assert.equal(loaded.attempted, true);
  const next = await second.bind(loaded, { runId: "run-1", status: "unknown", origin: origin() }, signal()); assert.equal(next.status, "unknown");
  assert.equal(await second.submitOnce(intent(), async () => { sends++; return envelope(); }, signal()), null); assert.equal(sends, 1);
  assert.equal(second.getSnapshot({ memberId: "another", workspaceId }), null);
});
test("abort before storage prevents writes; abort during persistence keeps attempted but zero sends", async () => {
  for (const phase of ["before", "write", "notify"]) {
    const abort = new AbortController(), f = fixture(); let sends = 0;
    if (phase === "before") abort.abort();
    if (phase === "write") { const set = f.storage.setItem.bind(f.storage); f.storage.setItem = (name, raw) => { set(name, raw); abort.abort(); }; }
    if (phase === "notify") f.journal.subscribe(() => abort.abort());
    await assert.rejects(f.journal.submitOnce(intent(), async () => { sends++; return envelope(); }, abort.signal)); assert.equal(sends, 0);
    if (phase === "before") assert.equal(f.storage.values.size, 0);
    else assert.equal(parsePersonalJournal(f.storage.getItem(bucket), memberId)[0].attempted, true);
  }
});
test("abort/timeout bound ignored send promises and late success or rejection never binds or resends", async () => {
  for (const mode of ["abort-success", "abort-reject", "timeout-success"]) {
    const f = fixture(), gate = deferred(), abort = new AbortController(); let sends = 0;
    const timeout = mode.startsWith("timeout"), sig = timeout ? AbortSignal.timeout(25) : abort.signal;
    const pending = f.journal.submitOnce(intent(), () => { sends++; return gate.promise; }, sig); await until(() => sends === 1);
    const before = f.storage.getItem(bucket), keepAlive = setTimeout(() => {}, 1000);
    if (!timeout) abort.abort(); await assert.rejects(pending); clearTimeout(keepAlive);
    if (mode.endsWith("reject")) gate.reject(Error("late rejection")); else gate.resolve(envelope()); await tick(); await tick();
    assert.equal(f.storage.getItem(bucket), before); assert.equal(f.journal.getSnapshot(owner).status, "unconfirmed");
    assert.equal(await f.journal.submitOnce(intent(), async () => { sends++; return envelope(); }, signal()), null); assert.equal(sends, 1);
  }
});
test("suspend cancels the epoch and clears RAM, never storage; explicit load is the only recovery", async () => {
  const f = fixture(), gate = deferred(); let sends = 0, notices = 0;
  const off = f.journal.subscribe(() => notices++);
  const pending = f.journal.submitOnce(intent(), () => { sends++; return gate.promise; }, signal()); await until(() => sends === 1);
  const before = f.storage.getItem(bucket); f.journal.suspend(); f.journal.suspend(); await assert.rejects(pending);
  assert.equal(f.journal.getSnapshot(owner), null); gate.resolve(envelope()); await tick(); assert.equal(f.storage.getItem(bucket), before);
  assert.equal(f.journal.getSnapshot(owner), null); const loaded = await f.journal.load(owner, signal()); assert.equal(loaded.status, "unconfirmed");
  assert.equal(f.journal.getSnapshot(owner), f.journal.getSnapshot(owner)); assert.equal(notices, 4); off(); f.journal.suspend(); assert.equal(notices, 4);
});
test("aborted queued native lock cannot enter or send when it is eventually released", async () => {
  const gate = deferred(), entered = deferred(), held = nativeLock(bucket, async () => { entered.resolve(); await gate.promise; }); await entered.promise;
  const f = fixture(), abort = new AbortController(); let sends = 0;
  const pending = f.journal.submitOnce(intent(), async () => { sends++; return envelope(); }, abort.signal); abort.abort(); await assert.rejects(pending);
  gate.resolve(); await held; await tick(); await tick(); assert.equal(sends, 0); assert.equal(f.storage.values.size, 0);
});
test("bind snapshots before await, strictly matches origin/run, and uses a complete CAS", async () => {
  const f = fixture([generation()]), expected = generation(), m = { runId: "run-1", status: "running", origin: origin() };
  const pending = f.journal.bind(expected, m, signal()); expected.origin.catalogVersion++; m.origin.catalogVersion++; m.runId = "mutated";
  const saved = await pending; assert.equal(saved.runId, "run-1"); assert.equal(saved.origin.catalogVersion, 5); assert.equal(saved.status, "running");
  await assert.rejects(f.journal.bind(generation(), { runId: "run-1", status: "succeeded", origin: origin() }, signal()), safeError);
  for (const patch of [{ origin: { ...origin(), inputSha256: "f".repeat(64) } }, { runId: "other-run" }, { status: "unconfirmed" }, { output: "PRIVATE" }]) {
    await assert.rejects(f.journal.bind(saved, { runId: "run-1", status: "succeeded", origin: origin(), ...patch }, signal()), safeError);
  }
  assert.deepEqual(f.facade.read(memberId, guard), [saved]);
});
test("submit response mismatch or accessor leaves unconfirmed metadata and no private content", async () => {
  for (const mutate of [v => { v.origin.catalogVersion++; }, v => { v.run.agentCode = `personal:${otherAgent}`; }, v => { v.run.output = "a".repeat(64001); },
    v => { v.run.budgetStatus = "reserved"; }, v => { v.run.private = "PRIVATE"; }, v => { v.origin.document.sectionSha256 = "f".repeat(64); }]) {
    const f = fixture(), result = envelope(); mutate(result); let sends = 0;
    await assert.rejects(f.journal.submitOnce(intent(), async () => { sends++; return result; }, signal()), safeError);
    assert.equal(sends, 1); assert.equal(f.facade.read(memberId, guard)[0].status, "unconfirmed");
  }
  const f = fixture(), result = envelope(), seen = { calls: 0 }; getter(result.run, "output", seen);
  await assert.rejects(f.journal.submitOnce(intent(), async () => result, signal()), safeError); assert.equal(seen.calls, 0);
});
test("ACK always re-verifies safe terminal metadata and never uses cached succeeded as proof", async () => {
  const f = fixture([bound(), legacy(), generation({ workspaceId: "other-space" })]), expected = await f.journal.load(owner, signal()); let verifies = 0;
  for (const status of ["queued", "running", "unknown"]) {
    assert.equal(await f.journal.acknowledgeTerminal(expected, async () => { verifies++; return recovery(origin(), status); }, signal()), false);
    assert.equal(f.facade.read(memberId, guard).length, 3);
  }
  assert.equal(await f.journal.acknowledgeTerminal(expected, async () => { verifies++; return recovery(); }, signal()), true); assert.equal(verifies, 4);
  assert.equal(f.journal.getSnapshot(owner), null); assert.deepEqual(f.facade.read(memberId, guard), [legacy(), generation({ workspaceId: "other-space" })]);
});
test("ACK accepts failed/released and documentCurrent=false only with the exact bound run", async () => {
  for (const status of ["succeeded", "failed"]) {
    const f = fixture([bound({ status: "unknown" })]); let verifies = 0;
    assert.equal(await f.journal.acknowledgeTerminal(bound({ status: "unknown" }), async () => { verifies++; return recovery(origin(), status); }, signal()), true);
    assert.equal(verifies, 1); assert.deepEqual(f.facade.read(memberId, guard), []);
  }
  const f = fixture([generation()]); let verifies = 0;
  assert.equal(await f.journal.acknowledgeTerminal(generation(), async () => { verifies++; return recovery(); }, signal()), false);
  assert.equal(verifies, 1); assert.equal(f.facade.read(memberId, guard).length, 1);
});
test("ACK rejects mismatched metadata, invalid budgets, 401/403/404/410 and failed verify without deletion", async () => {
  for (const mode of ["origin", "run", "budget", "shape", "401", "403", "404", "410", "network"]) {
    const f = fixture([bound()]), before = f.storage.getItem(bucket), value = recovery();
    if (mode === "origin") value.origin.document.revision++;
    if (mode === "run") value.request.id = "other-run";
    if (mode === "budget") value.request.budgetStatus = "reserved";
    if (mode === "shape") value.request.output = "PRIVATE";
    await assert.rejects(f.journal.acknowledgeTerminal(bound(), async () => {
      if (/^\d+$/.test(mode)) throw { status: Number(mode) }; if (mode === "network") throw Error("lost response"); return value;
    }, signal()));
    assert.equal(f.storage.getItem(bucket), before); assert.equal(f.storage.writes.length, 0);
  }
});
test("ACK's second CAS detects concurrent metadata changes after the fresh verification", async () => {
  const f = fixture([bound()]), gate = deferred(), entered = deferred();
  const pending = f.journal.acknowledgeTerminal(bound(), async () => { entered.resolve(); return gate.promise; }, signal()); await entered.promise;
  // Simulate a storage writer outside the protocol, rather than mocking CAS.
  const changed = bound({ digest: "f".repeat(64) }); f.storage.values.set(bucket, encode([changed])); gate.resolve(recovery());
  await assert.rejects(pending, safeError); assert.equal(f.storage.getItem(bucket), encode([changed])); assert.equal(f.storage.writes.length, 0);
});
test("aborted/suspended ACK never deletes on a late verify success", async () => {
  for (const mode of ["abort", "suspend"]) {
    const f = fixture([bound()]), abort = new AbortController(), gate = deferred(), entered = deferred(), before = f.storage.getItem(bucket);
    const pending = f.journal.acknowledgeTerminal(bound(), async () => { entered.resolve(); return gate.promise; }, abort.signal); await entered.promise;
    if (mode === "abort") abort.abort(); else f.journal.suspend(); await assert.rejects(pending);
    gate.resolve(recovery()); await tick(); assert.equal(f.storage.getItem(bucket), before); assert.equal(f.storage.writes.length, 0);
  }
});
test("facade guard fences lock entry and every storage access before/after the operation", async () => {
  for (const phase of ["resolver", "read", "write", "readback", "lock-entry", "lock-exit"]) {
    const storage = memory([generation()]); let active = true, gets = 0; const get = storage.getItem.bind(storage), set = storage.setItem.bind(storage);
    storage.getItem = name => { const value = get(name); gets++; if (phase === "read" || phase === "readback" && gets === 2) active = false; return value; };
    storage.setItem = (name, raw) => { set(name, raw); if (phase === "write") active = false; };
    const facade = createPersonalRequestJournalStorage({ journalStorage: () => { if (phase === "resolver") active = false; return storage; },
      withRecoveryLock: async (name, fn) => { if (phase === "lock-entry") active = false; const value = await nativeLock(name, fn); if (phase === "lock-exit") active = false; return value; } });
    await assert.rejects(facade.locked(memberId, () => active, () => facade.compareExchange(memberId, docSelector, generation(), bound(), () => active)), e => e.name === "AbortError", phase);
    if (["resolver", "read", "lock-entry"].includes(phase)) assert.equal(storage.writes.length, 0, phase);
    if (phase === "resolver") assert.equal(storage.reads.length, 0);
  }
});
test("pre-send mismatch after persistence prevents dispatch, and post-send CAS conflict preserves the changed entry", async () => {
  for (const stage of ["before-send", "after-send"]) {
    const f = fixture(); let sends = 0, changed;
    const alter = () => {
      const stored = f.facade.read(memberId, guard)[0]; changed = { ...stored, digest: "f".repeat(64) }; f.storage.values.set(bucket, encode([changed]));
    };
    if (stage === "before-send") f.journal.subscribe(alter);
    await assert.rejects(f.journal.submitOnce(intent(), async () => { sends++; alter(); return envelope(); }, signal()), safeError);
    assert.equal(sends, stage === "before-send" ? 0 : 1); assert.equal(f.storage.getItem(bucket), encode([changed]));
  }
});
test("all original SDK run states bind metadata only and preserve the exact cost reference", async () => {
  for (const status of ["queued", "running", "succeeded", "failed", "unknown"]) {
    const f = fixture(); let sends = 0;
    const result = await f.journal.submitOnce(intent(), async () => { sends++; return envelope(origin(), status); }, signal());
    assert.equal(sends, 1); assert.equal(result.run.status, status);
    const saved = f.facade.read(memberId, guard)[0]; assert.equal(saved.runId, "run-1"); assert.equal(saved.status, status);
    assert.equal(saved.origin.maximumEstimatedCostNanos, "9223372036854775807"); assert.equal(Object.hasOwn(saved, "output"), false);
  }
});
