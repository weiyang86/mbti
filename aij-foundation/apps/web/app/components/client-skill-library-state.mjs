// Private page memory only. The server remains the owner of authorization,
// content, revisions, replay and deletion; no browser persistence is used.
const READ = "workspace.ai.assets.read", MANAGE = "workspace.ai.assets.manage";
const LIST_LIMIT = 20, HISTORY_LIMIT = 10;
const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const record = value => value && typeof value === "object" && !Array.isArray(value);
const text = value => typeof value === "string";
const revision = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const date = value => text(value) && Number.isFinite(Date.parse(value));
class InvalidResponse extends Error {}
const requireResponse = condition => { if (!condition) throw new InvalidResponse(); };
const blankDraft = () => ({ code: "", name: "", instructions: "" });
const privateState = () => ({ items: [], nextCursor: null, detail: null, versions: [], versionCursor: null,
  historical: null, editor: null, draft: blankDraft(), confirmation: null, issue: null, notice: "" });
const initial = () => ({ ...privateState(), phase: "loading", principal: null, workspaces: [], workspaceId: "", context: null, busy: false });

function parseSkill(value, { detail = false, expectedId } = {}) {
  requireResponse(record(value) && id(value.id) && (!expectedId || value.id === expectedId) &&
    text(value.code) && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value.code) && value.code.length >= 2 && value.code.length <= 63 &&
    text(value.name) && value.name.length > 0 && value.name.length <= 100 && revision(value.revision) &&
    date(value.createdAt) && date(value.updatedAt) && (!detail || text(value.instructions) && value.instructions.length <= 8000));
  return { id: value.id, code: value.code, name: value.name, revision: value.revision, createdAt: value.createdAt, updatedAt: value.updatedAt,
    ...(detail ? { instructions: value.instructions } : {}) };
}
function parseList(value, afterId) {
  requireResponse(record(value) && Array.isArray(value.items) && value.items.length <= LIST_LIMIT);
  const items = value.items.map(item => parseSkill(item));
  requireResponse(items.every((item, i) => (!afterId || item.id > afterId) && (!i || item.id > items[i - 1].id)) &&
    (value.nextCursor === null || items.length === LIST_LIMIT && value.nextCursor === items.at(-1).id));
  return { items, nextCursor: value.nextCursor };
}
function parseVersions(value, skill, beforeRevision) {
  requireResponse(record(value) && Array.isArray(value.items) && value.items.length <= HISTORY_LIMIT);
  const items = value.items.map(item => {
    requireResponse(record(item) && id(item.id) && item.skillId === skill.id && item.code === skill.code &&
      revision(item.revision) && item.revision <= skill.revision && (!beforeRevision || item.revision < beforeRevision) &&
      text(item.name) && item.name.length > 0 && item.name.length <= 100 && text(item.instructions) && item.instructions.length <= 8000 && date(item.createdAt));
    return { id: item.id, skillId: item.skillId, code: item.code, name: item.name, instructions: item.instructions, revision: item.revision, createdAt: item.createdAt };
  });
  requireResponse(items.every((item, i) => !i || item.revision < items[i - 1].revision) &&
    (value.nextCursor === null || items.length === HISTORY_LIMIT && value.nextCursor === items.at(-1).revision));
  return { versions: items, versionCursor: value.nextCursor };
}
export function validSkillDraft(draft, creating = true) {
  return Boolean(record(draft) && text(draft.name) && draft.name.trim() && draft.name === draft.name.trim() && draft.name.length <= 100 && !draft.name.includes("\0") &&
    text(draft.instructions) && draft.instructions.trim() && draft.instructions.length <= 8000 && !draft.instructions.includes("\0") &&
    new TextEncoder().encode(draft.instructions).length <= 32768 && (!creating || text(draft.code) && draft.code.length >= 2 && draft.code.length <= 63 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(draft.code)));
}
export function skillIssue(error, operation = "read") {
  const status = typeof error?.status === "number" ? error.status : 0;
  if (error instanceof InvalidResponse) return { kind: "invalid-response", status, message: "暂时无法读取 Skill 数据，请重新验证访问。" };
  const messages = {
    400: ["input", "输入未通过校验，请检查编号、名称和提示词长度。"],
    401: ["unauthorized", "登录已失效，私有内容已清除，请重新登录。"],
    403: ["forbidden", "空间、成员或角色权限不可用，私有内容已清除。请重新验证访问或联系管理员。"],
    404: ["unavailable", "记录或 Skill 能力不可用，可能已删除或插件未启用。请刷新列表并联系管理员确认。"],
    409: operation === "create" ? ["code-conflict", "编号或数量限制冲突：请刷新核对已有 Skill，修改编号或清理数量后重新确认；删除过的编号不能复用。"] :
      ["revision-conflict", "当前版本已变化，操作未覆盖新版本。请重新读取当前版本，再编辑或确认删除。"],
    503: ["service-unavailable", "服务暂不可用，请联系管理员确认服务配置。"]
  };
  const [kind, message] = messages[status] ?? ["network", "网络请求未完成，请检查连接后刷新。"];
  return { kind, status, message: ![400, 401, 403, 404, 409].includes(status) && ["create", "update", "delete"].includes(operation)
    ? message + " 写入结果未确认，请先刷新核对；页面不会自动重试写入。" : message };
}

