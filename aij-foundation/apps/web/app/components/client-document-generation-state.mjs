// Private page RAM only. Transport, source authority and the single durable journal are injected.
const AUTH = ['memberId', 'workspaceId', 'roleId', 'roleCode', 'sessionGeneration', 'permissions', 'validationKey'];
const SOURCE = [...AUTH, 'documentId', 'revision', 'bodySha256', 'sectionId', 'start', 'end', 'sectionSha256'];
const DOC = ['format', 'indexFormat', 'documentId', 'revision', 'bodySha256', 'sectionId', 'start', 'end', 'sectionSha256'];
const REF = ['format', 'document', 'agentId', 'agentVersionId', 'agentRevision', 'agentPublicationEpoch', 'catalogVersion',
  'modelCode', 'modelRevision', 'instructionSha256', 'inputSha256', 'maximumEstimatedCostNanos'];
const READ = ['workspace.documents.read', 'workspace.ai.read', 'workspace.ai.assets.read'];
const EXECUTE = [...READ, 'workspace.documents.manage', 'workspace.ai.execute'];
const AVAILABILITY = ['unchecked', 'ready', 'unpublished', 'incompatible', 'not_configured', 'unavailable'];
const STATUSES = ['queued', 'running', 'succeeded', 'failed', 'unknown'];
const EMPTY = Object.freeze([]);
class Invalid extends Error {}
const check = v => { if (!v) throw new Invalid('无法安全核对当前来源或任务，请明确重新预览或查回。'); };
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const opaque = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const uuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const integer = (v, min = 1, max = 2147483647) => Number.isInteger(v) && !Object.is(v, -0) && v >= min && v <= max;
const instructionOK = v => typeof v === 'string' && v.length <= 2000 && Boolean(v.trim());
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (v, list) => { check(v && !Array.isArray(v) && Reflect.ownKeys(v).length === list.length && list.every(k => Object.hasOwn(v, k))); return v; };

