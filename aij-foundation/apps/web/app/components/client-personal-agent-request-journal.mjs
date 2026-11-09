// One metadata journal for both request families. Metadata never grants content access.
const ENTRY_KEYS = ["memberId", "workspaceId", "agentId", "revision", "key", "digest", "runId", "status"];
const GENERATION_KEYS = [...ENTRY_KEYS, "family", "origin", "attempted"];
const REF_KEYS = ["format", "document", "agentId", "agentVersionId", "agentRevision", "agentPublicationEpoch", "catalogVersion", "modelCode", "modelRevision", "instructionSha256", "inputSha256", "maximumEstimatedCostNanos"];
const SECTION_KEYS = ["format", "indexFormat", "documentId", "revision", "bodySha256", "sectionId", "start", "end", "sectionSha256"];
const STATUSES = ["unconfirmed", "queued", "running", "succeeded", "failed", "unknown"];
const opaque = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const key = v => typeof v === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(v);
const hash = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const agentId = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const integer = (v, min = 1, max = 2147483647) => Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max;
const cost = v => typeof v === "string" && /^(?:0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
const iso = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;

export class PersonalRequestJournalError extends Error {
  constructor() { super("Request recovery metadata could not be safely read or saved"); this.name = "PersonalRequestJournalError"; }
}
const requireValue = valid => { if (!valid) throw new PersonalRequestJournalError(); };

// Read own data descriptors only, before any await. Preserve insertion order in other entries.
function object(raw, keys) {
  try {
    requireValue(raw !== null && typeof raw === "object" && !Array.isArray(raw));
    const proto = Object.getPrototypeOf(raw), descriptors = Object.getOwnPropertyDescriptors(raw), own = Reflect.ownKeys(descriptors);
    requireValue((proto === Object.prototype || proto === null) && own.length === keys.length && own.every(k => typeof k === "string" && keys.includes(k)));
    const copy = {};
    for (const k of own) {
      const d = descriptors[k]; requireValue(d.enumerable && Object.hasOwn(d, "value"));
      Object.defineProperty(copy, k, { value: d.value, enumerable: true, writable: true, configurable: true });
    }
    return copy;
  } catch { throw new PersonalRequestJournalError(); }
}
function array(raw, max) {
  try {
    requireValue(Array.isArray(raw) && Object.getPrototypeOf(raw) === Array.prototype);
    const d = Object.getOwnPropertyDescriptors(raw), length = d.length.value;
    requireValue(integer(length, 0, max) && Reflect.ownKeys(d).length === length + 1);
    const copy = [];
    for (let i = 0; i < length; i++) {
      requireValue(d[i]?.enumerable && Object.hasOwn(d[i], "value")); copy.push(d[i].value);
    }
    return copy;
  } catch { throw new PersonalRequestJournalError(); }
}
function reference(raw) {
  const r = object(raw, REF_KEYS), d = object(r.document, SECTION_KEYS);
  requireValue(r.format === "aij-document-generation-v1" && agentId(r.agentId) && opaque(r.agentVersionId) &&
    integer(r.agentRevision) && integer(r.agentPublicationEpoch) && integer(r.catalogVersion) && integer(r.modelRevision) &&
    typeof r.modelCode === "string" && /^[a-z][a-z0-9-]{1,62}$/.test(r.modelCode) && hash(r.instructionSha256) && hash(r.inputSha256) && cost(r.maximumEstimatedCostNanos));
  requireValue(d.format === "aij-document-section-source-v1" && d.indexFormat === "aij-plain-sections-v1" &&
    typeof d.documentId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(d.documentId) &&
    integer(d.revision, 1, 200) && hash(d.bodySha256) && typeof d.sectionId === "string" && /^section-(?:0|[1-9][0-9]{0,2})$/.test(d.sectionId) && Number(d.sectionId.slice(8)) <= 127 &&
    integer(d.start, 0, 65536) && integer(d.end, 1, 65536) && d.start < d.end && d.end - d.start <= 2000 && hash(d.sectionSha256));
  r.document = Object.freeze(d); return Object.freeze(r);
}
function canonicalReference(r) {
  return REF_KEYS.map(k => k === "document" ? SECTION_KEYS.map(p => p === "documentId" ? r.document[p].toLowerCase() : r.document[p]) : r[k]);
}
const sameReference = (a, b) => JSON.stringify(canonicalReference(a)) === JSON.stringify(canonicalReference(b));
function entry(raw, memberId) {
  // Determine the shape by descriptors rather than reading family through a getter.
  let generation;
  try { generation = Object.hasOwn(Object.getOwnPropertyDescriptors(raw), "family"); } catch { throw new PersonalRequestJournalError(); }
  const e = object(raw, generation ? GENERATION_KEYS : ENTRY_KEYS);
  requireValue(opaque(e.memberId) && e.memberId === memberId && opaque(e.workspaceId) && agentId(e.agentId) && integer(e.revision) && key(e.key) && hash(e.digest) &&
    STATUSES.includes(e.status) && (e.status === "unconfirmed" ? e.runId === null : opaque(e.runId)));
  if (generation) {
    requireValue(e.family === "document-generation" && e.attempted === true);
    e.origin = reference(e.origin);
    requireValue(e.agentId === e.origin.agentId && e.revision === e.origin.agentRevision);
  }
  return Object.freeze(e);
}
function entries(raw, memberId) {
  requireValue(opaque(memberId));
  const result = array(raw, 32).map(e => entry(e, memberId));
  const identities = result.map(e => JSON.stringify(e.family === "document-generation" ? [e.family, e.workspaceId] : ["personal-agent", e.workspaceId, e.agentId]));
  requireValue(new Set(identities).size === result.length); return result;
}
export const personalJournalKey = memberId => `aij.client.personal-agent.pending.v1:${memberId}`;
export function parsePersonalJournal(raw, memberId) {
  requireValue(opaque(memberId));
  if (raw === null) return [];
  requireValue(typeof raw === "string" && raw.length <= 16384);
  let parsed; try { parsed = JSON.parse(raw); } catch { throw new PersonalRequestJournalError(); }
  const v = object(parsed, ["version", "entries"]); requireValue(v.version === 1);
  return entries(v.entries, memberId);
}
export function samePersonalJournalEntry(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return (a === null || a === undefined) && (b === null || b === undefined);
  try {
    // Snapshot before reading memberId, including invalid caller-provided entries.
    const aDescriptors = Object.getOwnPropertyDescriptors(a), member = aDescriptors.memberId;
    requireValue(member && Object.hasOwn(member, "value"));
    const x = entry(a, member.value), y = entry(b, member.value);
    return ENTRY_KEYS.every(k => x[k] === y[k]) && x.family === y.family && (x.family !== "document-generation" || x.attempted === y.attempted && sameReference(x.origin, y.origin));
  } catch { return false; }
}
function selector(raw) {
  let family; try { family = Object.getOwnPropertyDescriptor(raw, "family"); } catch { throw new PersonalRequestJournalError(); }
  requireValue(family && Object.hasOwn(family, "value"));
  const s = object(raw, family.value === "personal-agent" ? ["family", "workspaceId", "agentId"] : ["family", "workspaceId"]);
  requireValue(opaque(s.workspaceId) && (s.family === "document-generation" || s.family === "personal-agent" && agentId(s.agentId)));
  return Object.freeze(s);
}
const selected = (e, s) => e.workspaceId === s.workspaceId && (s.family === "document-generation" ? e.family === s.family : e.family === undefined && e.agentId === s.agentId);
export function findPersonalJournalEntry(rawEntries, rawSelector) {
  const s = selector(rawSelector), list = array(rawEntries, 32);
  // Each candidate is validated without invoking any entry getter.
  const valid = list.map(e => {
    let d; try { d = Object.getOwnPropertyDescriptor(e, "memberId"); } catch { throw new PersonalRequestJournalError(); }
    requireValue(d && Object.hasOwn(d, "value")); return entry(e, d.value);
  });
  const found = valid.filter(e => selected(e, s)); requireValue(found.length <= 1); return found[0] ?? null;
}
function current(guard) { if (typeof guard !== "function" || !guard()) throw new DOMException("Scope changed", "AbortError"); }
export function createPersonalRequestJournalStorage({ journalStorage, withRecoveryLock }) {
  requireValue(typeof journalStorage === "function");
  function access(memberId, guard, operation) {
    requireValue(opaque(memberId)); current(guard);
    let value;
    try { const storage = journalStorage(); current(guard); value = operation(storage, personalJournalKey(memberId)); }
    catch (e) { current(guard); if (e instanceof PersonalRequestJournalError) throw e; throw new PersonalRequestJournalError(); }
    current(guard); return value;
  }
  function read(memberId, guard) {
    const raw = access(memberId, guard, (storage, name) => storage.getItem(name));
    const result = parsePersonalJournal(raw, memberId); current(guard); return result;
  }
  async function locked(memberId, guard, fn) {
    requireValue(opaque(memberId) && typeof withRecoveryLock === "function" && typeof fn === "function"); current(guard);
    let entered = false;
    try {
      const result = await withRecoveryLock(personalJournalKey(memberId), async () => {
        requireValue(!entered); entered = true; current(guard);
        const value = await fn(); current(guard); return value;
      });
      current(guard); requireValue(entered); return result;
    } catch (e) { current(guard); if (entered) throw e; throw new PersonalRequestJournalError(); }
  }
  function compareExchange(memberId, rawSelector, rawExpected, rawReplacement, guard) {
    current(guard); const s = selector(rawSelector);
    const expected = rawExpected === null ? null : entry(rawExpected, memberId), replacement = rawReplacement === null ? null : entry(rawReplacement, memberId);
    requireValue((!expected || selected(expected, s)) && (!replacement || selected(replacement, s)));
    if (expected && replacement) {
      requireValue(["memberId", "workspaceId", "agentId", "revision", "key", "digest"].every(k => expected[k] === replacement[k]) && expected.family === replacement.family &&
        (!expected.runId || expected.runId === replacement.runId) && (expected.family !== "document-generation" || sameReference(expected.origin, replacement.origin)));
    }
    const list = read(memberId, guard), found = findPersonalJournalEntry(list, s);
    requireValue(samePersonalJournalEntry(found, expected));
    const next = list.filter(e => !selected(e, s)); if (replacement) next.push(replacement);
    const raw = JSON.stringify({ version: 1, entries: next }); parsePersonalJournal(raw, memberId); current(guard);
    access(memberId, guard, (storage, name) => storage.setItem(name, raw));
    const saved = access(memberId, guard, (storage, name) => storage.getItem(name));
    requireValue(saved === raw); current(guard); return true;
  }
  return Object.freeze({ read, locked, compareExchange });
}
function owner(raw) { const o = object(raw, ["memberId", "workspaceId"]); requireValue(opaque(o.memberId) && opaque(o.workspaceId)); return Object.freeze(o); }
const generationSelector = o => ({ family: "document-generation", workspaceId: o.workspaceId });
function generationEntry(raw) {
  let d; try { d = Object.getOwnPropertyDescriptor(raw, "memberId"); } catch { throw new PersonalRequestJournalError(); }
  requireValue(d && Object.hasOwn(d, "value")); const e = entry(raw, d.value); requireValue(e.family === "document-generation"); return e;
}
function metadata(raw, expected) {
  const m = object(raw, ["runId", "status", "origin"]), origin = reference(m.origin);
  requireValue(opaque(m.runId) && STATUSES.includes(m.status) && m.status !== "unconfirmed" && sameReference(origin, expected.origin) && (!expected.runId || expected.runId === m.runId));
  return Object.freeze({ ...expected, runId: m.runId, status: m.status });
}
function identity(raw, origin, recovery) {
  const r = object(raw, recovery ? ["id", "agentCode", "status", "budgetStatus", "createdAt", "expiresAt", "contentAvailable"] :
    ["id", "agentCode", "status", "output", "failureCode", "estimatedCostNanos", "budgetStatus", "imageAssetId", "createdAt", "expiresAt"]);
  requireValue(opaque(r.id) && r.agentCode === `personal:${origin.agentId}` && STATUSES.includes(r.status) && r.status !== "unconfirmed" &&
    r.budgetStatus === (r.status === "succeeded" ? "settled" : r.status === "failed" ? "released" : "reserved") && iso(r.createdAt) && iso(r.expiresAt) && r.createdAt < r.expiresAt);
  if (recovery) requireValue(typeof r.contentAvailable === "boolean");
  else requireValue(r.imageAssetId === null && (r.status === "succeeded" ? typeof r.output === "string" && r.output.length <= 64000 : r.output === null) &&
    (["failed", "unknown"].includes(r.status) ? opaque(r.failureCode) : r.failureCode === null) && cost(r.estimatedCostNanos) && (r.status !== "failed" || r.estimatedCostNanos === "0"));
  return Object.freeze(r);
}
function envelope(raw, expected) {
  const v = object(raw, ["run", "origin"]), origin = reference(v.origin); requireValue(sameReference(origin, expected.origin));
  const run = identity(v.run, origin, false); requireValue(!expected.runId || run.id === expected.runId); return Object.freeze({ run, origin });
}
function recovery(raw, expected) {
  const v = object(raw, ["request", "origin", "documentCurrent"]), origin = reference(v.origin);
  requireValue(sameReference(origin, expected.origin) && typeof v.documentCurrent === "boolean");
  const request = identity(v.request, origin, true); requireValue(!expected.runId || request.id === expected.runId); return Object.freeze({ request, origin, documentCurrent: v.documentCurrent });
}
function race(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}
export function createDocumentGenerationJournal({ journalStorage, withRecoveryLock, makeKey = () => globalThis.crypto.randomUUID() }) {
  const storage = createPersonalRequestJournalStorage({ journalStorage, withRecoveryLock }); requireValue(typeof makeKey === "function");
  const listeners = new Set(); let snapshot = null, epoch = 0, controller = new AbortController();
  function publish(value) { snapshot = value; for (const notify of listeners) { try { notify(); } catch { /* A view cannot undo a persisted request attempt. */ } } }
  function ticket(signal) {
    try { Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted").get.call(signal); } catch { throw new PersonalRequestJournalError(); }
    const version = epoch, combined = AbortSignal.any([signal, controller.signal]);
    return { signal: combined, guard: () => version === epoch && !combined.aborted };
  }
  function operate(o, t, fn) { current(t.guard); return race(storage.locked(o.memberId, t.guard, fn), t.signal); }
  function bindLocked(expected, m, t) {
    current(t.guard); const next = metadata(m, expected);
    storage.compareExchange(expected.memberId, generationSelector(expected), expected, next, t.guard); current(t.guard); publish(next); current(t.guard); return next;
  }
  function getSnapshot(rawOwner) { const o = owner(rawOwner); return snapshot?.memberId === o.memberId && snapshot.workspaceId === o.workspaceId ? snapshot : null; }
  async function load(rawOwner, signal) {
    const o = owner(rawOwner), t = ticket(signal);
    return operate(o, t, () => { const found = findPersonalJournalEntry(storage.read(o.memberId, t.guard), generationSelector(o)); current(t.guard); publish(found); current(t.guard); return found; });
  }
  async function submitOnce(rawIntent, send, signal) {
    const intent = object(rawIntent, ["owner", "origin", "digest"]), o = owner(intent.owner), origin = reference(intent.origin), digest = intent.digest;
    requireValue(hash(digest) && typeof send === "function"); const t = ticket(signal);
    return operate(o, t, async () => {
      const prior = findPersonalJournalEntry(storage.read(o.memberId, t.guard), generationSelector(o));
      if (prior) { current(t.guard); publish(prior); return null; }
      const attempted = entry({ ...o, agentId: origin.agentId, revision: origin.agentRevision, key: makeKey(), digest, runId: null, status: "unconfirmed", family: "document-generation", origin, attempted: true }, o.memberId);
      storage.compareExchange(o.memberId, generationSelector(o), null, attempted, t.guard); current(t.guard); publish(attempted); current(t.guard);
      requireValue(samePersonalJournalEntry(findPersonalJournalEntry(storage.read(o.memberId, t.guard), generationSelector(o)), attempted)); current(t.guard);
      const result = await race(Promise.resolve().then(() => { current(t.guard); return send(attempted.key); }), t.signal); current(t.guard);
      const decoded = envelope(result, attempted);
      bindLocked(attempted, { runId: decoded.run.id, status: decoded.run.status, origin: decoded.origin }, t); current(t.guard); return decoded;
    });
  }
  async function bind(rawExpected, rawMetadata, signal) {
    const expected = generationEntry(rawExpected), next = metadata(rawMetadata, expected), t = ticket(signal);
    return operate(expected, t, () => bindLocked(expected, { runId: next.runId, status: next.status, origin: next.origin }, t));
  }
  async function acknowledgeTerminal(rawExpected, verify, signal) {
    const expected = generationEntry(rawExpected), t = ticket(signal); requireValue(typeof verify === "function");
    return operate(expected, t, async () => {
      requireValue(samePersonalJournalEntry(findPersonalJournalEntry(storage.read(expected.memberId, t.guard), generationSelector(expected)), expected)); current(t.guard);
      const verified = recovery(await race(Promise.resolve().then(() => { current(t.guard); return verify(); }), t.signal), expected); current(t.guard);
      if (!expected.runId || verified.request.id !== expected.runId || !(verified.request.status === "succeeded" && verified.request.budgetStatus === "settled" || verified.request.status === "failed" && verified.request.budgetStatus === "released")) return false;
      storage.compareExchange(expected.memberId, generationSelector(expected), expected, null, t.guard); current(t.guard);
      if (samePersonalJournalEntry(snapshot, expected)) publish(null); current(t.guard); return true;
    });
  }
  return Object.freeze({ getSnapshot, subscribe(notify) { requireValue(typeof notify === "function"); listeners.add(notify); return () => listeners.delete(notify); }, load, submitOnce, bind, acknowledgeTerminal,
    suspend() { ++epoch; controller.abort(); controller = new AbortController(); publish(null); } });
}
