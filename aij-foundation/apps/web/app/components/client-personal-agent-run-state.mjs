// Page state only. Authorization, admission, memory selection and accounting belong to the server.
import {
  PersonalRequestJournalError as JournalError, personalJournalKey, parsePersonalJournal,
  samePersonalJournalEntry as same, findPersonalJournalEntry, createPersonalRequestJournalStorage
} from "./client-personal-agent-request-journal.mjs";
export { personalJournalKey, parsePersonalJournal };
const EXECUTE = "workspace.ai.execute", ASSETS = "workspace.ai.assets.read", READ = "workspace.ai.read";
const opaque = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const uuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const revision = v => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const record = v => v !== null && typeof v === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(v)) && !Array.isArray(v);
const code = v => typeof v === "string" && /^[a-z][a-z0-9-]{1,62}$/.test(v);
const text = (v, max) => typeof v === "string" && v.length <= max && !v.includes("\0");
const fields = v => Array.isArray(v) && v.length <= 20 && new Set(v).size === v.length && v.every(k => typeof k === "string" && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(k) && !["constructor", "prototype", "__proto__"].includes(k));
const money = v => typeof v === "string" && /^\d{1,30}$/.test(v);
const date = v => typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const terminal = v => v?.status === "succeeded" && v.budgetStatus === "settled" || v?.status === "failed" && v.budgetStatus === "released";
const consistent = v => terminal(v) || ["queued", "running", "unknown"].includes(v?.status) && v.budgetStatus === "reserved";
const exact = (v, keys) => record(v) && Object.keys(v).sort().join() === [...keys].sort().join();
class InvalidResponse extends Error {}
const check = v => { if (!v) throw new InvalidResponse(); };
const previewFields = ["personalAgentId", "code", "name", "revision", "inputFields", "outputFormat", "outputFields", "capability", "modelCode", "modelRevision", "catalogVersion", "maximumEstimatedCostNanos", "modelExecutionConfigured"];
export function parsePersonalPreview(v, agentId, expectedRevision) {
  check(exact(v, previewFields) && uuid(v.personalAgentId) && v.personalAgentId === agentId && revision(v.revision) && v.revision === expectedRevision && code(v.code) &&
    text(v.name, 100) && v.name.trim() && fields(v.inputFields) && v.inputFields.length > 0 && fields(v.outputFields) &&
    ["text", "json"].includes(v.outputFormat) && (v.outputFormat !== "json" || v.outputFields.length > 0) && v.capability === "text" &&
    code(v.modelCode) && revision(v.modelRevision) && revision(v.catalogVersion) && money(v.maximumEstimatedCostNanos) && typeof v.modelExecutionConfigured === "boolean");
  return { ...v, inputFields: [...v.inputFields], outputFields: [...v.outputFields] };
}
function safeJson(v, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > 50000 || depth > 20) return false;
  if (v === null || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) return true;
  if (typeof v === "string") return v.length <= 262144;
  if (Array.isArray(v)) return v.every(x => safeJson(x, depth + 1, budget));
  return record(v) && Object.entries(v).every(([k, x]) => !["__proto__", "constructor", "prototype"].includes(k) && safeJson(x, depth + 1, budget));
}
export function parsePersonalRun(v, entry, referenceOnly = false, preview = null) {
  const common = ["id", "agentCode", "status", "budgetStatus", "createdAt", "expiresAt"];
  check(exact(v, [...common, ...(referenceOnly ? ["contentAvailable"] : ["output", "failureCode", "estimatedCostNanos", "imageAssetId"])]) && opaque(v.id) &&
    v.agentCode === `personal:${entry.agentId}` && (!entry.runId || v.id === entry.runId) && consistent(v) && date(v.createdAt) && date(v.expiresAt) && Date.parse(v.expiresAt) > Date.parse(v.createdAt));
  if (referenceOnly) check(typeof v.contentAvailable === "boolean");
  else check((v.failureCode === null || text(v.failureCode, 128)) && money(v.estimatedCostNanos) && v.imageAssetId === null &&
    safeJson(v.output) && JSON.stringify(v.output).length <= 1048576 && (v.status !== "succeeded" || v.output !== null) && (v.status === "succeeded" || v.output === null));
  if (!referenceOnly && v.status === "succeeded") {
    check(text(v.output, 64000) || record(v.output) && fields(Object.keys(v.output)) && Object.values(v.output).every(x => text(x, 64000)));
    if (preview?.personalAgentId === entry.agentId && preview.revision === entry.revision) check(preview.outputFormat === "text" ? typeof v.output === "string" : exact(v.output, preview.outputFields));
  }
  return { ...v };
}
const initial = () => ({ phase: "loading", principal: null, workspaces: [], workspaceId: "", context: null, preview: null, input: {}, confirmation: false,
  busy: false, issue: null, previewIssue: null, journal: null, storageBlocked: false, run: null, reference: null, contentState: "none", pollPaused: true, polling: false });