// Snapshot descriptors recursively, never evaluate an injected getter or retain mutable port data.
function snapshot(value, depth = 0) {
  check(depth < 16);
  if (value === null || ['string', 'boolean', 'number'].includes(typeof value)) return value;
  check(value && typeof value === 'object');
  const proto = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (Array.isArray(value)) {
    check(proto === Array.prototype && integer(descriptors.length?.value, 0, 1024) && own.length === descriptors.length.value + 1);
    const result = [];
    for (let i = 0; i < descriptors.length.value; i++) {
      const d = descriptors[i]; check(d?.enumerable && Object.hasOwn(d, 'value'));
      result.push(snapshot(d.value, depth + 1));
    }
    return Object.freeze(result);
  }
  check((proto === Object.prototype || proto === null) && own.length <= 64);
  const result = {};
  for (const name of own) {
    const d = descriptors[name]; check(typeof name === 'string' && name !== '__proto__' && d.enumerable && Object.hasOwn(d, 'value'));
    Object.defineProperty(result, name, { value: snapshot(d.value, depth + 1), enumerable: true });
  }
  return Object.freeze(result);
}
function auth(raw, source = false) {
  const v = keys(snapshot(raw), source ? SOURCE : AUTH);
  check([v.memberId, v.workspaceId, v.roleId, v.roleCode, v.sessionGeneration, v.validationKey].every(x => typeof x === 'string' && x.length > 0 && x.length <= 2048));
  check(Array.isArray(v.permissions) && v.permissions.length <= 500 && v.permissions.every(x => typeof x === 'string' && /^[a-z][A-Za-z0-9.:-]{0,127}$/.test(x)) && new Set(v.permissions).size === v.permissions.length);
  const a = Object.fromEntries(AUTH.map(k => [k, k === 'permissions' ? Object.freeze([...v.permissions].sort()) : v[k]]));
  if (source) {
    check(uuid(v.documentId) && integer(v.revision, 1, 200) && hex(v.bodySha256) && hex(v.sectionSha256) &&
      /^section-(?:0|[1-9][0-9]{0,2})$/.test(v.sectionId) && Number(v.sectionId.slice(8)) <= 127 &&
      integer(v.start, 0, 65535) && integer(v.end, 1, 65536) && v.end > v.start && v.end - v.start <= 2000);
    for (const k of SOURCE.slice(AUTH.length)) a[k] = v[k];
  }
  return Object.freeze(a);
}
function verified(raw, expectedAuth) {
  const v = keys(snapshot(raw), ['pin', 'document', 'index']), pin = auth(v.pin, true);
  check(equal(auth(Object.fromEntries(AUTH.map(k => [k, pin[k]]))), expectedAuth));
  const d = keys(v.document, ['id', 'code', 'name', 'revision', 'createdAt', 'updatedAt', 'body']);
  const i = keys(v.index, ['format', 'documentId', 'revision', 'bodySha256', 'bodyLength', 'bodyByteLength', 'sections']);
  check(d.id === pin.documentId && d.revision === pin.revision && typeof d.body === 'string' && d.body.length <= 65536 &&
    i.format === 'aij-plain-sections-v1' && i.documentId === d.id && i.revision === d.revision && i.bodySha256 === pin.bodySha256 &&
    i.bodyLength === d.body.length && i.bodyByteLength === new TextEncoder().encode(d.body).length && i.bodyByteLength <= 65536 &&
    Array.isArray(i.sections) && i.sections.length >= 1 && i.sections.length <= 128);
  let cursor = 0;
  for (const [n, s] of i.sections.entries()) {
    keys(s, ['id', 'index', 'title', 'level', 'start', 'end']);
    check(s.id === `section-${n}` && s.index === n && typeof s.title === 'string' && [...s.title].length >= 1 && [...s.title].length <= 256 &&
      integer(s.level, 0, 6) && s.start === cursor && integer(s.end, s.start + 1, d.body.length));
    for (const at of [s.start, s.end]) {
      if (at > 0 && at < d.body.length) {
        const before = d.body.charCodeAt(at - 1), after = d.body.charCodeAt(at);
        check(!(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) &&
          !(before === 13 && after === 10) && (before === 10 || before === 13));
      }
    }
    cursor = s.end;
  }
  check(cursor === d.body.length);
  const s = i.sections.find(s => s.id === pin.sectionId);
  check(s && s.start === pin.start && s.end === pin.end && Boolean(d.body.slice(s.start, s.end).trim()));
  const document = Object.freeze(Object.fromEntries(['id', 'code', 'name', 'revision', 'createdAt', 'updatedAt', 'body'].map(k => [k, d[k]])));
  const sections = Object.freeze(i.sections.map(s => Object.freeze(Object.fromEntries(['id', 'index', 'title', 'level', 'start', 'end'].map(k => [k, s[k]])))));
  const index = Object.freeze(Object.fromEntries(['format', 'documentId', 'revision', 'bodySha256', 'bodyLength', 'bodyByteLength', 'sections'].map(k => [k, k === 'sections' ? sections : i[k]])));
  return Object.freeze({ pin, document, index });
}
function canonicalRef(raw) {
  const v = keys(snapshot(raw), REF), d = keys(v.document, DOC);
  check(v.format === 'aij-document-generation-v1' && d.format === 'aij-document-section-source-v1' && d.indexFormat === 'aij-plain-sections-v1' &&
    uuid(d.documentId) && integer(d.revision, 1, 200) && hex(d.bodySha256) && hex(d.sectionSha256) &&
    typeof d.sectionId === 'string' && /^section-(?:0|[1-9][0-9]{0,2})$/.test(d.sectionId) && Number(d.sectionId.slice(8)) <= 127 &&
    integer(d.start, 0, 65535) && integer(d.end, 1, 65536) && d.end > d.start && d.end - d.start <= 2000 &&
    uuid(v.agentId) && v.agentId[14] === '4' && opaque(v.agentVersionId) &&
    [v.agentRevision, v.agentPublicationEpoch, v.catalogVersion, v.modelRevision].every(x => integer(x)) &&
    typeof v.modelCode === 'string' && /^[a-z][a-z0-9-]{1,62}$/.test(v.modelCode) && hex(v.instructionSha256) && hex(v.inputSha256) &&
    typeof v.maximumEstimatedCostNanos === 'string' && /^(?:0|[1-9][0-9]{0,18})$/.test(v.maximumEstimatedCostNanos) && BigInt(v.maximumEstimatedCostNanos) <= 9223372036854775807n);
  return Object.freeze(Object.fromEntries(REF.map(k => [k, k === 'document' ? Object.freeze(Object.fromEntries(DOC.map(n => [n, d[n]]))) : v[k]])));
}
function sourceMatches(ref, pin) { return ['documentId', 'revision', 'bodySha256', 'sectionId', 'start', 'end', 'sectionSha256'].every(k => ref.document[k] === pin[k]); }
function choice(raw) {
  const v = keys(snapshot(raw), ['id', 'revision', 'name']);
  check(uuid(v.id) && v.id[14] === '4' && integer(v.revision) && typeof v.name === 'string' && v.name.length > 0 && v.name.length <= 512);
  return v;
}
const owner = pin => Object.freeze({ memberId: pin.memberId, workspaceId: pin.workspaceId });
function entry(raw, expectedOwner) {
  if (raw === null) return null;
  const v = keys(snapshot(raw), ['memberId', 'workspaceId', 'agentId', 'revision', 'key', 'digest', 'runId', 'status', 'family', 'origin', 'attempted']);
  const origin = canonicalRef(v.origin);
  check(v.memberId === expectedOwner.memberId && v.workspaceId === expectedOwner.workspaceId && v.family === 'document-generation' && v.attempted === true &&
    v.agentId === origin.agentId && v.revision === origin.agentRevision && typeof v.key === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(v.key) &&
    hex(v.digest) && (v.runId === null || opaque(v.runId)) && ['unconfirmed', ...STATUSES].includes(v.status));
  return Object.freeze({ ...v, origin });
}
function identity(v, origin, runId) {
  check(opaque(v.id) && (!runId || v.id === runId) && v.agentCode === `personal:${origin.agentId}` && STATUSES.includes(v.status) &&
    v.budgetStatus === (v.status === 'succeeded' ? 'settled' : v.status === 'failed' ? 'released' : 'reserved'));
  for (const s of [v.createdAt, v.expiresAt]) check(typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s);
  check(v.createdAt < v.expiresAt);
}
function envelope(raw, expectedRef, runId) {
  const v = keys(snapshot(raw), ['run', 'origin']), origin = canonicalRef(v.origin);
  check(equal(origin, expectedRef));
  const r = keys(v.run, ['id', 'agentCode', 'status', 'output', 'failureCode', 'estimatedCostNanos', 'budgetStatus', 'imageAssetId', 'createdAt', 'expiresAt']);
  identity(r, origin, runId);
  check(r.imageAssetId === null && (r.status === 'succeeded' ? typeof r.output === 'string' && r.output.length <= 64000 : r.output === null) &&
    (['failed', 'unknown'].includes(r.status) ? opaque(r.failureCode) : r.failureCode === null) && typeof r.estimatedCostNanos === 'string' &&
    /^(?:0|[1-9][0-9]{0,18})$/.test(r.estimatedCostNanos) && BigInt(r.estimatedCostNanos) <= 9223372036854775807n && (r.status !== 'failed' || r.estimatedCostNanos === '0'));
  return Object.freeze({ run: r, origin });
}
function recovery(raw, e) {
  const v = keys(snapshot(raw), ['request', 'origin', 'documentCurrent']), origin = canonicalRef(v.origin);
  check(equal(origin, e.origin) && typeof v.documentCurrent === 'boolean');
  const r = keys(v.request, ['id', 'agentCode', 'status', 'budgetStatus', 'createdAt', 'expiresAt', 'contentAvailable']);
  identity(r, origin, e.runId); check(typeof r.contentAvailable === 'boolean');
  return Object.freeze({ ...v, origin });
}
const metadata = v => Object.freeze({ origin: v.origin, run: Object.freeze({ ...v.run, output: null }) });
const blank = () => ({ contextKey: null, busy: false, allowed: EMPTY, source: null, agents: EMPTY, hasNextAgents: false, agentId: '', instruction: '',
  availability: 'unchecked', preview: null, confirmation: false, acknowledged: false, run: null, recovery: null, recoveryPending: false, issue: '', notice: '' });