/** Inject the compiled SDK factory; decorate its existing ClientApi transport with
 * this operation's AbortSignal. Epochs also guard transports that ignore abort. */
export function createSkillLibrary({ request, skillsClientFactory, configured = () => true, onUnauthorized = () => {} }) {
  let state = initial(), epoch = 0, controller = new AbortController(), disposed = false;
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const canRead = () => Boolean(state.context?.permissions.includes(READ));
  const canManage = () => canRead() && state.context.permissions.includes(MANAGE) &&
    !["unavailable", "service-unavailable", "invalid-response"].includes(state.issue?.kind);
  // Supplying an explicit scope signal overrides ClientApi's default timeout.
  // Retain both protections; a timeout is a visible network failure, while a
  // disposed scope is ignored by the epoch guard.
  const scopedRequest = (path, options, signal) => request(path, { ...options, signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]) });
  function begin(patch = {}) {
    controller.abort(); controller = new AbortController(); const generation = ++epoch;
    const signal = controller.signal, workspaceId = state.workspaceId;
    publish({ busy: true, issue: null, notice: "", confirmation: null, ...patch });
    return { current: () => !disposed && epoch === generation && !signal.aborted, signal, workspaceId,
      api: skillsClientFactory((path, options = {}) => scopedRequest(path, options, signal)) };
  }
  function failure(error, op, ticket) {
    if (!ticket.current()) return;
    const issue = skillIssue(error, op);
    if ([401, 403].includes(issue.status)) {
      controller.abort(); ++epoch;
      publish({ ...privateState(), context: null, ...(issue.status === 401 ? { principal: null, workspaces: [], workspaceId: "" } : {}), phase: "ready", busy: false, issue });
      if (issue.status === 401) onUnauthorized();
    } else publish({ issue, ...(issue.status === 404 || error instanceof InvalidResponse ? { detail: null, editor: null, draft: blankDraft(), versions: [], versionCursor: null, historical: null } : {}) });
  }
  const finish = ticket => { if (ticket.current()) publish({ busy: false }); };

  async function start(preferredId = state.workspaceId) {
    disposed = false;
    const ticket = begin({ ...initial(), busy: true });
    try {
      if (!configured()) {
        publish({ phase: "ready", issue: { kind: "unconfigured", status: 503, message: "当前页面尚未配置 API 地址，请联系管理员配置后重新验证访问。" } });
        return;
      }
      const principal = await scopedRequest("/client/auth/me", {}, ticket.signal);
      if (!ticket.current()) return;
      requireResponse(record(principal) && id(principal.id));
      const page = await scopedRequest("/client/workspaces?page=1&pageSize=100", {}, ticket.signal);
      if (!ticket.current()) return;
      requireResponse(record(page) && Array.isArray(page.items) && page.items.length <= 100 && page.items.every(item => record(item) && id(item.workspace?.id) && text(item.workspace.name) && text(item.role?.name)));
      const workspaces = page.items.map(item => ({ workspace: { id: item.workspace.id, name: item.workspace.name }, role: { name: item.role.name } }));
      const workspaceId = workspaces.find(item => item.workspace.id === preferredId)?.workspace.id ?? workspaces[0]?.workspace.id ?? "";
      publish({ principal: { id: principal.id, nickname: text(principal.nickname) ? principal.nickname : "", email: text(principal.email) ? principal.email : null }, workspaces, workspaceId });
      if (!workspaceId) { publish({ phase: "ready" }); return; }
      const context = await scopedRequest("/client/workspaces/context", { workspaceId }, ticket.signal);
      if (!ticket.current()) return;
      requireResponse(record(context) && context.workspaceId === workspaceId && text(context.workspaceName) && Array.isArray(context.permissions) && context.permissions.every(text));
      publish({ context: { workspaceId, workspaceName: context.workspaceName, permissions: [...context.permissions] } });
      if (canRead()) {
        const result = await ticket.api.list(workspaceId, { limit: LIST_LIMIT });
        if (!ticket.current()) return;
        publish(parseList(result));
      }
      publish({ phase: "ready" });
    } catch (error) { failure(error, "read", ticket); if (ticket.current()) publish({ phase: "ready" }); }
    finally { finish(ticket); }
  }
  async function nextPage() {
    if (disposed || state.busy || !canRead() || !state.nextCursor) return;
    const afterId = state.nextCursor, ticket = begin({ ...privateState() });
    try { const value = await ticket.api.list(ticket.workspaceId, { limit: LIST_LIMIT, afterId });
      if (ticket.current()) publish(parseList(value, afterId));
    } catch (error) { failure(error, "read", ticket); } finally { finish(ticket); }
  }
  async function openDetail(skillId) {
    if (disposed || !canRead() || !id(skillId)) return;
    const ticket = begin({ detail: null, editor: null, draft: blankDraft(), versions: [], versionCursor: null, historical: null });
    try { const value = await ticket.api.get(ticket.workspaceId, skillId);
      if (ticket.current()) publish({ detail: parseSkill(value, { detail: true, expectedId: skillId }) });
    } catch (error) { failure(error, "read", ticket); } finally { finish(ticket); }
  }
  async function loadVersions(next = false) {
    if (disposed || state.busy || !canRead() || !state.detail || next && !state.versionCursor) return;
    const detail = state.detail, beforeRevision = next ? state.versionCursor : undefined;
    const ticket = begin({ versions: [], versionCursor: null, historical: null, editor: null, draft: blankDraft() });
    try { const value = await ticket.api.versions(ticket.workspaceId, detail.id, { limit: HISTORY_LIMIT, ...(beforeRevision ? { beforeRevision } : {}) });
      if (ticket.current()) publish(parseVersions(value, detail, beforeRevision));
    } catch (error) { failure(error, "read", ticket); } finally { finish(ticket); }
  }
  function openCreate() {
    if (disposed || state.busy || !canManage()) return;
    publish({ detail: null, editor: "create", draft: blankDraft(), confirmation: null, versions: [], versionCursor: null, historical: null, issue: null, notice: "" });
  }
  function openEdit() {
    if (disposed || state.busy || !canManage() || !state.detail) return;
    publish({ editor: "edit", draft: { code: state.detail.code, name: state.detail.name, instructions: state.detail.instructions }, versions: [], versionCursor: null, historical: null, confirmation: null, issue: null, notice: "" });
  }
  function setDraft(field, value) {
    if (disposed || state.busy || !canManage() || !state.editor || state.confirmation || !["code", "name", "instructions"].includes(field) || !text(value) || field === "code" && state.editor !== "create") return;
    publish({ draft: { ...state.draft, [field]: value } });
  }
  function requestSave() {
    if (!disposed && !state.busy && canManage() && state.editor && validSkillDraft(state.draft, state.editor === "create")) publish({ confirmation: state.editor === "create" ? "create" : "update" });
  }
  function requestDelete() {
    if (!disposed && !state.busy && canManage() && state.detail) publish({ confirmation: "delete", editor: null, draft: blankDraft(), historical: null, versions: [], versionCursor: null });
  }
  async function confirmMutation() {
    if (disposed || state.busy || !canManage() || !state.confirmation) return;
    const operation = state.confirmation, detail = state.detail, draft = { ...state.draft };
    if (operation !== "delete" && !validSkillDraft(draft, operation === "create") || operation !== "create" && !detail) return;
    const ticket = begin();
    try {
      const result = operation === "create" ? await ticket.api.create(ticket.workspaceId, draft) : operation === "update" ?
        await ticket.api.update(ticket.workspaceId, detail.id, { name: draft.name, instructions: draft.instructions, expectedRevision: detail.revision }) :
        await ticket.api.delete(ticket.workspaceId, detail.id, detail.revision);
      if (!ticket.current()) return;
      if (operation === "delete") requireResponse(record(result) && result.id === detail.id && result.deleted === true && revision(result.revision));
      else {
        const saved = parseSkill(result, { detail: true, ...(operation === "update" ? { expectedId: detail.id } : {}) });
        requireResponse(saved.code === draft.code && (operation !== "update" || saved.revision >= detail.revision && saved.revision <= detail.revision + 1));
      }
      publish({ ...privateState(), notice: operation === "delete" ? "服务端已确认删除。该编号不能复用，历史不会恢复为当前内容。" : "服务端已确认保存；相同编号可能返回已有记录，请从列表查看当前版本。" });
      const page = await ticket.api.list(ticket.workspaceId, { limit: LIST_LIMIT });
      if (ticket.current()) publish(parseList(page));
    } catch (error) { failure(error, operation, ticket); } finally { finish(ticket); }
  }
  function closeDetail() {
    if (disposed) return;
    controller.abort(); ++epoch;
    publish({ detail: null, versions: [], versionCursor: null, historical: null, editor: null, draft: blankDraft(), confirmation: null, issue: null, busy: false });
  }
  async function signOut() {
    const ticket = begin({ ...initial(), phase: "ready", busy: true });
    try { await scopedRequest("/client/auth/logout", { method: "POST" }, ticket.signal);
      if (ticket.current()) onUnauthorized();
    } catch (error) { failure(error, "logout", ticket); } finally { finish(ticket); }
  }
  function dispose() { disposed = true; controller.abort(); ++epoch; publish({ ...initial(), phase: "ready" }); }
  return { getSnapshot: () => state, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    start, selectWorkspace: start, refresh: () => start(state.workspaceId), nextPage, openDetail, openCreate, openEdit, setDraft,
    requestSave, requestDelete, confirmMutation, loadVersions, closeDetail, signOut, dispose,
    cancelConfirmation: () => { if (!state.busy && !disposed) publish({ confirmation: null }); },
    previewVersion: versionId => { if (!state.busy && !disposed) publish({ historical: state.versions.find(item => item.id === versionId) ?? null }); } };
}
