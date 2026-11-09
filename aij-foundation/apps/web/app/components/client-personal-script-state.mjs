// Private, mounted-panel RAM only. The original Skill/Script/Job/File services
// own authorization, immutable versions, execution and result integrity.
const ASSETS = "workspace.ai.assets.read";
const CREATE = ["workspace.ai.assets.manage", "workspace.ai.scripts.manage"];
const SOURCE = [ASSETS, "workspace.ai.scripts.manage"];
const EXECUTE = [ASSETS, "workspace.ai.execute", "workspace.ai.scripts.execute"];
const READ = [ASSETS, "workspace.ai.read", "workspace.ai.scripts.execute"];
const opaque = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v) && !["__proto__", "constructor", "prototype"].includes(v);
const uuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const record = v => v !== null && typeof v === "object" && !Array.isArray(v);
const revision = v => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const unicode = v => typeof v === "string" && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
const bytes = v => new TextEncoder().encode(v).length;
const scopeFields = ["memberId", "workspaceId", "skillId", "revision", "name", "instructions"];
export const samePersonalScriptScope = (a, b) => a && b ? scopeFields.every(k => a[k] === b[k]) : a === b;
function validScope(v) {
  return record(v) && [v.memberId, v.workspaceId, v.skillId].every(opaque) && revision(v.revision) &&
    unicode(v.name) && v.name.trim() === v.name && v.name.length > 0 && v.name.length <= 100 && !v.name.includes("\0") &&
    unicode(v.instructions) && v.instructions.trim().length > 0 && v.instructions.length <= 8000 && bytes(v.instructions) <= 32768 && !v.instructions.includes("\0");
}
export function validPersonalScriptSource(v) { return unicode(v) && v.length > 0 && !v.includes("\0") && bytes(v) <= 65536; }
/** Exactly one strict JSON document, including duplicate decoded keys, finite
 * numbers, Unicode, prototype keys, depth, entry and canonical byte bounds. */
export function parsePersonalScriptInput(raw) {
  if (!unicode(raw) || bytes(raw) > 16384) throw new TypeError("Invalid script JSON input");
  const stack = [];
  for (const token of raw.match(/"(?:\\[\s\S]|[^"\\])*"|[{}[\]:,]/g) ?? []) {
    const top = stack.at(-1);
    if (token === "{" || token === "[") stack.push({ keys: token === "{" ? new Set() : null, key: true });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === ":") { if (top) top.key = false; }
    else if (token === ",") { if (top) top.key = true; }
    else if (top?.keys && top.key) {
      const k = JSON.parse(token);
      if (top.keys.has(k)) throw new TypeError("Invalid script JSON input");
      top.keys.add(k);
    }
  }
  let entries = 0;
  function visit(v, depth) {
    if (depth > 16) throw new TypeError("Invalid script JSON input");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string" && unicode(v) || typeof v === "number" && Number.isFinite(v)) return;
    if (!record(v) && !Array.isArray(v)) throw new TypeError("Invalid script JSON input");
    const keys = Object.keys(v);
    if ((entries += keys.length) > 2048) throw new TypeError("Invalid script JSON input");
    for (const k of keys) {
      if (!unicode(k) || ["__proto__", "constructor", "prototype"].includes(k)) throw new TypeError("Invalid script JSON input");
      visit(v[k], depth + 1);
    }
  }
  const value = JSON.parse(raw); visit(value, 0);
  if (bytes(JSON.stringify(value)) > 16384) throw new TypeError("Invalid script JSON input");
  return value;
}
class Fence extends Error {}
const assert = v => { if (!v) throw new Fence(); };
const has = (auth, required) => Boolean(auth && required.every(p => auth.permissions.includes(p)));
const sameOwner = (a, b) => a && b && ["memberId", "workspaceId", "skillId"].every(k => a[k] === b[k]);
const fingerprint = a => JSON.stringify([a.memberId, a.workspaceId, a.workspaceCode, a.roleId, a.roleCode, a.sessionGeneration, [...a.permissions].sort()]);
const privateBlank = () => ({ source: "", input: "", versionId: "", runId: "", ref: null, run: null, output: "", download: null, versionReview: null, confirmation: null });
const initial = () => ({ ...privateBlank(), scope: null, auth: null, capability: null, busy: false, issue: null, notice: "", locked: false, pending: null });
export function personalScriptIssue(error) {
  const status = Number.isInteger(error?.status) ? error.status : 0;
  const messages = {
    400: "输入未通过校验，请检查 Python 源码与严格 JSON 输入。",
    401: "登录已失效，私有内容已清除。请重新登录后验证访问。",
    403: "当前成员、空间或权限不可用，私有内容已清除。请联系空间管理员。",
    404: "记录当前不可用或已删除；未确认写入仍锁定，只能核对原请求。",
    409: "当前 Skill 版本或配置已变化；内容已清除，请重新读取当前 Skill。",
    410: "原内容已过保留期，不能下载；未确认写入不会因此自动解锁。",
    503: "服务当前不可用。已有授权结果可在服务恢复后手动读取。"
  };
  return { status, message: error instanceof Fence ? "会话、角色、权限或当前 Skill 已变化；私有内容已清除，请重新验证。" :
    messages[status] ?? "请求未能确认。写入不会自动重试，请核对原请求；输入错误请检查 JSON 格式。" };
}