const quoteClear = { preview: null, confirmation: false, acknowledged: false, run: null, recovery: null };

export function createDocumentGenerationController({ scope, assets, api, journal, timeoutMs = 8000, now = () => Date.now() }) {
  check(integer(timeoutMs, 1, 60000) && typeof now === 'function');
  let bindings = { scope, assets, api, journal }, context = null, epoch = 0, disposed = false, abort = new AbortController();
  let state = Object.freeze(blank()), cursor = null, pages = 0, pending = false, journalBlocked = false, unsubscribeJournal;
  const listeners = new Set();
  function peek() {
    if (!bindings.scope.active()) return null;
    const raw = bindings.scope.peekAuth(); if (raw === null) return null;
    const a = auth(raw), saved = bindings.scope.peekSaved();
    return Object.freeze({ auth: a, saved: saved === null ? null : verified(saved, a) });
  }
  function sameContext(a, b) { return a && b && equal(a.auth, b.auth) && equal(a.saved, b.saved); }
  function emit() { for (const f of [...listeners]) f(); }
  function invalidate() { epoch++; abort.abort(); abort = new AbortController(); }
  function clear() {
    invalidate(); context = null; cursor = null; pages = 0; pending = false; journalBlocked = false;
    state = Object.freeze(blank()); emit();
  }
  function current() {
    if (disposed || !context) return false;
    try { return Boolean(sameContext(context, peek())); } catch { return false; }
  }
  function guard() { if (current()) return true; if (context) clear(); return false; }
  function journalEntry() { return entry(bindings.journal.getSnapshot(owner(context.auth)), owner(context.auth)); }
  const permissions = list => Boolean(context && list.every(p => context.auth.permissions.includes(p)));
  function readableOrigin() {
    const v = state.recovery?.origin ?? state.run?.origin;
    return Boolean(context?.saved && v && sourceMatches(v, context.saved.pin) && state.recovery?.documentCurrent !== false);
  }
  function allowed() {
    if (!context || state.busy || !permissions(READ)) return EMPTY;
    const actions = ['recover'];
    if (pending) actions.push('acknowledge');
    const result = state.recovery?.request ?? state.run?.run;
    if (readableOrigin() && result?.status === 'succeeded' && result.budgetStatus === 'settled' && Date.parse(result.expiresAt) > now() &&
      state.recovery?.request.contentAvailable !== false) actions.push('read');
    if (context.saved && !pending && !journalBlocked) {
      actions.push('agents', 'agent', 'instruction');
      if (cursor !== null && pages < 20) actions.push('nextAgents');
      if (state.availability === 'ready' && state.agentId && instructionOK(state.instruction)) {
        actions.push('preview');
        if (permissions(EXECUTE) && state.preview?.modelExecutionConfigured) {
          actions.push('confirm');
          if (state.confirmation && state.acknowledged) actions.push('submit');
        }
      }
    }
    return Object.freeze(actions);
  }
  function publish(patch = {}) {
    if (!guard()) return;
    state = Object.freeze({ ...state, ...patch, recoveryPending: pending });
    state = Object.freeze({ ...state, allowed: allowed() }); emit();
  }
  function syncJournal() {
    if (!guard()) return;
    try { pending = Boolean(journalEntry()) || pending; }
    catch { journalBlocked = true; }
    publish();
  }
  function attach() { unsubscribeJournal = bindings.journal.subscribe(syncJournal); }
  attach();
  function expire() {
    if (state.run?.run.output !== null && state.run && Date.parse(state.run.run.expiresAt) <= now()) publish({ run: metadata(state.run), notice: '结果已过期，仅保留任务元数据。' });
  }
  function getSnapshot() { if (guard()) expire(); return state; }
  function ticket() {
    const t = { epoch, context, bindings, signal: abort.signal };
    t.live = () => {
      if (t.epoch !== epoch || t.signal.aborted || t.bindings !== bindings || !current()) {
        if (t.epoch === epoch && context) clear();
        throw new DOMException('Scope changed', 'AbortError');
      }
    };
    t.wait = fn => {
      t.live();
      return new Promise((resolve, reject) => {
        const call = new AbortController();
        let settled = false, timer;
        const finish = (fn, value) => {
          if (settled) return; settled = true; clearTimeout(timer); t.signal.removeEventListener('abort', cancel); fn(value);
        };
        const cancel = () => { call.abort(); finish(reject, new DOMException('Scope changed', 'AbortError')); };
        t.signal.addEventListener('abort', cancel, { once: true });
        timer = setTimeout(() => { call.abort(); finish(reject, new Invalid('操作超时；若已提交，仅按原标识查回。')); }, timeoutMs);
        Promise.resolve().then(() => { t.live(); call.signal.throwIfAborted(); return fn(call.signal); }).then(value => {
          try { t.live(); call.signal.throwIfAborted(); finish(resolve, value); } catch (error) { finish(reject, error); }
        }, error => finish(reject, error));
      });
    };
    t.hash = async text => {
      t.live(); const bytes = new TextEncoder().encode(text);
      const digest = await t.wait(() => globalThis.crypto.subtle.digest('SHA-256', bytes)); t.live();
      return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    };
    return t;
  }
  async function action(name, fn) {
    if (!guard()) return;
    expire(); if (!state.allowed.includes(name)) return;
    const t = ticket(); publish({ busy: true, issue: '', notice: '' });
    try { t.live(); await fn(t); t.live(); }
    catch (error) {
      if (t.epoch !== epoch || !current()) { if (t.epoch === epoch && context) clear(); return; }
      const status = Object.getOwnPropertyDescriptor(error ?? {}, 'status')?.value;
      if ([401, 403, 404].includes(status)) {
        // Parent clears synchronously. Recheck the ticket around that callback, since it can replace this scope.
        t.live();
        try { t.bindings.scope.onScopeRejected(status); }
        finally { if (t.epoch === epoch && bindings === t.bindings && !disposed) clear(); }
        return;
      }
      publish({ ...quoteClear, issue: status === 410 ? '原请求已不可读取，仍保留原任务锁。' : status === 409 ? '来源或报价已变化，请重新明确预览。' : '无法安全完成操作；若已提交，仅按原标识查回。' });
    } finally { if (t.epoch === epoch && current()) publish({ busy: false }); }
  }
  async function verify(t, mode) {
    t.live(); check(t.context.saved && permissions(mode === 'execute' ? EXECUTE : READ));
    const value = await t.wait(signal => t.bindings.scope.verifySource(t.context.saved.pin, mode, signal)); t.live();
    const v = verified(value, t.context.auth); check(equal(v, t.context.saved));
    const bodyHash = await t.hash(v.document.body); t.live();
    const sectionHash = await t.hash(v.document.body.slice(v.pin.start, v.pin.end)); t.live();
    check(bodyHash === v.pin.bodySha256 && sectionHash === v.pin.sectionSha256);
    return v;
  }
  async function verifyRecovery(t) {
    t.live(); check(permissions(READ));
    const value = await t.wait(signal => t.bindings.scope.verifyRecovery(owner(t.context.auth), signal)); t.live();
    check(equal(auth(value), t.context.auth));
  }
  async function inspect(t, selected) {
    const value = await t.wait(signal => t.bindings.assets.inspect(owner(t.context.auth), selected.id, signal)); t.live();
    const v = keys(snapshot(value), ['agent', 'availability']), a = choice(v.agent);
    check(equal(a, selected) && AVAILABILITY.includes(v.availability));
    return v.availability;
  }
  function selectedAgent() { return state.agents.find(a => a.id === state.agentId); }
  async function quote(t, mode) {
    const selected = selectedAgent(), instruction = state.instruction;
    check(selected && instructionOK(instruction));
    await verify(t, mode); t.live();
    check(await inspect(t, selected) === 'ready'); t.live();
    const p = t.context.saved.pin;
    const raw = await t.wait(signal => t.bindings.api.preview(p.workspaceId, { documentId: p.documentId, expectedRevision: p.revision,
      bodySha256: p.bodySha256, sectionId: p.sectionId, agentId: selected.id, agentRevision: selected.revision, instruction }, signal)); t.live();
    const v = keys(snapshot(raw), ['origin', 'inputFields', 'modelExecutionConfigured']), origin = canonicalRef(v.origin);
    check(typeof v.modelExecutionConfigured === 'boolean' && equal(v.inputFields, ['source', 'instruction']) && sourceMatches(origin, p) &&
      origin.agentId === selected.id && origin.agentRevision === selected.revision);
    const digest = await t.hash(instruction); t.live(); check(digest === origin.instructionSha256);
    await verify(t, mode); t.live(); check(!pending && !journalBlocked);
    return Object.freeze({ origin, inputFields: Object.freeze(['source', 'instruction']), modelExecutionConfigured: v.modelExecutionConfigured });
  }
  async function loadAgents(next) {
    await action(next ? 'nextAgents' : 'agents', async t => {
      check(typeof next === 'boolean'); const after = next ? cursor : null;
      const raw = await t.wait(signal => t.bindings.assets.list(owner(t.context.auth), after, signal)); t.live();
      const v = keys(snapshot(raw), ['items', 'nextCursor']);
      check(Array.isArray(v.items) && v.items.length <= 50 && (v.nextCursor === null || uuid(v.nextCursor)));
      const items = v.items.map(choice); let previous = after;
      const existing = next ? state.agents : EMPTY;
      for (const a of items) { check((previous === null || a.id > previous) && !existing.some(e => e.id === a.id)); previous = a.id; }
      check(v.nextCursor === null || items.length > 0 && v.nextCursor === previous && (after === null || v.nextCursor > after));
      pages = next ? pages + 1 : 1; cursor = v.nextCursor;
      publish({ ...quoteClear, agents: Object.freeze([...existing, ...items]), hasNextAgents: cursor !== null && pages < 20,
        agentId: '', availability: 'unchecked' });
    });
  }
  async function selectAgent(id) {
    await action('agent', async t => {
      const selected = state.agents.find(a => a.id === id); check(selected);
      publish({ ...quoteClear, agentId: id, availability: 'unchecked' });
      const availability = await inspect(t, selected); t.live(); publish({ availability });
    });
  }
  function setInstruction(value) {
    if (!guard() || !permissions(READ) || !context.saved || pending || journalBlocked) return;
    check(typeof value === 'string'); invalidate(); publish({ ...quoteClear, busy: false, instruction: value, issue: '', notice: '' });
  }
  async function preview() { await action('preview', async t => { publish(quoteClear); const v = await quote(t, 'preview'); t.live(); publish({ preview: v }); }); }
  async function requestConfirmation() {
    await action('confirm', async t => {
      const original = state.preview; publish({ confirmation: false, acknowledged: false });
      const fresh = await quote(t, 'execute'); t.live(); check(fresh.modelExecutionConfigured && equal(fresh, original));
      publish({ confirmation: true, acknowledged: false });
    });
  }
  function setAcknowledged(value) {
    if (!guard() || state.busy || !state.confirmation || typeof value !== 'boolean') return;
    publish({ acknowledged: value });
  }
  function cancelConfirmation() {
    if (!guard()) return;
    invalidate(); publish({ busy: false, confirmation: false, acknowledged: false });
  }
  async function confirmSubmit() {
    await action('submit', async t => {
      const original = state.preview, instruction = state.instruction;
      publish({ confirmation: false, acknowledged: false, run: null, recovery: null });
      const fresh = await quote(t, 'execute'); t.live(); check(fresh.modelExecutionConfigured && equal(fresh, original));
      const digest = await t.hash(JSON.stringify(['personal-document-generation-v1', canonicalRef(original.origin), instruction])); t.live();
      let sent = false; pending = true; publish();
      const raw = await t.wait(signal => t.bindings.journal.submitOnce({ owner: owner(t.context.auth), origin: original.origin, digest }, async key => {
        t.live(); signal.throwIfAborted(); check(!sent && typeof key === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(key)); sent = true;
        const result = await t.wait(sendSignal => t.bindings.api.submit(t.context.auth.workspaceId, { origin: original.origin, instruction, idempotencyKey: key }, sendSignal));
        t.live(); signal.throwIfAborted(); return envelope(result, original.origin);
      }, signal)); t.live();
      const e = journalEntry(); check(e && equal(e.origin, original.origin) && e.digest === digest);
      if (raw !== null) {
        const result = envelope(raw, original.origin, e.runId); check(e.runId === result.run.id && e.status === result.run.status);
        publish({ ...quoteClear, run: metadata(result), notice: '已提交一次；结果仅在主动读取并核验当前来源后显示。' });
      } else publish({ ...quoteClear, notice: '原任务仍待确认，仅按原标识查回，不会重新提交。' });
    });
  }
  async function recover() {
    await action('recover', async t => {
      publish({ ...quoteClear });
      const raw = await t.wait(signal => t.bindings.journal.load(owner(t.context.auth), signal)); t.live();
      const e = entry(raw, owner(t.context.auth));
      if (!e) { check(!pending); publish({ notice: '没有待查回的原任务。' }); return; }
      pending = true; publish(); await verifyRecovery(t); t.live();
      const result = recovery(await t.wait(signal => t.bindings.api.recover(t.context.auth.workspaceId, e.key, signal)), e); t.live();
      await verifyRecovery(t); t.live();
      const bound = entry(await t.wait(signal => t.bindings.journal.bind(e, { runId: result.request.id, status: result.request.status, origin: result.origin }, signal)), owner(t.context.auth)); t.live();
      check(bound && bound.key === e.key && bound.digest === e.digest && equal(bound.origin, e.origin) && bound.runId === result.request.id && bound.status === result.request.status);
      publish({ recovery: result, notice: result.documentCurrent ? '已查回原任务元数据；可用结果仍需主动读取。' : '已查回原任务元数据；原文档来源已变化，禁止读取正文。' });
    });
  }
  async function readResult() {
    await action('read', async t => {
      const ref = state.recovery?.origin ?? state.run?.origin, id = state.recovery?.request.id ?? state.run?.run.id;
      check(ref && id && readableOrigin()); publish({ run: state.run ? metadata(state.run) : null });
      await verify(t, 'read'); t.live(); check(sourceMatches(ref, t.context.saved.pin));
      const result = envelope(await t.wait(signal => t.bindings.api.read(t.context.auth.workspaceId, id, signal)), ref, id); t.live();
      await verify(t, 'read'); t.live();
      const available = result.run.status === 'succeeded' && result.run.budgetStatus === 'settled' && Date.parse(result.run.expiresAt) > now();
      publish({ run: available ? result : metadata(result), notice: available ? '已核验当前来源并读取结果；尚未应用或保存。' : '仅显示任务元数据，结果未知、不可用或已过期。' });
    });
  }
  async function acknowledgeRecovery() {
    await action('acknowledge', async t => {
      const e = journalEntry(); check(e);
      const accepted = await t.wait(signal => t.bindings.journal.acknowledgeTerminal(e, async () => {
        t.live(); signal.throwIfAborted(); await verifyRecovery(t); t.live();
        const result = recovery(await t.wait(readSignal => t.bindings.api.recover(t.context.auth.workspaceId, e.key, readSignal)), e); t.live();
        await verifyRecovery(t); t.live(); signal.throwIfAborted();
        check(result.request.status === 'succeeded' && result.request.budgetStatus === 'settled' || result.request.status === 'failed' && result.request.budgetStatus === 'released');
        return result;
      }, signal)); t.live();
      check(accepted === true && journalEntry() === null); pending = false;
      publish({ ...quoteClear, notice: '原任务安全终态已重新核验并确认，私有结果已清除。' });
    });
  }
  return Object.freeze({
    getSnapshot, subscribe(notify) { listeners.add(notify); return () => listeners.delete(notify); },
    setContext(contextKey) {
      if (disposed) return;
      check(contextKey === null || typeof contextKey === 'string' && contextKey.length > 0);
      if (contextKey === null) { clear(); return; }
      let next; try { next = peek(); } catch { clear(); return; }
      if (!next) { clear(); return; }
      if (state.contextKey === contextKey && sameContext(context, next)) return;
      clear(); context = next;
      const s = next.saved, pin = s?.pin, section = s?.index.sections.find(s => s.id === pin.sectionId);
      state = Object.freeze({ ...blank(), contextKey, source: s ? Object.freeze({ documentId: pin.documentId, revision: pin.revision,
        bodySha256: pin.bodySha256, sectionId: pin.sectionId, sectionTitle: section.title, start: pin.start, end: pin.end,
        text: s.document.body.slice(pin.start, pin.end) }) : null });
      syncJournal();
    },
    setBindings(next) {
      keys(next, ['scope', 'assets', 'api', 'journal']);
      if (disposed || Object.keys(next).every(k => next[k] === bindings[k])) return;
      clear(); unsubscribeJournal?.(); bindings = { scope: next.scope, assets: next.assets, api: next.api, journal: next.journal }; attach();
    },
    loadAgents, selectAgent, setInstruction, preview, requestConfirmation, setAcknowledged, cancelConfirmation,
    confirmSubmit, recover, acknowledgeRecovery, readResult,
    suspend() { if (disposed) return; clear(); bindings.journal.suspend(); },
    dispose() { if (disposed) return; disposed = true; clear(); unsubscribeJournal?.(); bindings.journal.suspend(); listeners.clear(); }
  });
}
