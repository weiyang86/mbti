// Mounted-panel RAM only. Original SDK/services own publication, Run and budget truth.
const READ_PUBLICATION = ["workspace.ai.assets.read"];
const PUBLISH = ["workspace.ai.assets.manage", "workspace.ai.workflows.publish"];
const EXECUTE = ["workspace.ai.assets.read", "workspace.ai.execute", "workspace.ai.workflows.execute"];
const READ_RUN = ["workspace.ai.assets.read", "workspace.ai.read", "workspace.ai.workflows.execute"];
const badKeys = ["__proto__", "prototype", "constructor"];
const opaque = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v) && !badKeys.includes(v);
const digest = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const counter = v => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const fields = ["memberId", "workspaceId", "workflowId", "revision", "graphDigest"];
export const sameWorkflowExecutionScope = (a, b) => a && b ? fields.every(k => a[k] === b[k]) : a === b;
const sameOwner = (a, b) => Boolean(a && b && ["memberId", "workspaceId", "workflowId"].every(k => a[k] === b[k]));
const has = (auth, required) => Boolean(auth && required.every(p => auth.permissions.includes(p)));
const fingerprint = a => JSON.stringify([a.memberId, a.workspaceId, a.workspaceCode, a.roleId, a.roleCode, a.sessionGeneration, [...a.permissions].sort()]);
const unicode = v => typeof v === "string" && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v);
const bytes = v => new TextEncoder().encode(v).length;
class Fence extends Error {}
const check = value => { if (!value) throw new Fence(); };

/** Bounded flat string object; detect duplicate decoded keys BEFORE JSON.parse loses them. */
export function parseWorkflowExecutionInput(raw, approvedKeys) {
  const invalid = () => { throw new TypeError("Invalid workflow input"); };
  const field = k => typeof k === "string" && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(k) && !badKeys.includes(k);
  if (!unicode(raw) || bytes(raw) > 65536 || !Array.isArray(approvedKeys) || approvedKeys.length > 20 ||
    approvedKeys.some(k => !field(k)) || new Set(approvedKeys).size !== approvedKeys.length) invalid();
  const tokens = raw.match(/"(?:\\[\s\S]|[^"\\])*"|[{}[\]:,]/g) ?? [];
  const keys = new Set(); let depth = 0, wantsKey = true;
  for (const token of tokens) {
    if (token === "{" || token === "[") { if (++depth > 1 || token === "[") invalid(); }
    else if (token === "}" || token === "]") depth--;
    else if (token === ":") wantsKey = false;
    else if (token === ",") wantsKey = true;
    else if (depth === 1 && wantsKey) {
      const key = JSON.parse(token);
      if (keys.has(key)) invalid(); keys.add(key);
    }
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length !== approvedKeys.length) invalid();
  for (const [key, value] of Object.entries(parsed)) {
    if (!field(key) || !approvedKeys.includes(key) || !unicode(value) || !value.trim() || value.length > 2000) invalid();
  }
  return Object.fromEntries(Object.entries(parsed));
}

// This is a UI affordance, never an execution validator. Server publication validation is authoritative.
function singleAgentHead(h) {
  const g = h.graph, nodes = g?.nodes, edges = g?.edges;
  if (!Array.isArray(nodes) || nodes.length !== 3 || !Array.isArray(edges) || edges.length !== 2) return false;
  const start = nodes.find(n => n.type === "start"), agent = nodes.find(n => n.type === "agent"), end = nodes.find(n => n.type === "end");
  return Boolean(start && agent && end && edges.some(e => e.from === start.id && e.to === agent.id && e.port === "next" && e.input === "in") &&
    edges.some(e => e.from === agent.id && e.to === end.id && e.port === "next" && e.input === "in"));
}
const blank = () => ({ scope: null, auth: null, publication: null, preview: null, singleAgent: false, input: "", runId: "", result: null,
  recovery: null, review: null, confirmation: null, busy: false, issue: null, notice: "", locked: false, pending: null });
