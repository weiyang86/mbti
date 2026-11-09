// Private configuration lives only in this page instance. Authorization and immutable
// revisions remain server-owned; every async branch shares an epoch and scope signal.
const READ = "workspace.ai.assets.read", MANAGE = "workspace.ai.assets.manage";
const id = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const record = v => v && typeof v === "object" && !Array.isArray(v);
const text = v => typeof v === "string";
const revision = v => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const date = v => text(v) && Number.isFinite(Date.parse(v));
class InvalidResponse extends Error {}
const check = v => { if (!v) throw new InvalidResponse(); };
const names = v => Array.isArray(v) && v.length <= 20 && new Set(v).size === v.length && v.every(n => text(n) && /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(n) && !["constructor", "prototype", "__proto__"].includes(n));
const blankDraft = () => ({ code: "", name: "", instructions: "", enabled: false, modelCode: "", modelRevision: 0, catalogVersion: 0, inputFields: ["input"], outputFormat: "text", outputFields: [], skillBindings: [] });
const privateState = () => ({ items: [], nextCursor: null, detail: null, versions: [], versionCursor: null, historical: null, editor: null, draft: blankDraft(), confirmation: null, issue: null, notice: "", models: null, skills: [], skillCursor: null, selectedSkill: null, skillVersions: [], skillVersionCursor: null, verifiedPins: {} });
const initial = () => ({ ...privateState(), phase: "loading", principal: null, workspaces: [], workspaceId: "", context: null, busy: false });
export function validAgentDraft(d, creating = true) {
  return Boolean(record(d) && text(d.name) && d.name.trim() && d.name === d.name.trim() && d.name.length <= 100 && !d.name.includes("\0") &&
    text(d.instructions) && d.instructions.trim() && d.instructions.length <= 8000 && !d.instructions.includes("\0") && new TextEncoder().encode(d.instructions).length <= 32768 &&
    typeof d.enabled === "boolean" && text(d.modelCode) && /^[a-z][a-z0-9-]{1,62}$/.test(d.modelCode) && revision(d.modelRevision) && revision(d.catalogVersion) &&
    names(d.inputFields) && d.inputFields.length > 0 && names(d.outputFields) && ["text", "json"].includes(d.outputFormat) && (d.outputFormat !== "json" || d.outputFields.length > 0) &&
    Array.isArray(d.skillBindings) && d.skillBindings.length <= 8 && new Set(d.skillBindings.map(p => p.skillId)).size === d.skillBindings.length && d.skillBindings.every(p => record(p) && id(p.skillId) && revision(p.revision)) &&
    (!creating || text(d.code) && d.code.length >= 2 && d.code.length <= 63 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(d.code)));
}
function summary(v) {
  check(record(v) && id(v.id) && text(v.code) && v.code.length >= 2 && v.code.length <= 63 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(v.code) && text(v.name) && v.name.trim() && v.name.length <= 100 && revision(v.revision) && date(v.createdAt) && date(v.updatedAt) && typeof v.enabled === "boolean");
  return { id: v.id, code: v.code, name: v.name, enabled: v.enabled, revision: v.revision, createdAt: v.createdAt, updatedAt: v.updatedAt };
}
function agent(v, expectedId) {
  const s = summary(v);
  check((!expectedId || s.id === expectedId) && validAgentDraft(v) && v.skillBindings.every(p => id(p.skillVersionId)));
  return { ...s, instructions: v.instructions, modelCode: v.modelCode, modelRevision: v.modelRevision, catalogVersion: v.catalogVersion, inputFields: [...v.inputFields], outputFormat: v.outputFormat, outputFields: [...v.outputFields], skillBindings: v.skillBindings.map(p => ({ skillId: p.skillId, revision: p.revision, skillVersionId: p.skillVersionId })) };
}
function list(v, afterId) {
  check(record(v) && Array.isArray(v.items) && v.items.length <= 20);
  const items = v.items.map(summary);
  check(items.every((x,i) => (!afterId || x.id > afterId) && (!i || x.id > items[i-1].id)) && (v.nextCursor === null || items.length === 20 && v.nextCursor === items.at(-1).id));
  return { items, nextCursor: v.nextCursor };
}
function models(v) {
  check(record(v) && revision(v.catalogVersion) && Array.isArray(v.items) && v.items.every(x => record(x) && text(x.name) && x.name.length > 0 && text(x.code) && /^[a-z][a-z0-9-]{1,62}$/.test(x.code) && revision(x.revision) && x.capability === "text") && new Set(v.items.map(x => x.code)).size === v.items.length);
  return { catalogVersion: v.catalogVersion, items: v.items.map(x => ({ code: x.code, name: x.name, revision: x.revision, capability: "text" })) };
}
function skillSummary(v) {
  check(record(v) && id(v.id) && text(v.code) && text(v.name) && revision(v.revision));
  return { id: v.id, code: v.code, name: v.name, revision: v.revision };
}
function skillPage(v, afterId) {
  check(record(v) && Array.isArray(v.items) && v.items.length <= 20);
  const skills = v.items.map(skillSummary);
  check(skills.every((x,i) => (!afterId || x.id > afterId) && (!i || x.id > skills[i-1].id)) && (v.nextCursor === null || skills.length === 20 && v.nextCursor === skills.at(-1).id));
  return { skills, skillCursor: v.nextCursor };
}
function skillHistory(v, skill, beforeRevision, limit = 10) {
  check(record(v) && Array.isArray(v.items) && v.items.length <= limit);
  const skillVersions = v.items.map(x => {
    check(record(x) && id(x.id) && x.skillId === skill.id && x.code === skill.code && revision(x.revision) && x.revision <= skill.revision && (!beforeRevision || x.revision < beforeRevision) && text(x.name) && text(x.instructions) && date(x.createdAt));
    return { id: x.id, skillId: x.skillId, code: x.code, name: x.name, instructions: x.instructions, revision: x.revision, createdAt: x.createdAt };
  });
  check(skillVersions.every((x,i) => !i || x.revision < skillVersions[i-1].revision) && (v.nextCursor === null || skillVersions.length === limit && v.nextCursor === skillVersions.at(-1).revision));
  return { skillVersions, skillVersionCursor: v.nextCursor };
}
const pinKey = p => `${p.skillId}:${p.revision}`;
export function agentIssue(error, operation = "read") {
  const status = typeof error?.status === "number" ? error.status : 0;
  if (error instanceof InvalidResponse) return { kind: "invalid-response", status, message: "暂时无法读取 Agent 数据，请重新验证访问。" };
  const messages = {
    400: ["input", "输入未通过校验，请检查编号、名称、指令、字段、模型与 Skill 版本。"],
    401: ["unauthorized", "登录已失效，私有内容已清除，请重新登录。"],
    403: ["forbidden", "空间、成员或角色权限不可用，私有内容已清除。请重新验证访问或联系管理员。"],
    404: ["unavailable", "记录或 Agent 能力不可用，可能已删除或插件未启用。请刷新列表并联系管理员确认。"],
    409: operation === "create" ? ["code-conflict", "编号、配置或数量限制冲突：请刷新核对已有 Agent、重新读取模型与 Skill 选项，并确认编号和数量；删除过的编号不能复用。"] :
      ["revision-conflict", "当前版本或可用配置已变化。请重新读取当前 Agent、模型选项和 Skill 版本，再编辑或确认删除。"],
    503: ["service-unavailable", "服务暂不可用，请联系管理员确认服务配置。"]
  };
  const [kind, message] = messages[status] ?? ["network", "网络请求未完成，请检查连接后刷新。"];
  return { kind, status, message: ![400, 401, 403, 404, 409].includes(status) && ["create", "update", "delete"].includes(operation)
    ? message + " 写入结果未确认，请先刷新核对；页面不会自动重试写入。" : message };
}