export function personalRunIssue(e, operation = "read") {
  const status = typeof e?.status === "number" ? e.status : 0;
  if (e instanceof JournalError) return { kind: "storage", status: 0, message: "恢复记录无法安全读取或保存，已阻止提交。请恢复浏览器存储后重新验证；不要清除未决记录来重试。" };
  if (e instanceof InvalidResponse) return { kind: "invalid-response", status: 0, message: "响应与当前任务契约不一致，已停止操作。请重新验证访问并查回原任务。" };
  const messages = {
    400: ["input", "输入或参数未通过校验，请检查声明的字段。"],
    401: ["unauthorized", "登录已失效，页面内容已清除，请重新登录。"],
    403: ["forbidden", "当前会话、空间或权限不可用，页面内容已清除。请重新验证访问。"],
    404: ["unavailable", "未查到可访问的记录，可能不可用或已移除。未确认的提交仍保留原标识，请稍后查回；不会自动重提。"],
    409: ["stale", "版本或配置已变化，请明确重新读取预览并核对。未决任务只能按原标识查回。"],
    410: ["expired", "任务内容已过保留期，无法继续读取。停止本页读取不会取消服务端任务。"],
    503: ["config-unavailable", "服务或执行配置当前不可用。已有任务仍可尝试按原标识读取。"]
  };
  const [kind, message] = messages[status] ?? ["network", "请求超时或网络中断，请检查连接。"];
  return { kind, status, message: operation === "submit" ? message + " 提交结果未确认，已保留原标识；只会 GET 查回，不会重试提交。" : message };
}