const terminal = r => Boolean(r && ["succeeded", "failed", "cancelled"].includes(r.status) && ["settled", "released"].includes(r.budgetStatus));
export function workflowExecutionIssue(error) {
  const status = Number.isInteger(error?.status) ? error.status : 0;
  const messages = {
    400: "输入或发布条件未通过校验，请检查批准的输入键与当前草稿。",
    401: "登录已失效，私有内容已清除。请重新登录并核对原请求。",
    403: "当前成员、空间或权限不可用，私有内容已清除。请联系空间管理员。",
    404: "当前记录不可用或已删除；这不能证明原写入未发生，请保留并核对原请求。",
    409: "当前版本、发布纪元或依赖已变化。请重新读取当前草稿和发布状态，不会覆盖其他修改。",
    410: "原结果已过保留期，不能取回内容；未确认的请求不会因此自动解锁。",
    503: "执行未配置或服务暂不可用。不能提交新执行；已有授权结果仍可手动尝试读取。"
  };
  return { status, message: error instanceof Fence ? "会话、角色、权限或当前工作流已变化；私有内容已清除，请重新验证。" :
    messages[status] ?? "请求未能确认。请检查严格 JSON 或手动核对原请求；不会自动重试写入。" };
}

/** Exactly one mounted instance; suspension fences private state but never drops an attempted write lock. */
export function createWorkflowExecutionState({ request: initialRequest, executionClientFactory, workflowsClientFactory,
  onWorkflowChanged = () => {}, onScopeRejected = () => {}, makeKey = () => globalThis.crypto.randomUUID(), timeoutMs = 8000 }) {
  let request = initialRequest, state = blank(), generation = 0, controller = new AbortController(), lock = null;
  const listeners = new Set();
  function emit(patch) {
    state = { ...state, ...patch, locked: lock !== null };
    state.pending = sameOwner(lock, state.scope) ? { ...lock } : null;
    listeners.forEach(fn => fn());
  }
  function invalidate() { generation++; controller.abort(); controller = new AbortController(); }
  function suspend() { invalidate(); emit(blank()); }
  function setScope(value) {
    const scope = value && [value.memberId, value.workspaceId, value.workflowId].every(opaque) && counter(value.revision) && digest(value.graphDigest) ?
      Object.fromEntries(fields.map(k => [k, value[k]])) : null;
    if (sameWorkflowExecutionScope(scope, state.scope)) return;
    invalidate(); emit({ ...blank(), scope });
  }
  function begin() {
    if (state.busy || !state.scope) return null;
    invalidate(); const epoch = generation, scope = { ...state.scope }, baseline = state.auth;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
    const current = () => generation === epoch && !signal.aborted && sameWorkflowExecutionScope(scope, state.scope);
    const abort = () => { if (generation === epoch && signal.reason?.name === "TimeoutError") { suspend(); emit({ issue: workflowExecutionIssue(null) }); } };
    signal.addEventListener("abort", abort, { once: true });
    const api = (path, options = {}) => { check(current()); return request(path, { ...options, signal, cache: "no-store" }); };
    emit({ busy: true, issue: null, notice: "", confirmation: null });
    return { scope, baseline, signal, current, api, execution: executionClientFactory(api), workflows: workflowsClientFactory(api), settle: () => signal.removeEventListener("abort", abort) };
  }
  async function identity(t, required, baseline) {
    check(t.current()); const me = await t.api("/client/auth/me");
    check(t.current() && opaque(me?.id) && me.id === t.scope.memberId);
    const c = await t.api("/client/workspaces/context", { workspaceId: t.scope.workspaceId });
    check(t.current() && c?.workspaceId === t.scope.workspaceId && [c.workspaceCode, c.roleId, c.roleCode].every(opaque) && digest(c.sessionGeneration) &&
      Array.isArray(c.permissions) && c.permissions.every(p => typeof p === "string") && new Set(c.permissions).size === c.permissions.length);
    const auth = { memberId: me.id, workspaceId: c.workspaceId, workspaceCode: c.workspaceCode, roleId: c.roleId,
      roleCode: c.roleCode, sessionGeneration: c.sessionGeneration, permissions: [...c.permissions] };
    check(has(auth, required) && (!baseline || fingerprint(auth) === fingerprint(baseline))); return auth;
  }
  async function head(t) {
    const h = await t.workflows.get(t.scope.workspaceId, t.scope.workflowId);
    check(t.current() && h?.id === t.scope.workflowId && h.revision === t.scope.revision && h.graphDigest === t.scope.graphDigest);
    return h;
  }
  async function authorize(t, required, baseline = t.baseline) {
    const auth = await identity(t, required, baseline), h = await head(t); check(t.current()); return { auth, h };
  }
  function fail(error, t) { if (t.current()) { suspend(); emit({ issue: workflowExecutionIssue(error) }); if (error instanceof Fence || [401, 403].includes(error?.status)) onScopeRejected(); } }
  function finish(t) { t.settle(); if (t.current()) emit({ busy: false }); }
  function originMatches(ref, t, publicationId, currentHead = false) {
    check(t.current() && ref?.workflowId === t.scope.workflowId && (!publicationId || ref.id === publicationId));
    if (currentHead) check(ref.revision === t.scope.revision && ref.graphDigest === t.scope.graphDigest);
  }
  function publicationMatches(metadata, t) { check(metadata.workflowId === t.scope.workflowId && metadata.revision === t.scope.revision); }
  function canPublish() { return Boolean(!state.busy && !lock && state.publication && state.singleAgent && has(state.auth, PUBLISH)); }
  function canUnpublish() { return Boolean(!state.busy && !lock && state.publication?.publication && has(state.auth, PUBLISH)); }
  function canSubmit() { return Boolean(!state.busy && !lock && state.preview?.modelExecutionConfigured && state.publication?.dependencyReadiness.ready &&
    state.preview.publication.id === state.publication.publication?.id && has(state.auth, EXECUTE)); }

  async function verifyAccess() {
    const t = begin(); if (!t) return;
    emit({ auth: null, publication: null, preview: null, input: "", runId: "", result: null, recovery: null, review: null });
    try {
      // Result reads must not depend on availability of publication or preview services.
      const { auth } = await authorize(t, READ_PUBLICATION, null);
      await authorize(t, READ_PUBLICATION, auth);
      if (t.current()) emit({ auth });
    } catch (e) { fail(e, t); } finally { finish(t); }
  }
  async function readPublication() {
    const t = begin(); if (!t) return;
    emit({ auth: null, publication: null, preview: null, input: "", runId: "", result: null, recovery: null, review: null });
    try {
      // Explicit read clears previous private content and establishes a fresh actual identity baseline.
      const { auth, h } = await authorize(t, READ_PUBLICATION, null);
      const publication = await t.execution.publication(t.scope.workspaceId, t.scope.workflowId, { signal: t.signal });
      publicationMatches(publication, t); await authorize(t, READ_PUBLICATION, auth);
      if (t.current()) emit({ auth, publication, singleAgent: singleAgentHead(h) });
    } catch (e) { fail(e, t); } finally { finish(t); }
  }
  function requestConfirmation(kind) {
    if (kind === "publish" && canPublish() || kind === "unpublish" && canUnpublish()) emit({ confirmation: kind });
    if (kind === "run" && canSubmit()) {
      try { parseWorkflowExecutionInput(state.input, state.preview.inputFields); emit({ confirmation: kind }); }
      catch (e) { emit({ issue: workflowExecutionIssue(e) }); }
    }
  }
  async function confirmPublication() {
    const kind = state.confirmation;
    if (!(kind === "publish" && canPublish() || kind === "unpublish" && canUnpublish())) return;
    const expectedPublicationEpoch = state.publication.publicationEpoch, t = begin(); if (!t) return;
    try {
      const { auth } = await authorize(t, PUBLISH);
      const before = await t.execution.publication(t.scope.workspaceId, t.scope.workflowId, { signal: t.signal });
      publicationMatches(before, t); check(before.publicationEpoch === expectedPublicationEpoch);
      await authorize(t, PUBLISH, auth);
      lock = { kind: "publication", memberId: t.scope.memberId, workspaceId: t.scope.workspaceId, workflowId: t.scope.workflowId };
      emit({ preview: null, input: "", result: null, recovery: null, review: null });
      const cas = { expectedRevision: t.scope.revision, expectedPublicationEpoch };
      const result = kind === "publish" ? await t.execution.publish(t.scope.workspaceId, { workflowId: t.scope.workflowId, ...cas }, { signal: t.signal }) :
        await t.execution.unpublish(t.scope.workspaceId, t.scope.workflowId, cas, { signal: t.signal });
      publicationMatches(result, t); await authorize(t, PUBLISH, auth);
      const actual = await t.execution.publication(t.scope.workspaceId, t.scope.workflowId, { signal: t.signal });
      publicationMatches(actual, t); check(JSON.stringify(actual) === JSON.stringify(result)); await authorize(t, PUBLISH, auth);
      if (t.current()) { lock = null; emit({ publication: actual, notice: kind === "publish" ? "服务端已确认发布当前单 Agent 版本。" : "服务端已确认取消发布。" }); onWorkflowChanged(); }
    } catch (e) { fail(e, t); } finally { finish(t); }
  }
  async function preview() {
    if (state.busy || lock || !state.publication?.publication || !has(state.auth, EXECUTE)) return;
    const publicationId = state.publication.publication.id, t = begin(); if (!t) return;
    emit({ preview: null, input: "" });
    try {
      const { auth } = await authorize(t, EXECUTE);
      const value = await t.execution.preview(t.scope.workspaceId, publicationId, { signal: t.signal });
      originMatches(value.publication, t, publicationId, true); await authorize(t, EXECUTE, auth);
      if (t.current()) emit({ preview: value });
    } catch (e) { fail(e, t); } finally { finish(t); }
  }
  async function confirmSubmit() {
    if (state.confirmation !== "run" || !canSubmit()) return;
    let input;
    try { input = parseWorkflowExecutionInput(state.input, state.preview.inputFields); } catch (e) { emit({ issue: workflowExecutionIssue(e), confirmation: null }); return; }
    const publicationId = state.preview.publication.id, approvedKeys = [...state.preview.inputFields], t = begin(); if (!t) return;
    try {
      const { auth } = await authorize(t, EXECUTE);
      const value = await t.execution.preview(t.scope.workspaceId, publicationId, { signal: t.signal });
      originMatches(value.publication, t, publicationId, true);
      check(JSON.stringify([...value.inputFields].sort()) === JSON.stringify(approvedKeys.sort()));
      await authorize(t, EXECUTE, auth);
      if (!value.modelExecutionConfigured) { emit({ preview: value, input: "", notice: "模型执行未配置，未提交；已有授权结果仍可手动读取。" }); return; }
      const key = makeKey(); check(typeof key === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(key));
      const pending = { kind: "run", memberId: t.scope.memberId, workspaceId: t.scope.workspaceId, workflowId: t.scope.workflowId, publicationId, key };
      lock = pending; emit({ input: "", result: null, recovery: null, review: null });
      const result = await t.execution.submit(t.scope.workspaceId, { publicationId, input, idempotencyKey: key }, { signal: t.signal });
      input = null; originMatches(result.origin, t, publicationId, true);
      lock = { ...pending, runId: result.run.id };
      await authorize(t, EXECUTE, auth);
      if (t.current()) emit({ result, runId: result.run.id });
    } catch (e) { fail(e, t); } finally { input = null; finish(t); }
  }
  async function readRun(recover = false) {
    if (state.busy || !has(state.auth, READ_RUN) || recover && (!sameOwner(lock, state.scope) || lock.kind !== "run") || !recover && !opaque(state.runId)) return;
    const pending = lock, runId = state.runId, t = begin(); if (!t) return;
    emit({ result: null, recovery: null });
    try {
      const { auth } = await authorize(t, READ_RUN);
      const result = recover ? await t.execution.recover(t.scope.workspaceId, pending.key, { signal: t.signal }) :
        await t.execution.read(t.scope.workspaceId, runId, { signal: t.signal });
      originMatches(result.origin, t, recover ? pending.publicationId : null);
      if (recover) check(!pending.runId || result.request.id === pending.runId);
      await authorize(t, READ_RUN, auth);
      if (t.current()) {
        if (recover && lock === pending) lock = { ...pending, runId: result.request.id };
        emit(recover ? { recovery: result, runId: result.request.id } : { result, runId: result.run.id });
      }
    } catch (e) { fail(e, t); } finally { finish(t); }
  }
  const canResolveRun = () => Boolean(!state.busy && sameOwner(lock, state.scope) && lock.kind === "run" &&
    has(state.auth, READ_RUN) && state.recovery?.origin.id === lock.publicationId && state.recovery.request.id === lock.runId && terminal(state.recovery.request));
  async function resolveRun() {
    if (!canResolveRun()) return;
    const pending = lock, t = begin(); if (!t) return;
    try {
      const { auth } = await authorize(t, READ_RUN);
      const value = await t.execution.recover(t.scope.workspaceId, pending.key, { signal: t.signal });
      originMatches(value.origin, t, pending.publicationId); check(value.request.id === pending.runId && terminal(value.request));
      await authorize(t, READ_RUN, auth);
      if (t.current() && lock === pending) { lock = null; emit({ recovery: value, notice: "原键 GET 已确认终态且预算已结清或释放；你已明确结束原请求。" }); }
    } catch (e) { fail(e, t); } finally { finish(t); }
  }
  async function reviewPublicationWrite(acknowledge = false) {
    if (state.busy || !sameOwner(lock, state.scope) || lock.kind !== "publication" || !has(state.auth, PUBLISH) || acknowledge && !state.review) return;
    const pending = lock, review = state.review, t = begin(); if (!t) return;
    try {
      const { auth } = await authorize(t, PUBLISH);
      const publication = await t.execution.publication(t.scope.workspaceId, t.scope.workflowId, { signal: t.signal });
      publicationMatches(publication, t); await authorize(t, PUBLISH, auth);
      if (acknowledge) check(JSON.stringify(publication) === JSON.stringify(review));
      if (t.current() && lock === pending) {
        if (acknowledge) { lock = null; emit({ publication, review: null, notice: "已按当前权限核对实际发布状态并明确结束此次核对；这不证明原 POST 未生效。" }); onWorkflowChanged(); }
        else emit({ publication, review: publication });
      }
    } catch (e) { fail(e, t); } finally { finish(t); }
  }
  return {
    getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, setScope, suspend,
    setRequest: next => { if (request !== next) { suspend(); request = next; } }, setOnWorkflowChanged: next => { onWorkflowChanged = next; }, setOnScopeRejected: next => { onScopeRejected = next ?? (() => {}); },
    verifyAccess, readPublication, preview, canPublish, canUnpublish, canSubmit, requestConfirmation, cancelConfirmation: () => emit({ confirmation: null }),
    confirmPublication, confirmSubmit, readRun: () => readRun(false), recover: () => readRun(true), canResolveRun, resolveRun,
    reviewPublicationWrite: () => reviewPublicationWrite(false), acknowledgePublicationWrite: () => reviewPublicationWrite(true),
    setField: (field, value) => {
      if (state.busy || !state.scope || typeof value !== "string") return;
      if (field === "input" && canSubmit() && bytes(value) <= 65536) emit({ input: value, confirmation: null, issue: null });
      if (field === "runId" && has(state.auth, READ_RUN) && value.length <= 128) emit({ runId: value, result: null, confirmation: null });
    }
  };
}
