// Per-page private memory only. Server session, membership and ownership remain authoritative.
const READ = "workspace.ai.assets.read", MANAGE = "workspace.ai.assets.manage";
const id = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const record = v => v && typeof v === "object" && !Array.isArray(v);
const text = v => typeof v === "string";
const revision = v => Number.isInteger(v) && v > 0 && v <= 2147483647;
const code = v => text(v) && v.length >= 2 && v.length <= 63 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(v);
const date = v => text(v) && Number.isFinite(Date.parse(v));
const kinds = ["preference", "confirmed_fact", "task_summary"];
const safeText = (v, max, bytes) => text(v) && v.trim() && v.length <= max && !v.includes("\0") && new TextEncoder().encode(v).length <= bytes && new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(v)) === v;
const blankDraft = () => ({ code: "", title: "", content: "", kind: "preference", enabled: false, agentIds: [] });
const privateState = () => ({ items: [], nextCursor: null, detail: null, editor: null, draft: blankDraft(), confirmation: null, agents: [], agentCursor: null, grants: {}, optionsLoaded: false, issue: null, notice: "" });
const initial = () => ({ ...privateState(), phase: "loading", principal: null, workspaces: [], workspaceId: "", context: null, busy: false });
class InvalidResponse extends Error {}
const check = v => { if (!v) throw new InvalidResponse(); };
export function validMemoryDraft(d, creating = true) {
  return Boolean(record(d) && (!creating || code(d.code)) && safeText(d.title, 100, 400) && safeText(d.content, 4000, 16384) && kinds.includes(d.kind) && typeof d.enabled === "boolean" && Array.isArray(d.agentIds) && d.agentIds.length <= 16 && new Set(d.agentIds).size === d.agentIds.length && d.agentIds.every(id));
}
const content = d => ({ title: d.title, content: d.content, kind: d.kind, enabled: d.enabled, agentIds: [...d.agentIds].sort() });
function summary(v) {
  check(record(v) && id(v.id) && code(v.code) && safeText(v.title, 100, 400) && kinds.includes(v.kind) && typeof v.enabled === "boolean" && revision(v.revision) && date(v.createdAt) && date(v.updatedAt));
  return { id: v.id, code: v.code, title: v.title, kind: v.kind, enabled: v.enabled, revision: v.revision, createdAt: v.createdAt, updatedAt: v.updatedAt };
}
function memory(v, expectedId) {
  const s = summary(v); check((!expectedId || s.id === expectedId) && validMemoryDraft(v));
  return { ...s, ...content(v) };
}
function agent(v, expectedId) {
  check(record(v) && id(v.id) && (!expectedId || v.id === expectedId) && safeText(v.name, 100, 400) && code(v.code) && typeof v.enabled === "boolean");
  return { id: v.id, name: v.name, code: v.code, enabled: v.enabled };
}
function page(v, afterId, mapper) {
  check(record(v) && Array.isArray(v.items) && v.items.length <= 20);
  const items = v.items.map(x => mapper(x));
  check(items.every((x,i) => (!afterId || x.id > afterId) && (!i || x.id > items[i-1].id)) && (v.nextCursor === null || items.length === 20 && v.nextCursor === items.at(-1).id));
  return { items, nextCursor: v.nextCursor };
}
export function memoryIssue(error, operation = "read") {
  const status = typeof error?.status === "number" ? error.status : 0;
  const writing = ["create", "update", "delete"].includes(operation);
  if (error instanceof InvalidResponse) return { kind: "invalid-response", status: 0, message: writing ? "服务端结果无法确认，请重新验证访问并核对列表后再操作。页面不会自动重试写入。" : "返回的数据无法确认，请重新验证访问。" };
  const messages = {
    400: ["input", "输入未通过校验，请检查编号、标题、内容和授权选择。"],
    401: ["unauthorized", "登录已失效，私有内容已清除，请重新登录。"],
    403: ["forbidden", "当前空间或角色权限不可用，私有内容已清除。请重新验证访问或联系管理员。"],
    404: ["unavailable", "记忆或相关能力不可用，可能已删除或尚未启用。请刷新列表并联系管理员确认。"],
    409: operation === "create" ? ["code-conflict", "编号或数量限制冲突。请刷新核对已有记忆；相同编号可能返回已有内容，删除过的编号不能复用。"] : ["revision-conflict", "当前记忆已变化。请重新读取当前记忆，重新检查启用与授权选择后确认；不会自动覆盖。"],
    503: ["service-unavailable", "服务暂不可用，请联系管理员确认配置。"]
  };
  const [kind, message] = messages[status] ?? [error?.name === "TimeoutError" ? "timeout" : "network", "请求未完成，请检查连接并重新验证访问。"];
  return { kind, status, message: writing && ![400,401,403,404,409].includes(status) ? message + " 写入结果未确认，请先重新读取列表核对；页面不会自动重试写入。" : message };
}