/** Inject the public SDK factories, never a second execution implementation.
 * A single opaque lock survives null scopes, blur and identity changes until
 * the original owner explicitly resolves it. Never key/unmount this store. */
export function createPersonalScriptState({ request: initialRequest, scriptsClientFactory, skillsClientFactory, onSkillChanged = () => {},
  makeKey = () => globalThis.crypto.randomUUID(), makeObjectURL = blob => URL.createObjectURL(blob), revokeObjectURL = url => URL.revokeObjectURL(url),
  now = () => Date.now(), timeoutMs = 8000 }) {
  let request = initialRequest, state = initial(), epoch = 0, controller = new AbortController(), lock = null, selected = null, expiryTimer = null, objectURL = null;
  const listeners = new Set();
  function publish(patch) {
    state = { ...state, ...patch, locked: lock !== null, pending: sameOwner(lock, (patch.scope === undefined ? state.scope : patch.scope)) ? { ...lock } : null };
    listeners.forEach(fn => fn());
  }
  function clearDownload() {
    if (objectURL !== null) revokeObjectURL(objectURL);
    objectURL = null;
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  function invalidate() { ++epoch; controller.abort(); controller = new AbortController(); clearDownload(); }
  function suspend() { invalidate(); publish({ ...initial() }); }
  function begin() {
    if (state.busy || !state.scope) return null;
    const generation = ++epoch;
    controller.abort(); controller = new AbortController();
    const scope = { ...state.scope }, baseline = state.auth;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
    const current = () => epoch === generation && !signal.aborted && samePersonalScriptScope(scope, state.scope);
    const onAbort = () => {
      if (epoch === generation && signal.reason?.name === "TimeoutError") {
        invalidate(); publish({ ...initial(), issue: personalScriptIssue(null) });
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const api = (path, options = {}) => { assert(current()); return request(path, { ...options, cache: "no-store", signal }); };
    publish({ busy: true, issue: null, notice: "", confirmation: null });
    return { scope, baseline, signal, current, api, settle: () => signal.removeEventListener("abort", onAbort), scripts: scriptsClientFactory(api), skills: skillsClientFactory(api) };
  }
  async function identity(t, required, baseline = t.baseline) {
    assert(t.current());
    const me = await t.api("/client/auth/me"); assert(t.current() && opaque(me?.id) && me.id === t.scope.memberId);
    const c = await t.api("/client/workspaces/context", { workspaceId: t.scope.workspaceId });
    assert(t.current() && record(c) && c.workspaceId === t.scope.workspaceId && opaque(c.workspaceCode) && opaque(c.roleId) && opaque(c.roleCode)
      && typeof c.sessionGeneration === "string" && /^[a-f0-9]{64}$/.test(c.sessionGeneration) &&
      Array.isArray(c.permissions) && c.permissions.every(p => typeof p === "string") && new Set(c.permissions).size === c.permissions.length);
    const auth = { memberId: me.id, workspaceId: c.workspaceId, workspaceCode: c.workspaceCode, roleId: c.roleId, roleCode: c.roleCode, sessionGeneration: c.sessionGeneration, permissions: [...c.permissions] };
    assert(has(auth, required) && (!baseline || fingerprint(auth) === fingerprint(baseline)));
    return auth;
  }
  async function head(t, expected = t.scope) {
    const h = await t.skills.get(t.scope.workspaceId, t.scope.skillId);
    assert(t.current() && record(h) && h.id === t.scope.skillId && revision(h.revision) && unicode(h.name) && unicode(h.instructions));
    if (expected) assert(h.revision === expected.revision && h.name === expected.name && h.instructions === expected.instructions);
    return h;
  }
  async function authorize(t, required, expected = t.scope, baseline = t.baseline) {
    const auth = await identity(t, required, baseline); await head(t, expected); assert(t.current()); return auth;
  }
  function failure(e, t) {
    if (!t.current()) return;
    const issue = personalScriptIssue(e);
    invalidate();
    publish({ ...privateBlank(), scope: null, auth: null, capability: null, busy: false, issue });
  }
  const finish = t => { t.settle(); if (t.current()) publish({ busy: false }); };
  const selectedFor = s => sameOwner(selected, s) && selected.revision === s.revision ? selected.scriptVersionId : "";
  async function refresh() {
    const t = begin(); if (!t) return;
    clearDownload(); publish({ ...privateBlank(), auth: null, capability: null });
    try {
      // An explicit refresh establishes a new authorization baseline. For an
      // unresolved version write the head may have advanced; only read it.
      const expected = sameOwner(lock, t.scope) && lock.kind === "version" ? null : t.scope;
      const auth = await authorize(t, [ASSETS], expected, null);
      const capability = await t.scripts.capability(t.scope.workspaceId, { signal: t.signal });
      await authorize(t, [ASSETS], expected, auth);
      if (t.current()) publish({ auth, capability, versionId: selectedFor(t.scope) });
    } catch (e) { failure(e, t); } finally { finish(t); }
  }
  function setScope(value) {
    const scope = value === null ? null : validScope(value) ? Object.fromEntries(scopeFields.map(k => [k, value[k]])) : null;
    if (samePersonalScriptScope(scope, state.scope)) return;
    invalidate(); publish({ ...initial(), scope });
    if (scope) void refresh();
  }
  function setRequest(next) { if (next !== request) { suspend(); request = next; } }
  function canCreate() { return !state.busy && !lock && state.scope && has(state.auth, CREATE); }
  function canSubmit() {
    return Boolean(!state.busy && !lock && state.scope && uuid(state.versionId) &&
      (!state.ref || state.ref.scriptVersionId === state.versionId && state.ref.revision === state.scope.revision && state.ref.skillId === state.scope.skillId) &&
      has(state.auth, EXECUTE) && state.capability?.configured && state.capability?.canExecute);
  }
  function setField(field, value) {
    if (state.busy || !state.auth || !state.scope || !["source", "input", "versionId", "runId"].includes(field) || typeof value !== "string") return;
    if (field === "source" && (!canCreate() || value.length > 65536) || field === "input" && (!canSubmit() || value.length > 16384) ||
      field === "versionId" && (!(has(state.auth, SOURCE) || has(state.auth, EXECUTE)) || value.length > 36) || field === "runId" && (!has(state.auth, READ) || value.length > 36)) return;
    if (field === "versionId") { clearDownload(); publish({ ref: null, run: null, output: "", download: null }); }
    if (field === "runId") { clearDownload(); publish({ run: null, output: "", download: null }); }
    publish({ [field]: value, confirmation: null, issue: null });
  }
  function requestConfirmation(kind) {
    if (kind === "version" && canCreate() && validPersonalScriptSource(state.source)) publish({ confirmation: kind });
    if (kind === "run" && canSubmit()) {
      try { parsePersonalScriptInput(state.input); publish({ confirmation: kind }); }
      catch (e) { publish({ issue: personalScriptIssue(e) }); }
    }
  }
  async function confirmVersion() {
    if (state.confirmation !== "version" || !canCreate() || !validPersonalScriptSource(state.source)) return;
    let source = state.source;
    const t = begin(); if (!t) return;
    let ownLock = null;
    try {
      const auth = await authorize(t, CREATE);
      ownLock = { kind: "version", memberId: t.scope.memberId, workspaceId: t.scope.workspaceId, skillId: t.scope.skillId, revision: t.scope.revision };
      lock = ownLock; publish({ source: "", input: "" });
      const ref = await t.scripts.createVersion(t.scope.workspaceId, { skillId: t.scope.skillId, expectedRevision: t.scope.revision,
        name: t.scope.name, instructions: t.scope.instructions, scriptSource: source }, { signal: t.signal });
      source = "";
      if (!t.current()) return;
      // Keep only opaque IDs if post-write authorization cannot be confirmed.
      lock = ownLock = { ...ownLock, scriptVersionId: ref.scriptVersionId };
      await authorize(t, CREATE, { ...t.scope, revision: ref.revision }, auth);
      if (!t.current()) return;
      selected = { ...ownLock, revision: ref.revision }; lock = null;
      publish({ ref, versionId: ref.scriptVersionId, notice: "服务端已确认创建一个不可变 Python 版本。请重新读取当前 Skill 后核对版本。" });
      onSkillChanged();
    } catch (e) {
      // A browser/proxy can repeat a committed request after a broken response
      // and return a later 4xx. Once attempted, only head+ack can resolve it.
      failure(e, t);
    } finally { source = ""; finish(t); }
  }
  async function readVersion() {
    if (state.busy || !has(state.auth, SOURCE) || !uuid(state.versionId)) return;
    const versionId = state.versionId, t = begin(); if (!t) return;
    try {
      const auth = await authorize(t, SOURCE);
      const value = await t.scripts.version(t.scope.workspaceId, versionId, { signal: t.signal });
      assert(value.ref.skillId === t.scope.skillId && value.ref.revision === t.scope.revision);
      await authorize(t, SOURCE, t.scope, auth);
      if (t.current()) {
        selected = { memberId: t.scope.memberId, workspaceId: t.scope.workspaceId, skillId: t.scope.skillId, revision: t.scope.revision, scriptVersionId: versionId };
        publish({ ref: value.ref, source: value.scriptSource });
      }
    } catch (e) { failure(e, t); } finally { finish(t); }
  }
  async function confirmSubmit() {
    if (state.confirmation !== "run" || !canSubmit()) return;
    let input;
    try { input = parsePersonalScriptInput(state.input); } catch (e) { publish({ issue: personalScriptIssue(e), confirmation: null }); return; }
    const versionId = state.versionId, t = begin(); if (!t) return;
    let ownLock = null;
    try {
      const auth = await authorize(t, EXECUTE);
      const capability = await t.scripts.capability(t.scope.workspaceId, { signal: t.signal });
      await authorize(t, EXECUTE, t.scope, auth);
      if (!capability.configured || !capability.canExecute) { publish({ capability, input: "" }); return; }
      const key = makeKey(); assert(typeof key === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(key));
      ownLock = { kind: "run", memberId: t.scope.memberId, workspaceId: t.scope.workspaceId, skillId: t.scope.skillId,
        revision: t.scope.revision, scriptVersionId: versionId, key };
      lock = ownLock; clearDownload(); publish({ source: "", input: "", run: null, output: "", download: null });
      const run = await t.scripts.submit(t.scope.workspaceId, { scriptVersionId: versionId, input, idempotencyKey: key }, { signal: t.signal });
      input = null;
      if (!t.current()) return;
      assert(run.script.skillId === t.scope.skillId && run.script.revision === t.scope.revision);
      lock = ownLock = { ...ownLock, runId: run.id };
      await authorize(t, EXECUTE, t.scope, auth);
      if (t.current()) showRun(run);
    } catch (e) {
      // HTTP denial after an attempted POST cannot discard its original key.
      // Retain it until authorized GET recovery and explicit terminal resolution.
      failure(e, t);
    } finally { input = null; finish(t); }
  }
  function showRun(run) {
    clearDownload();
    const remaining = Date.parse(run.expiresAt) - now();
    assert(remaining > 0);
    selected = { memberId: state.scope.memberId, workspaceId: state.scope.workspaceId, skillId: state.scope.skillId,
      revision: run.script.revision, scriptVersionId: run.script.scriptVersionId };
    publish({ run, ref: run.script, versionId: run.script.scriptVersionId, runId: run.id, output: "", download: null });
    expiryTimer = setTimeout(() => suspend(), Math.min(remaining, 2147483647)); expiryTimer.unref?.();
  }
  async function readRun(recover = false) {
    if (state.busy || !has(state.auth, READ) || recover && (!sameOwner(lock, state.scope) || lock.kind !== "run") || !recover && !uuid(state.runId)) return;
    const pending = lock, runId = state.runId, t = begin(); if (!t) return;
    try {
      const auth = await authorize(t, READ);
      const run = recover ? await t.scripts.recover(t.scope.workspaceId, pending.key, { signal: t.signal }) : await t.scripts.read(t.scope.workspaceId, runId, { signal: t.signal });
      assert(run.script.skillId === t.scope.skillId && run.script.revision === t.scope.revision &&
        (!recover || run.script.scriptVersionId === pending.scriptVersionId && (!pending.runId || run.id === pending.runId)));
      await authorize(t, READ, t.scope, auth);
      if (t.current()) {
        if (recover && lock === pending) lock = { ...pending, runId: run.id };
        showRun(run);
      }
    } catch (e) { failure(e, t); } finally { finish(t); }
  }
  async function download() {
    if (state.busy || !has(state.auth, READ) || state.run?.outcome !== "SUCCESS") return;
    const run = state.run, t = begin(); if (!t) return;
    let result;
    clearDownload(); publish({ output: "", download: null });
    try {
      assert(Date.parse(run.expiresAt) > now());
      const auth = await authorize(t, READ);
      result = await t.scripts.download(t.scope.workspaceId, run, { signal: t.signal });
      await authorize(t, READ, t.scope, auth);
      assert(Date.parse(run.expiresAt) > now());
      if (t.current()) {
        objectURL = makeObjectURL(new Blob([new Uint8Array(result.bytes)], { type: result.mimeType }));
        publish({ output: new TextDecoder("utf-8", { fatal: true }).decode(result.bytes), download: { url: objectURL, filename: result.filename } });
        expiryTimer = setTimeout(() => suspend(), Math.min(Date.parse(run.expiresAt) - now(), 2147483647)); expiryTimer.unref?.();
      }
    } catch (e) { failure(e, t); } finally { result?.bytes.fill(0); finish(t); }
  }
  // No version-key recovery endpoint exists. Read only the original Skill head;
  // retain the lock until a separate explicit, currently authorized acknowledgement.
  async function reviewVersionWrite() {
    if (state.busy || !sameOwner(lock, state.scope) || lock.kind !== "version" || !has(state.auth, CREATE)) return;
    const pending = lock, t = begin(); if (!t) return;
    try {
      const auth = await identity(t, CREATE), h = await head(t, null);
      await authorize(t, CREATE, h, auth);
      if (t.current() && lock === pending) publish({ versionReview: { revision: h.revision } });
    } catch (e) { failure(e, t); } finally { finish(t); }
  }
  async function acknowledgeVersionWrite() {
    if (state.busy || !state.versionReview || !sameOwner(lock, state.scope) || lock.kind !== "version" || !has(state.auth, CREATE)) return;
    const pending = lock, reviewedRevision = state.versionReview.revision, t = begin(); if (!t) return;
    try {
      const auth = await identity(t, CREATE), h = await head(t, null); assert(h.revision === reviewedRevision);
      await authorize(t, CREATE, h, auth);
      if (t.current() && lock === pending) {
        lock = null; selected = null; invalidate();
        publish({ ...initial(), notice: "已明确确认当前 Skill 版本。未知版本的源码与引用无法通过请求键恢复；请重新读取 Skill 后自行决定后续操作。" });
        onSkillChanged();
      }
    } catch (e) { failure(e, t); } finally { finish(t); }
  }
  const terminal = run => run && ["completed", "failed", "dead", "cancelled"].includes(run.jobStatus) && run.outcome !== null && !["UNKNOWN", "CLEANUP_UNCONFIRMED"].includes(run.outcome);
  function canResolveRun() { return Boolean(sameOwner(lock, state.scope) && lock.kind === "run" && lock.runId === state.run?.id && terminal(state.run)); }
  async function resolveRun() {
    if (state.busy || !has(state.auth, READ) || !canResolveRun()) return;
    const pending = lock, t = begin(); if (!t) return;
    try {
      const auth = await authorize(t, READ);
      const run = await t.scripts.recover(t.scope.workspaceId, pending.key, { signal: t.signal });
      assert(run.id === pending.runId && run.script.scriptVersionId === pending.scriptVersionId && terminal(run));
      await authorize(t, READ, t.scope, auth);
      if (t.current() && lock === pending) { lock = null; clearDownload(); publish({ ...privateBlank(), versionId: selectedFor(t.scope), notice: "已核对并明确结束原请求。本页不会自动创建新请求。" }); }
    } catch (e) { failure(e, t); } finally { finish(t); }
  }
  return { getSnapshot: () => state, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    setScope, setRequest, setOnSkillChanged: next => { onSkillChanged = next; }, suspend, refresh, setField, canCreate: () => Boolean(canCreate()), canSubmit, canResolveRun, requestConfirmation,
    cancelConfirmation: () => { if (!state.busy) publish({ confirmation: null }); }, confirmVersion, confirmSubmit, readVersion,
    readRun: () => readRun(false), recover: () => readRun(true), download, reviewVersionWrite, acknowledgeVersionWrite, resolveRun };
}