/** SDK factories are the actual public SDK; every transport call is epoch/abort/timeout fenced. */
export function createPersonalAgentRun({ agentId, request, previewsClientFactory, runsClientFactory, aiClientFactory, recoveryClientFactory, agentsClientFactory,
  journalStorage, withRecoveryLock, configured = () => true, onUnauthorized = () => {}, timeoutMs = 8000,
  makeKey = () => globalThis.crypto.randomUUID(), schedule = (fn, ms) => setTimeout(fn, ms), unschedule = clearTimeout, pollInterval = 1500, maxPolls = 40,
  now = () => Date.now(), scheduleExpiry = (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer; }, unscheduleExpiry = clearTimeout }) {
  let state = initial(), epoch = 0, controller = new AbortController(), disposed = false, preferred = "", timer = null, pollCount = 0, lastPreview = null;
  let expiryTimer = null;
  const recoveryStorage = createPersonalRequestJournalStorage({ journalStorage, withRecoveryLock });
  const legacySelector = t => ({ family: "personal-agent", workspaceId: t.workspaceId, agentId });
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const current = t => !disposed && t.epoch === epoch && !t.signal.aborted;
  const can = p => Boolean(state.context?.workspaceId === state.workspaceId && state.context?.permissions.includes(p));
  const stopPoll = () => { if (timer !== null) unschedule(timer); timer = null; };
  const stopExpiry = () => { if (expiryTimer !== null) unscheduleExpiry(expiryTimer); expiryTimer = null; };
  function invalidate() { stopPoll(); stopExpiry(); controller.abort(); controller = new AbortController(); ++epoch; }
  function presentRun(t, run, entry) {
    if (!current(t)) return;
    stopExpiry();
    const remaining = Date.parse(run.expiresAt) - now();
    if (remaining <= 0) {
      stopPoll();
      const reference = Object.fromEntries(["id", "agentCode", "status", "budgetStatus", "createdAt", "expiresAt"].map(k => [k, run[k]]));
      publish({ journal: entry, run: null, reference: { ...reference, contentAvailable: false }, contentState: "expired", polling: false }); return;
    }
    publish({ journal: entry, run, contentState: "available", issue: null });
    expiryTimer = scheduleExpiry(() => {
      expiryTimer = null;
      if (current(t) && state.run?.id === run.id) presentRun(t, run, state.journal);
    }, Math.min(remaining, 2147483647));
  }
  function ticket() {
    const t = { epoch, signal: controller.signal, memberId: state.principal?.id, workspaceId: state.workspaceId };
    t.api = (path, options = {}) => new Promise((resolve, reject) => {
      if (!current(t)) { reject(new DOMException("Scope changed", "AbortError")); return; }
      const signal = AbortSignal.any([t.signal, AbortSignal.timeout(timeoutMs)]);
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve().then(() => { signal.throwIfAborted(); if (!current(t)) throw new DOMException("Scope changed", "AbortError"); return request(path, { ...options, signal }); })
        .then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
    return t;
  }
  function failure(e, t, operation) {
    if (!current(t)) return;
    const issue = personalRunIssue(e, operation);
    if ([401, 403].includes(issue.status)) {
      invalidate(); publish({ ...initial(), phase: "ready", issue });
      if (issue.status === 401) onUnauthorized();
    } else publish({ issue, confirmation: false, ...(e instanceof JournalError ? { storageBlocked: true } : {}),
      ...(operation === "read" ? { run: null, contentState: issue.status === 410 ? "expired" : "unavailable" } : {}),
      ...(operation === "submit" ? { preview: null } : {}) });
  }
  function readEntries(t) {
    return recoveryStorage.read(t.memberId, () => current(t));
  }
  const find = (entries, t) => findPersonalJournalEntry(entries, legacySelector(t));
  async function locked(t, fn) {
    try { return await recoveryStorage.locked(t.memberId, () => current(t), fn); }
    catch (e) { if (!current(t)) return null; throw e; }
  }
  function cas(t, expected, replacement) {
    if (!current(t)) return false;
    return recoveryStorage.compareExchange(t.memberId, legacySelector(t), expected, replacement, () => current(t));
  }
  async function start(workspaceId = preferred) {
    preferred = workspaceId; disposed = false; invalidate(); publish(initial()); const t = ticket();
    try {
      check(uuid(agentId) && (workspaceId === "" || opaque(workspaceId)));
      if (!configured()) throw { status: 503 };
      const p = await t.api("/client/auth/me"); if (!current(t)) return;
      check(record(p) && opaque(p.id)); publish({ principal: { id: p.id } });
      const items = [];
      for (let page = 1; page <= 100; page++) {
        const result = await t.api(`/client/workspaces?page=${page}&pageSize=100`); if (!current(t)) return;
        check(record(result) && Array.isArray(result.items) && result.items.length <= 100 && Number.isSafeInteger(result.total) && result.total >= 0);
        for (const w of result.items) { check(record(w) && record(w.workspace) && opaque(w.workspace.id) && text(w.workspace.name, 200) && record(w.role) && text(w.role.name, 200)); items.push({ workspace: { id: w.workspace.id, name: w.workspace.name }, role: { name: w.role.name } }); }
        if (items.length >= result.total) break;
        check(result.items.length > 0 && page < 100);
      }
      check(new Set(items.map(w => w.workspace.id)).size === items.length); publish({ workspaces: items });
      if (!workspaceId) { publish({ phase: "ready" }); return; }
      // No fallback to a different space when a selector is missing/foreign.
      if (!items.some(w => w.workspace.id === workspaceId)) throw { status: 403 };
      const context = await t.api("/client/workspaces/context", { workspaceId }); if (!current(t)) return;
      check(record(context) && context.workspaceId === workspaceId && text(context.workspaceName, 200) && Array.isArray(context.permissions) && context.permissions.every(p => typeof p === "string"));
      publish({ workspaceId, context: { workspaceId, workspaceName: context.workspaceName, permissions: [...context.permissions] }, phase: "ready" });
      const scoped = ticket();
      const entry = await locked(scoped, () => find(readEntries(scoped), scoped)); if (!current(scoped)) return;
      publish({ journal: entry });
      if (entry && can(READ)) await recover();
      if (current(scoped) && can(EXECUTE) && can(ASSETS)) await loadPreview(false);
    } catch (e) { failure(e, t, "load"); }
    finally { if (current(t)) publish({ phase: "ready" }); }
  }
  const refreshPreview = () => loadPreview(true);
  async function loadPreview(explicit) {
    if (disposed || state.busy || !can(EXECUTE) || !can(ASSETS)) return;
    const t = ticket(); publish({ busy: true, preview: null, input: {}, confirmation: false, previewIssue: null });
    try {
      let found = null, afterId;
      for (let page = 0; page < 200; page++) {
        const v = await agentsClientFactory(t.api).list(t.workspaceId, { limit: 50, ...(afterId ? { afterId } : {}) }); if (!current(t)) return;
        check(exact(v, ["items", "nextCursor"]) && Array.isArray(v.items) && v.items.length <= 50);
        for (const a of v.items) check(record(a) && uuid(a.id) && revision(a.revision) && typeof a.enabled === "boolean");
        check(v.items.every((a, i) => (!afterId || a.id > afterId) && (!i || a.id > v.items[i-1].id)) && (v.nextCursor === null || v.items.length === 50 && v.nextCursor === v.items.at(-1).id));
        found = v.items.find(a => a.id === agentId); if (found || v.nextCursor === null) break; afterId = v.nextCursor; check(page < 199);
      }
      if (!found) throw { status: 404 };
      if (!found.enabled) { publish({ previewIssue: { kind: "disabled", status: 0, message: "此 Agent 配置未启用，不能发起新任务。已有任务可继续按原标识读取。" } }); return; }
      if (!explicit && lastPreview?.memberId === t.memberId && lastPreview.workspaceId === t.workspaceId && lastPreview.revision !== found.revision) {
        publish({ previewIssue: { kind: "stale", status: 409, message: "检测到 Agent 版本变化，请明确点击重新读取预览，核对模型、字段和预算后再确认执行。" } }); return;
      }
      const preview = parsePersonalPreview(await previewsClientFactory(t.api).preview(t.workspaceId, agentId, found.revision), agentId, found.revision);
      if (current(t)) { lastPreview = { memberId: t.memberId, workspaceId: t.workspaceId, revision: preview.revision }; publish({ preview, previewIssue: null }); }
    } catch (e) {
      if (!current(t)) return;
      if ([401, 403].includes(e?.status)) failure(e, t, "preview");
      else publish({ previewIssue: personalRunIssue(e, "preview"), preview: null, confirmation: false });
    } finally { if (current(t)) publish({ busy: false }); }
  }
  const ready = () => !disposed && state.phase === "ready" && !state.busy && !state.journal && !state.run && !state.reference && !state.storageBlocked && can(EXECUTE) && can(ASSETS) && Boolean(state.preview?.modelExecutionConfigured) && !state.previewIssue;
  const validInput = () => state.preview && Object.keys(state.input).length === state.preview.inputFields.length && state.preview.inputFields.every(k => text(state.input[k], 2000) && state.input[k].trim());
  function setInput(field, value) { if (ready() && !state.confirmation && state.preview.inputFields.includes(field) && text(value, 2000)) publish({ input: { ...state.input, [field]: value }, issue: null }); }
  function requestConfirmation() {
    if (!ready()) return;
    if (!validInput()) { publish({ issue: personalRunIssue({ status: 400 }) }); return; }
    publish({ confirmation: true, issue: null });
  }
  async function confirmSubmit() {
    if (!ready() || !state.confirmation || !validInput()) return;
    const t = ticket(), preview = state.preview, input = { ...state.input };
    publish({ busy: true, confirmation: false, issue: null });
    try {
      const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([agentId, preview.revision, Object.entries(input).sort(([a], [b]) => a.localeCompare(b))])));
      if (!current(t)) return;
      const digest = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
      const entry = await locked(t, () => {
        const prior = find(readEntries(t), t);
        if (prior) { publish({ journal: prior, input: {} }); throw new JournalError(); }
        const e = { memberId: t.memberId, workspaceId: t.workspaceId, agentId, revision: preview.revision, key: makeKey(), digest, runId: null, status: "unconfirmed" };
        cas(t, null, e); return e;
      });
      if (!current(t) || !entry) return;
      publish({ journal: entry, input: {} });
      // Re-read under the shared lock immediately before POST. No path retries POST.
      await locked(t, async () => {
        if (!same(find(readEntries(t), t), entry)) throw new JournalError();
        if (!current(t)) return;
        const run = parsePersonalRun(await runsClientFactory(t.api).submit(t.workspaceId, agentId, { input, idempotencyKey: entry.key, expectedRevision: entry.revision }), entry, false, preview);
        if (!current(t)) return;
        const next = { ...entry, runId: run.id, status: run.status };
        cas(t, entry, next);
        if (current(t)) presentRun(t, run, next);
      });
    } catch (e) { failure(e, t, "submit"); }
    finally { if (current(t)) { publish({ busy: false }); enqueuePoll(); } }
  }
  async function recover() {
    if (disposed || state.busy || !can(READ)) return;
    stopPoll(); stopExpiry(); const t = ticket(); publish({ busy: true, issue: null, confirmation: false, run: null, reference: null, input: {}, polling: false });
    try {
      const entry = await locked(t, () => find(readEntries(t), t)); if (!current(t)) return;
      publish({ journal: entry }); if (!entry) return;
      const reference = parsePersonalRun(await recoveryClientFactory(t.api).recoverRequest(t.workspaceId, entry.key), entry, true); if (!current(t)) return;
      const next = { ...entry, runId: reference.id, status: reference.status };
      await locked(t, () => cas(t, entry, next)); if (!current(t)) return;
      publish({ journal: next, reference, contentState: reference.contentAvailable ? "pending" : Date.parse(reference.expiresAt) <= now() ? "expired" : "purged" });
      if (reference.contentAvailable) await readOriginal(t, next);
    } catch (e) { failure(e, t, "read"); }
    finally { if (current(t)) { publish({ busy: false }); enqueuePoll(); } }
  }
  async function readOriginal(t, entry) {
    const run = parsePersonalRun(await aiClientFactory(t.api).read(t.workspaceId, entry.runId), entry, false, state.preview); if (!current(t)) return;
    const next = { ...entry, status: run.status };
    await locked(t, () => cas(t, entry, next)); if (!current(t)) return;
    presentRun(t, run, next);
  }
  function enqueuePoll() {
    stopPoll();
    if (disposed || state.pollPaused || !can(READ) || state.issue || !["queued", "running"].includes(state.run?.status) || pollCount >= maxPolls) {
      publish({ polling: false, ...(pollCount >= maxPolls ? { pollPaused: true } : {}) }); return;
    }
    const t = ticket(); publish({ polling: true });
    timer = schedule(() => { timer = null; if (current(t)) { pollCount++; void recover(); } }, pollInterval);
  }
  function pausePolling() { if (disposed) return; stopPoll(); publish({ pollPaused: true, polling: false }); }
  function resumePolling() { if (disposed || !can(READ)) return; pollCount = 0; publish({ pollPaused: false }); enqueuePoll(); }
  async function newTask() {
    if (disposed || state.busy || state.storageBlocked || !terminal(state.run ?? state.reference) || !state.journal) return;
    const t = ticket(), entry = state.journal;
    try {
      await locked(t, () => cas(t, entry, null)); if (!current(t)) return;
      invalidate(); publish({ journal: null, run: null, reference: null, preview: null, input: {}, issue: null, previewIssue: null, contentState: "none", confirmation: false, pollPaused: true, polling: false });
      await refreshPreview();
    } catch (e) { failure(e, t, "storage"); }
  }
  function dispose() { disposed = true; invalidate(); publish({ ...initial(), phase: "ready" }); }
  return { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, start, selectWorkspace: start, refresh: () => start(), refreshPreview,
    setInput, ready, requestConfirmation, confirmSubmit, cancelConfirmation: () => { if (!disposed) publish({ confirmation: false }); }, recover, pausePolling, resumePolling, newTask, dispose };
}