export function createMemoryLibrary({ request, memoriesClientFactory, agentsClientFactory, configured = () => true, onUnauthorized = () => {}, timeoutMs = 8000 }) {
  let state = initial(), epoch = 0, controller = new AbortController(), disposed = false, preferredWorkspace = "";
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const canRead = () => Boolean(state.context?.permissions.includes(READ));
  const canManage = () => canRead() && state.context.permissions.includes(MANAGE) && !state.issue;
  function scopedRequest(path, options, scopeSignal) {
    const signal = AbortSignal.any([scopeSignal, AbortSignal.timeout(timeoutMs)]);
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      Promise.resolve().then(() => { signal.throwIfAborted(); return request(path, { ...options, signal }); }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  function begin(patch = {}) {
    controller.abort(); controller = new AbortController();
    const generation = ++epoch, signal = controller.signal, workspaceId = state.workspaceId;
    publish({ busy: true, issue: null, notice: "", confirmation: null, ...patch });
    const transport = (path, options = {}) => scopedRequest(path, options, signal);
    return { workspaceId, signal, current: () => !disposed && epoch === generation && !signal.aborted, memories: memoriesClientFactory(transport), agents: agentsClientFactory(transport) };
  }
  function failure(e, op, t) {
    if (!t.current()) return;
    const issue = memoryIssue(e, op);
    if ([401,403].includes(issue.status)) {
      controller.abort(); ++epoch;
      publish({ ...initial(), phase: "ready", issue });
      if (issue.status === 401) onUnauthorized();
    } else if (["create","update","delete"].includes(op)) {
      // Even a timed-out mutation may have committed. Require an explicit re-read.
      publish({ ...privateState(), items: state.items, nextCursor: state.nextCursor, issue });
    } else if ([404].includes(issue.status) || e instanceof InvalidResponse) publish({ ...privateState(), issue });
    else publish({ issue });
  }
  const finish = t => { if (t.current()) publish({ busy: false }); };
  async function start(preferredId = preferredWorkspace) {
    disposed = false; preferredWorkspace = preferredId;
    const t = begin({ ...initial(), busy: true });
    try {
      if (!configured()) { publish({ phase: "ready", issue: { kind: "unconfigured", status: 0, message: "当前页面尚未配置服务地址，请联系管理员后重新验证访问。" } }); return; }
      const p = await scopedRequest("/client/auth/me", {}, t.signal); if (!t.current()) return;
      check(record(p) && id(p.id));
      const w = await scopedRequest("/client/workspaces?page=1&pageSize=100", {}, t.signal); if (!t.current()) return;
      check(record(w) && Array.isArray(w.items) && w.items.length <= 100 && w.items.every(x => id(x.workspace?.id) && text(x.workspace.name) && text(x.role?.name)));
      const workspaces = w.items.map(x => ({ workspace: { id: x.workspace.id, name: x.workspace.name }, role: { name: x.role.name } }));
      const workspaceId = preferredId ? workspaces.find(x => x.workspace.id === preferredId)?.workspace.id ?? "" : workspaces[0]?.workspace.id ?? "";
      publish({ principal: { id: p.id, nickname: text(p.nickname) ? p.nickname : "", email: text(p.email) ? p.email : null }, workspaces, workspaceId });
      if (!workspaceId) { publish({ phase: "ready", ...(preferredId ? { issue: { kind: "space-unavailable", status: 0, message: "先前空间当前不可访问，请明确选择可访问的空间。" } } : {}) }); return; }
      preferredWorkspace = workspaceId;
      const c = await scopedRequest("/client/workspaces/context", { workspaceId }, t.signal); if (!t.current()) return;
      check(record(c) && c.workspaceId === workspaceId && text(c.workspaceName) && Array.isArray(c.permissions) && c.permissions.every(text));
      publish({ context: { workspaceId, workspaceName: c.workspaceName, permissions: [...c.permissions] } });
      if (canRead()) { const v = await t.memories.list(workspaceId, { limit: 20 }); if (!t.current()) return; publish(page(v, undefined, summary)); }
      publish({ phase: "ready" });
    } catch (e) { failure(e, "read", t); if (t.current()) publish({ phase: "ready" }); } finally { finish(t); }
  }
  async function nextPage() {
    if (disposed || state.busy || !canRead() || !state.nextCursor) return;
    const afterId = state.nextCursor, t = begin(privateState());
    try { const v = await t.memories.list(t.workspaceId, { limit: 20, afterId }); if (t.current()) publish(page(v, afterId, summary)); }
    catch (e) { failure(e, "read", t); } finally { finish(t); }
  }
  async function verifyGrants(t, agentIds) {
    const grants = {};
    for (const agentId of agentIds) {
      try {
        const v = await t.agents.get(t.workspaceId, agentId); if (!t.current()) return null;
        grants[agentId] = { ...agent(v, agentId), available: true };
      } catch (e) { if (!t.current()) return null; if (e?.status !== 404) throw e; grants[agentId] = { available: false }; }
    }
    return grants;
  }
  async function openDetail(memoryId) {
    if (disposed || state.busy || !canRead() || !id(memoryId)) return;
    const t = begin({ ...privateState(), items: state.items, nextCursor: state.nextCursor });
    try {
      const v = await t.memories.get(t.workspaceId, memoryId); if (!t.current()) return;
      const detail = memory(v, memoryId); publish({ detail });
      const grants = await verifyGrants(t, detail.agentIds); if (t.current() && grants) publish({ grants });
    } catch (e) { failure(e, "read", t); } finally { finish(t); }
  }
  async function openEditor(creating) {
    if (disposed || state.busy || !canManage() || !creating && !state.detail) return;
    const d = creating ? blankDraft() : { code: state.detail.code, ...content(state.detail) };
    const t = begin({ editor: creating ? "create" : "edit", ...(creating ? { detail: null } : {}), draft: d, grants: {}, agents: [], agentCursor: null, optionsLoaded: false });
    try {
      const v = await t.agents.list(t.workspaceId, { limit: 20 }); if (!t.current()) return;
      const p = page(v, undefined, agent); publish({ agents: p.items, agentCursor: p.nextCursor, optionsLoaded: true });
      const grants = await verifyGrants(t, d.agentIds); if (t.current() && grants) publish({ grants });
    } catch (e) { failure(e, "read", t); } finally { finish(t); }
  }
  async function loadAgents(next = false) {
    if (disposed || state.busy || !canRead() || !state.editor || next && !state.agentCursor) return;
    const afterId = next ? state.agentCursor : undefined;
    const t = begin({ agents: [], agentCursor: null, optionsLoaded: false });
    try {
      const v = await t.agents.list(t.workspaceId, { limit: 20, ...(afterId ? { afterId } : {}) }); if (!t.current()) return;
      const p = page(v, afterId, agent); publish({ agents: p.items, agentCursor: p.nextCursor, optionsLoaded: true });
      const grants = await verifyGrants(t, state.draft.agentIds); if (t.current() && grants) publish({ grants });
    } catch (e) { failure(e, "read", t); } finally { finish(t); }
  }
  const editable = () => !disposed && !state.busy && canManage() && state.editor && !state.confirmation;
  function setDraft(field, value) {
    if (!editable() || !["code","title","content","kind","enabled"].includes(field) || field === "code" && state.editor !== "create") return;
    publish({ draft: { ...state.draft, [field]: value } });
  }
  function addGrant(agentId) {
    if (!editable() || state.draft.agentIds.length >= 16 || state.draft.agentIds.includes(agentId)) return;
    const choice = state.agents.find(x => x.id === agentId); if (!choice) return;
    publish({ draft: { ...state.draft, agentIds: [...state.draft.agentIds, agentId].sort() }, grants: { ...state.grants, [agentId]: { ...choice, available: true } } });
  }
  function removeGrant(agentId) { if (editable()) { const grants = { ...state.grants }; delete grants[agentId]; publish({ draft: { ...state.draft, agentIds: state.draft.agentIds.filter(x => x !== agentId) }, grants }); } }
  const readyToSave = () => Boolean(editable() && state.optionsLoaded && validMemoryDraft(state.draft, state.editor === "create") && state.draft.agentIds.every(x => state.grants[x]?.available));
  function requestSave() { if (readyToSave()) publish({ confirmation: state.editor === "create" ? "create" : "update" }); }
  function requestDelete() { if (!disposed && !state.busy && canManage() && state.detail) publish({ confirmation: "delete", editor: null, draft: blankDraft() }); }
  async function confirmMutation() {
    if (disposed || state.busy || !canManage() || !state.confirmation) return;
    const op = state.confirmation, detail = state.detail, d = state.draft;
    if (op !== "create" && !detail || op !== "delete" && (!state.optionsLoaded || !validMemoryDraft(d, op === "create") || !d.agentIds.every(x => state.grants[x]?.available))) return;
    const t = begin(); let committed = false;
    try {
      const v = op === "create" ? await t.memories.create(t.workspaceId, { code: d.code, ...content(d) }) : op === "update" ? await t.memories.update(t.workspaceId, detail.id, { ...content(d), expectedRevision: detail.revision }) : await t.memories.delete(t.workspaceId, detail.id, detail.revision);
      if (!t.current()) return;
      if (op === "delete") check(record(v) && v.id === detail.id && v.deleted === true && revision(v.revision) && v.revision === detail.revision + 1);
      else { const saved = memory(v, op === "update" ? detail.id : undefined); check(saved.code === d.code && (op !== "update" || saved.revision >= detail.revision && saved.revision <= detail.revision + 1)); }
      committed = true;
      publish({ ...privateState(), notice: op === "delete" ? "服务端已确认删除当前记忆内容和授权，无法恢复，编号不能复用。" : "服务端已确认保存。相同编号可能返回已有内容，请查看列表中的当前内容与授权；保存许可不代表任务已执行。" });
      const p = await t.memories.list(t.workspaceId, { limit: 20 }); if (t.current()) publish(page(p, undefined, summary));
    } catch (e) {
      if (committed && t.current()) { const notice = state.notice; failure(e, "read", t); if (t.current()) publish({ notice, issue: { ...memoryIssue(e), message: "写入已确认，但列表刷新未完成。请重新验证访问核对列表，不要重复提交。" } }); }
      else failure(e, op, t);
    } finally { finish(t); }
  }
  function closeDetail() { if (!disposed) { controller.abort(); ++epoch; publish({ ...privateState(), items: state.items, nextCursor: state.nextCursor, busy: false }); } }
  async function signOut() {
    if (disposed) return;
    preferredWorkspace = ""; const t = begin({ ...initial(), phase: "ready", busy: true });
    try { await scopedRequest("/client/auth/logout", { method: "POST" }, t.signal); if (t.current()) onUnauthorized(); }
    catch (e) { failure(e, "logout", t); } finally { finish(t); }
  }
  function dispose() { disposed = true; controller.abort(); ++epoch; publish({ ...initial(), phase: "ready" }); }
  return { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, start, selectWorkspace: start, refresh: () => start(), nextPage, openDetail,
    openCreate: () => openEditor(true), openEdit: () => openEditor(false), loadAgents, setDraft, addGrant, removeGrant, readyToSave, requestSave, requestDelete, confirmMutation, closeDetail, signOut, dispose,
    cancelConfirmation: () => { if (!disposed && !state.busy) publish({ confirmation: null }); } };
}