export function createAgentLibrary({ request, agentsClientFactory, skillsClientFactory, configured = () => true, onUnauthorized = () => {}, timeoutMs = 8000 }) {
  let state = initial(), epoch = 0, controller = new AbortController(), disposed = false, preferredWorkspace = "";
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const canRead = () => Boolean(state.context?.permissions.includes(READ));
  const canManage = () => canRead() && state.context.permissions.includes(MANAGE) && !["unconfigured", "unavailable", "service-unavailable", "invalid-response", "revision-conflict"].includes(state.issue?.kind);
  // The race bounds even a transport that ignores AbortSignal. The epoch also
  // suppresses its later success, rejection and finally callbacks after disposal.
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
    controller.abort(); controller = new AbortController(); const generation = ++epoch, signal = controller.signal, workspaceId = state.workspaceId;
    publish({ busy: true, issue: null, notice: "", confirmation: null, ...patch });
    const transport = (path, options = {}) => scopedRequest(path, options, signal);
    return { signal, workspaceId, current: () => !disposed && epoch === generation && !signal.aborted, api: agentsClientFactory(transport), skills: skillsClientFactory(transport) };
  }
  function failure(error, op, t) {
    if (!t.current()) return;
    const issue = agentIssue(error, op);
    if ([401, 403].includes(issue.status)) {
      controller.abort(); ++epoch;
      publish({ ...privateState(), context: null, ...(issue.status === 401 ? { principal: null, workspaces: [], workspaceId: "" } : {}), phase: "ready", busy: false, issue });
      if (issue.status === 401) onUnauthorized();
    } else publish({ issue, ...(issue.status === 404 || error instanceof InvalidResponse ? { ...privateState(), issue } : {}) });
  }
  const finish = t => { if (t.current()) publish({ busy: false }); };
  async function start(preferredId = preferredWorkspace) {
    disposed = false;
    preferredWorkspace = preferredId;
    const t = begin({ ...initial(), busy: true });
    try {
      if (!configured()) { publish({ phase: "ready", issue: { kind: "unconfigured", status: 0, message: "当前页面尚未配置服务地址，请联系管理员后重新验证访问。" } }); return; }
      const p = await scopedRequest("/client/auth/me", {}, t.signal); if (!t.current()) return;
      check(record(p) && id(p.id));
      const page = await scopedRequest("/client/workspaces?page=1&pageSize=100", {}, t.signal); if (!t.current()) return;
      check(record(page) && Array.isArray(page.items) && page.items.length <= 100 && page.items.every(x => id(x.workspace?.id) && text(x.workspace.name) && text(x.role?.name)));
      const workspaces = page.items.map(x => ({ workspace: { id: x.workspace.id, name: x.workspace.name }, role: { name: x.role.name } }));
      const workspaceId = workspaces.find(x => x.workspace.id === preferredId)?.workspace.id ?? workspaces[0]?.workspace.id ?? "";
      preferredWorkspace = workspaceId;
      publish({ principal: { id: p.id, nickname: text(p.nickname) ? p.nickname : "", email: text(p.email) ? p.email : null }, workspaces, workspaceId });
      if (!workspaceId) { publish({ phase: "ready" }); return; }
      const c = await scopedRequest("/client/workspaces/context", { workspaceId }, t.signal); if (!t.current()) return;
      check(record(c) && c.workspaceId === workspaceId && text(c.workspaceName) && Array.isArray(c.permissions) && c.permissions.every(text));
      publish({ context: { workspaceId, workspaceName: c.workspaceName, permissions: [...c.permissions] } });
      if (canRead()) { const v = await t.api.list(workspaceId, { limit: 20 }); if (!t.current()) return; publish(list(v)); }
      publish({ phase: "ready" });
    } catch (e) { failure(e, "read", t); if (t.current()) publish({ phase: "ready" }); } finally { finish(t); }
  }
  async function nextPage() {
    if (disposed || state.busy || !canRead() || !state.nextCursor) return;
    const afterId = state.nextCursor, t = begin(privateState());
    try { const v = await t.api.list(t.workspaceId, { limit: 20, afterId }); if (t.current()) publish(list(v, afterId)); }
    catch (e) { failure(e, "read", t); } finally { finish(t); }
  }
  async function openDetail(agentId) {
    if (disposed || !canRead() || !id(agentId)) return;
    const t = begin({ ...privateState(), items: state.items, nextCursor: state.nextCursor });
    try {
      const v = await t.api.get(t.workspaceId, agentId); if (!t.current()) return;
      const detail = agent(v, agentId); publish({ detail });
      const m = await t.api.modelOptions(t.workspaceId); if (!t.current()) return; publish({ models: models(m) });
      const pins = await verifyPins(t, detail.skillBindings); if (t.current() && pins) publish({ verifiedPins: pins });
    }
    catch (e) { failure(e, "read", t); } finally { finish(t); }
  }
  async function loadVersions(next = false) {
    if (disposed || state.busy || !canRead() || !state.detail || next && !state.versionCursor) return;
    const detail = state.detail, beforeRevision = next ? state.versionCursor : undefined, t = begin({ versions: [], historical: null, versionCursor: null, editor: null, draft: blankDraft() });
    try {
      const v = await t.api.versions(t.workspaceId, detail.id, { limit: 10, ...(beforeRevision ? { beforeRevision } : {}) }); if (!t.current()) return;
      check(record(v) && Array.isArray(v.items) && v.items.length <= 10);
      const versions = v.items.map(x => {
        check(record(x) && x.agentId === detail.id && x.code === detail.code && x.revision <= detail.revision && (!beforeRevision || x.revision < beforeRevision));
        const a = agent({ ...x, updatedAt: x.createdAt });
        const { updatedAt: _unused, ...version } = a; void _unused;
        return { ...version, agentId: x.agentId };
      });
      check(versions.every((x,i) => !i || x.revision < versions[i-1].revision) && (v.nextCursor === null || versions.length === 10 && v.nextCursor === versions.at(-1).revision));
      publish({ versions, versionCursor: v.nextCursor });
    } catch (e) { failure(e, "read", t); } finally { finish(t); }
  }
  async function verifyPins(t, bindings) {
    const verifiedPins = {};
    for (const pin of bindings) {
      try {
        const s = skillSummary(await t.skills.get(t.workspaceId, pin.skillId)); if (!t.current()) return null;
        check(s.id === pin.skillId);
        const v = skillHistory(await t.skills.versions(t.workspaceId, pin.skillId, { limit: 1, ...(pin.revision < 2147483647 ? { beforeRevision: pin.revision + 1 } : {}) }), s, pin.revision < 2147483647 ? pin.revision + 1 : undefined, 1); if (!t.current()) return null;
        const version = v.skillVersions.find(x => x.revision === pin.revision && (!pin.skillVersionId || x.id === pin.skillVersionId));
        verifiedPins[pinKey(pin)] = version ? { name: version.name, code: version.code, versionId: version.id, available: true } : { available: false };
      } catch (e) { if (!t.current()) return null; if (e?.status !== 404) throw e; verifiedPins[pinKey(pin)] = { available: false }; }
    }
    return verifiedPins;
  }
  async function openEditor(creating) {
    if (disposed || state.busy || !canManage() || !creating && !state.detail) return;
    const d = creating ? blankDraft() : { ...state.detail, inputFields: [...state.detail.inputFields], outputFields: [...state.detail.outputFields], skillBindings: state.detail.skillBindings.map(p => ({ skillId: p.skillId, revision: p.revision })) };
    const t = begin({ editor: creating ? "create" : "edit", ...(creating ? { detail: null } : {}), draft: d, versions: [], historical: null, versionCursor: null, models: null, skills: [], verifiedPins: {}, selectedSkill: null, skillVersions: [], skillVersionCursor: null });
    try {
      const m = await t.api.modelOptions(t.workspaceId); if (!t.current()) return; publish({ models: models(m) });
      const s = await t.skills.list(t.workspaceId, { limit: 20 }); if (!t.current()) return; publish(skillPage(s));
      const pins = await verifyPins(t, creating ? [] : state.detail.skillBindings); if (t.current() && pins) publish({ verifiedPins: pins });
    } catch (e) { failure(e, "read", t); } finally { finish(t); }
  }
  async function refreshModels() {
    if (disposed || state.busy || !canRead() || !state.editor) return;
    const t = begin({ models: null });
    try { const v = await t.api.modelOptions(t.workspaceId); if (t.current()) publish({ models: models(v) }); }
    catch (e) { failure(e, "read", t); } finally { finish(t); }
  }
  async function loadSkills(next = false) {
    if (disposed || state.busy || !canRead() || !state.editor || next && !state.skillCursor) return;
    const afterId = next ? state.skillCursor : undefined, t = begin({ skills: [], skillCursor: null, selectedSkill: null, skillVersions: [], skillVersionCursor: null });
    try { const v = await t.skills.list(t.workspaceId, { limit: 20, ...(afterId ? { afterId } : {}) }); if (t.current()) publish(skillPage(v, afterId)); }
    catch (e) { failure(e, "read", t); } finally { finish(t); }
  }
  async function selectSkill(skillId) {
    if (disposed || state.busy || !canRead() || !state.editor) return;
    const skill = state.skills.find(s => s.id === skillId); if (!skill) return;
    const t = begin({ selectedSkill: skill, skillVersions: [], skillVersionCursor: null });
    try { const v = await t.skills.versions(t.workspaceId, skill.id, { limit: 10 }); if (t.current()) publish(skillHistory(v, skill)); }
    catch (e) { failure(e, "read", t); } finally { finish(t); }
  }
  async function loadSkillVersions() {
    if (disposed || state.busy || !canRead() || !state.editor || !state.selectedSkill || !state.skillVersionCursor) return;
    const s = state.selectedSkill, beforeRevision = state.skillVersionCursor, t = begin({ skillVersions: [], skillVersionCursor: null });
    try { const v = await t.skills.versions(t.workspaceId, s.id, { limit: 10, beforeRevision }); if (t.current()) publish(skillHistory(v, s, beforeRevision)); }
    catch (e) { failure(e, "read", t); } finally { finish(t); }
  }
  async function recheckPins() {
    if (disposed || state.busy || !canRead() || !state.editor) return;
    const pins = state.draft.skillBindings, t = begin({ verifiedPins: {} });
    try { const v = await verifyPins(t, pins); if (t.current() && v) publish({ verifiedPins: v }); }
    catch (e) { failure(e, "read", t); } finally { finish(t); }
  }
  const editable = () => !disposed && !state.busy && canManage() && state.editor && !state.confirmation;
  function setDraft(field, value) {
    if (!editable() || !["code", "name", "instructions", "enabled", "inputFields", "outputFormat", "outputFields"].includes(field) || field === "code" && state.editor !== "create") return;
    publish({ draft: { ...state.draft, [field]: value } });
  }
  function selectModel(code) {
    if (!editable()) return;
    const option = state.models?.items.find(x => x.code === code); if (!option) return;
    publish({ draft: { ...state.draft, modelCode: option.code, modelRevision: option.revision, catalogVersion: state.models.catalogVersion } });
  }
  function addPin(versionId) {
    if (!editable() || state.draft.skillBindings.length >= 8) return;
    const v = state.skillVersions.find(x => x.id === versionId); if (!v || state.draft.skillBindings.some(p => p.skillId === v.skillId)) return;
    publish({ draft: { ...state.draft, skillBindings: [...state.draft.skillBindings, { skillId: v.skillId, revision: v.revision }] }, verifiedPins: { ...state.verifiedPins, [pinKey(v)]: { name: v.name, code: v.code, versionId: v.id, available: true } } });
  }
  function movePin(index, delta) {
    if (!editable() || ![-1, 1].includes(delta)) return;
    const pins = [...state.draft.skillBindings], target = index + delta; if (!pins[index] || !pins[target]) return;
    [pins[index], pins[target]] = [pins[target], pins[index]]; publish({ draft: { ...state.draft, skillBindings: pins } });
  }
  function removePin(index) { if (editable()) publish({ draft: { ...state.draft, skillBindings: state.draft.skillBindings.filter((_,i) => i !== index) } }); }
  const readyToSave = () => validAgentDraft(state.draft, state.editor === "create") && state.models?.catalogVersion === state.draft.catalogVersion && state.models.items.some(x => x.code === state.draft.modelCode && x.revision === state.draft.modelRevision) && state.draft.skillBindings.every(p => state.verifiedPins[pinKey(p)]?.available);
  function requestSave() { if (editable() && readyToSave()) publish({ confirmation: state.editor === "create" ? "create" : "update" }); }
  function requestDelete() { if (!disposed && !state.busy && canManage() && state.detail) publish({ confirmation: "delete", editor: null, draft: blankDraft(), versions: [], historical: null }); }
  async function confirmMutation() {
    if (disposed || state.busy || !canManage() || !state.confirmation) return;
    const op = state.confirmation, detail = state.detail, d = state.draft;
    if (op !== "delete" && !readyToSave() || op !== "create" && !detail) return;
    const content = { name: d.name, instructions: d.instructions, enabled: d.enabled, modelCode: d.modelCode, modelRevision: d.modelRevision, catalogVersion: d.catalogVersion, inputFields: d.inputFields, outputFormat: d.outputFormat, outputFields: d.outputFields, skillBindings: d.skillBindings };
    const t = begin();
    try {
      const v = op === "create" ? await t.api.create(t.workspaceId, { ...content, code: d.code }) : op === "update" ? await t.api.update(t.workspaceId, detail.id, { ...content, expectedRevision: detail.revision }) : await t.api.delete(t.workspaceId, detail.id, detail.revision);
      if (!t.current()) return;
      if (op === "delete") check(record(v) && v.id === detail.id && v.deleted === true && revision(v.revision));
      else { const saved = agent(v, op === "update" ? detail.id : undefined); check(saved.code === d.code && (op !== "update" || saved.revision >= detail.revision && saved.revision <= detail.revision + 1)); }
      publish({ ...privateState(), notice: op === "delete" ? "服务端已确认删除，编号不能复用。" : "服务端已确认保存配置；相同编号可能返回已有内容，请从列表核对当前版本。配置启用不代表任务已经执行。" });
      const page = await t.api.list(t.workspaceId, { limit: 20 }); if (t.current()) publish(list(page));
    } catch (e) { failure(e, op, t); } finally { finish(t); }
  }
  function closeDetail() { if (!disposed) { controller.abort(); ++epoch; publish({ ...privateState(), items: state.items, nextCursor: state.nextCursor, busy: false }); } }
  async function signOut() {
    if (disposed) return;
    preferredWorkspace = "";
    const t = begin({ ...initial(), phase: "ready", busy: true });
    try { await scopedRequest("/client/auth/logout", { method: "POST" }, t.signal); if (t.current()) onUnauthorized(); }
    catch (e) { failure(e, "logout", t); } finally { finish(t); }
  }
  function dispose() { disposed = true; controller.abort(); ++epoch; publish({ ...initial(), phase: "ready" }); }
  return { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, start, selectWorkspace: start, refresh: () => start(), nextPage, openDetail, loadVersions,
    openCreate: () => openEditor(true), openEdit: () => openEditor(false), refreshModels, loadSkills, selectSkill, loadSkillVersions, recheckPins, setDraft, selectModel, addPin, movePin, removePin,
    readyToSave, requestSave, requestDelete, confirmMutation, closeDetail, signOut, dispose,
    cancelConfirmation: () => { if (!disposed && !state.busy) publish({ confirmation: null }); },
    previewVersion: versionId => { if (!disposed && !state.busy && canRead()) publish({ historical: state.versions.find(x => x.id === versionId) ?? null }); } };
}
