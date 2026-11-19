import { createPersonalWorkflowsClient, createPersonalAgentsClient, validatePersonalWorkflowDraft } from "@aij/sdk";

const READ = "workspace.ai.assets.read", MANAGE = "workspace.ai.assets.manage";
const bad = ["constructor", "prototype", "__proto__"];
const id = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v) && !bad.includes(v);
const rev = v => Number.isInteger(v) && v > 0 && v <= 2147483647;
const text = (v, max = 100) => typeof v === "string" && v.length > 0 && v.length <= max && v === v.trim() && ![...v].some(c => { const n = c.codePointAt(0); return n < 32 || n === 127 || n >= 0xd800 && n <= 0xdfff; });
const code = v => text(v, 63) && v.length >= 2 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(v);
const date = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
class InvalidResponse extends Error {}
class StaleDependency extends Error { constructor() { super(); this.status = 409; } }
const check = v => { if (!v) throw new InvalidResponse(); };
function exact(v, fields) {
  check(v && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)));
  const descriptors = Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(v).length === fields.length && fields.every(k => descriptors[k]?.enumerable && "value" in descriptors[k]));
  return v;
}
function array(v, max = 20) {
  check(Array.isArray(v) && Object.getPrototypeOf(v) === Array.prototype && v.length <= max && Reflect.ownKeys(v).length === v.length + 1);
  for (let i = 0; i < v.length; i++) check(Object.getOwnPropertyDescriptor(v, String(i))?.enumerable && "value" in Object.getOwnPropertyDescriptor(v, String(i)));
  return v;
}
const common = ["id", "code", "name", "revision", "graphDigest", "status", "structuralValidity", "createdAt"];
function summary(v, history = false, full = false) {
  exact(v, [...common, history ? "workflowId" : "updatedAt", ...(full ? ["graph", "agentBindings"] : [])]);
  check(id(v.id) && code(v.code) && text(v.name) && rev(v.revision) && /^[a-f0-9]{64}$/.test(v.graphDigest) && v.status === "DRAFT" && v.structuralValidity === "VALID" && date(v.createdAt));
  check(history ? id(v.workflowId) : date(v.updatedAt) && Date.parse(v.updatedAt) >= Date.parse(v.createdAt));
  return Object.fromEntries([...common, history ? "workflowId" : "updatedAt"].map(k => [k, v[k]]));
}
export function parseWorkflowPage(raw, { afterId, parent, beforeRevision } = {}) {
  exact(raw, ["items", "nextCursor"]);
  const items = array(raw.items).map(v => summary(v, Boolean(parent)));
  check(new Set(items.map(x => x.id)).size === items.length);
  check(items.every((v,i) => parent ? v.workflowId === parent.id && v.code === parent.code && v.revision <= parent.revision && (!beforeRevision || v.revision < beforeRevision) && (!i || v.revision < items[i-1].revision) : (!afterId || v.id > afterId) && (!i || v.id > items[i-1].id)));
  check(raw.nextCursor === null || items.length === 20 && raw.nextCursor === (parent ? items.at(-1).revision : items.at(-1).id));
  return { items, nextCursor: raw.nextCursor };
}
export async function parseWorkflow(raw, { expectedId, parent, version } = {}) {
  const s = summary(raw, Boolean(parent), true);
  check(parent ? s.workflowId === parent.id && s.code === parent.code && s.revision === version.revision && s.id === version.id && s.graphDigest === version.graphDigest && s.name === version.name && s.createdAt === version.createdAt : !expectedId || s.id === expectedId);
  let validated;
  try { validated = validatePersonalWorkflowDraft(raw.graph); } catch { throw new InvalidResponse(); }
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(validated.canonical)))].map(b => b.toString(16).padStart(2, "0")).join("");
  check(s.graphDigest === digest);
  const bindings = array(raw.agentBindings, 64).map(p => {
    exact(p, ["nodeId", "agentId", "revision", "agentVersionId"]);
    check(id(p.agentVersionId) && validated.agentRefs.some(r => r.nodeId === p.nodeId && r.agentId === p.agentId && r.revision === p.revision));
    return { ...p };
  });
  check(bindings.length === validated.agentRefs.length && new Set(bindings.map(p => p.nodeId)).size === bindings.length);
  return { ...s, graph: structuredClone(raw.graph), agentBindings: bindings };
}
function agentSummary(v) {
  exact(v, ["id", "code", "name", "enabled", "revision", "createdAt", "updatedAt"]);
  check(id(v.id) && code(v.code) && text(v.name) && typeof v.enabled === "boolean" && rev(v.revision) && date(v.createdAt) && date(v.updatedAt));
  return { ...v };
}
function agentPage(v, afterId) {
  exact(v, ["items", "nextCursor"]); const items = array(v.items).map(agentSummary);
  check(items.every((a,i) => (!afterId || a.id > afterId) && (!i || a.id > items[i-1].id)) && (v.nextCursor === null || items.length === 20 && v.nextCursor === items.at(-1).id));
  return { items, nextCursor: v.nextCursor };
}
function agentVersions(v, agent, beforeRevision, limit = 20) {
  exact(v, ["items", "nextCursor"]);
  // AF159 exposes full immutable versions. Validate its bounded public shape,
  // then retain ONLY pin metadata; never store instructions or Skill content.
  const items = array(v.items, limit).map(x => {
    exact(x, ["id", "agentId", "code", "name", "enabled", "revision", "createdAt", "instructions", "modelCode", "modelRevision", "catalogVersion", "inputFields", "outputFormat", "outputFields", "skillBindings"]);
    if (rev(x.revision) && x.revision > agent.revision) throw new StaleDependency();
    check(id(x.id) && x.agentId === agent.id && x.code === agent.code && text(x.name) && typeof x.enabled === "boolean" && rev(x.revision) && x.revision <= agent.revision && (!beforeRevision || x.revision < beforeRevision) && date(x.createdAt));
    check(typeof x.instructions === "string" && x.instructions.trim() && x.instructions.length <= 8000 && !x.instructions.includes("\0") && new TextEncoder().encode(x.instructions).length <= 32768 && typeof x.modelCode === "string" && /^[a-z][a-z0-9-]{1,62}$/.test(x.modelCode) && rev(x.modelRevision) && rev(x.catalogVersion));
    const fields = a => { array(a); check(new Set(a).size === a.length && a.every(k => typeof k === "string" && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(k) && !bad.includes(k))); };
    fields(x.inputFields); fields(x.outputFields); check(x.inputFields.length && ["text", "json"].includes(x.outputFormat) && (x.outputFormat !== "json" || x.outputFields.length));
    array(x.skillBindings, 8).forEach(p => { exact(p, ["skillId", "revision", "skillVersionId"]); check(id(p.skillId) && id(p.skillVersionId) && rev(p.revision)); });
    check(new Set(x.skillBindings.map(p => p.skillId)).size === x.skillBindings.length);
    return { id: x.id, agentId: x.agentId, code: x.code, name: x.name, revision: x.revision, createdAt: x.createdAt, enabled: x.enabled };
  });
  check(new Set(items.map(x => x.id)).size === items.length && items.every((x,i) => !i || x.revision < items[i-1].revision));
  check(v.nextCursor === null || items.length === limit && v.nextCursor === items.at(-1).revision);
  return { items, nextCursor: v.nextCursor };
}
export function buildLinearWorkflow(inputKeys, steps) {
  check(Array.isArray(steps) && steps.length > 0 && steps.length <= 62 && steps.every(p => id(p.agentId) && rev(p.revision)));
  const nodes = [{ id: "start", type: "start" }, ...steps.map((p,i) => ({ id: `step${i+1}`, type: "agent", agentId: p.agentId, revision: p.revision })), { id: "end", type: "end" }];
  return validatePersonalWorkflowDraft({ schemaVersion: 1, inputKeys, nodes, edges: nodes.slice(0,-1).map((n,i) => ({ from: n.id, port: "next", to: nodes[i+1].id, input: "in" })) }).graph;
}
// Compare the COMPLETE canonical graph, including labels/ports/IDs. A graph
// that merely looks linear must never be converted by this editor.
export function classifyLinearWorkflow(graph) {
  try {
    const validated = validatePersonalWorkflowDraft(graph);
    const count = validated.graph.nodes.length - 2;
    if (count < 1 || count > 62) return null;
    const steps = Array.from({ length: count }, (_,i) => {
      const n = validated.graph.nodes.find(n => n.id === `step${i+1}`);
      check(n?.type === "agent"); return { agentId: n.agentId, revision: n.revision };
    });
    const rebuilt = buildLinearWorkflow(validated.graph.inputKeys, steps);
    check(validatePersonalWorkflowDraft(rebuilt).canonical === validated.canonical);
    return { inputKeys: [...rebuilt.inputKeys], steps };
  } catch { return null; }
}
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const digestGraph = async graph => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(validatePersonalWorkflowDraft(graph).canonical)))].map(b => b.toString(16).padStart(2,"0")).join("");

// Pointer state contains only bounded indices and coordinates. UI measures real
// cards; drop invokes the SAME semantic reorder used by keyboard/buttons.
export function createLinearDragController({ token, count, reorder }) {
  let drag = null;
  const validIndex = n => Number.isInteger(n) && n >= 0 && n < count && count <= 62;
  return {
    start(pointerId, index) { drag = Number.isInteger(pointerId) && validIndex(index) ? { pointerId, index, target: index } : null; return Boolean(drag); },
    move(pointerId, x, y, bounds) {
      if (!drag || drag.pointerId !== pointerId) return null;
      drag.target = null;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Array.isArray(bounds) || bounds.length !== count) return null;
      const valid = bounds.every(b => b && [b.left,b.right,b.top,b.bottom].every(Number.isFinite) && b.right > b.left && b.bottom > b.top);
      if (!valid || bounds.some((b,i) => i && b.top < bounds[i-1].bottom)) return null;
      const target = bounds.findIndex(b => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);
      drag.target = validIndex(target) ? target : null; return drag.target;
    },
    end(pointerId) { if (!drag || drag.pointerId !== pointerId) return; const d = drag; drag = null; if (validIndex(d.target) && d.index !== d.target) reorder(d.index, d.target, token); },
    cancel() { drag = null; }
  };
}
const draft = () => ({ code: "", name: "", inputKeys: "", steps: [] });
const privateState = () => ({ items: [], nextCursor: null, detail: null, versions: [], versionCursor: null, historical: null, editor: null, editorBaseline: null, editorToken: 0, draft: draft(), confirmation: null, agents: [], agentCursor: null, selectedAgent: null, agentVersions: [], agentVersionCursor: null, replay: false, blocked: false, issue: null, notice: "" });
const initial = () => ({ ...privateState(), phase: "ready", busy: false, principal: null, workspaces: [], workspaceId: "", context: null });
const issue = e => ({ status: Number.isInteger(e?.status) ? e.status : 0, message: e instanceof StaleDependency ? "Agent 当前版本已变化，原摘要已过期；请重新读取后明确选择固定版本。" : e instanceof InvalidResponse ? "响应结构或流程摘要不一致，已清除私有内容，请重新验证访问。" : ({ 400: "输入不符合要求，请检查字段与固定版本。", 401: "登录已失效，私有内容已清除。", 403: "空间或权限不可用，私有内容已清除。", 404: "流程、Agent 固定版本或插件不可用，请重新读取并核对。", 409: "版本、编号或依赖冲突：请明确重新读取并检查，不会自动合并或重试。", 503: "服务暂不可用，请重新验证访问。" }[e?.status] ?? "网络或超时导致结果未确认；不会自动重试写入。请重新读取核对。") });

export function createWorkflowLibrary({ request, configured = () => true, onUnauthorized = () => {}, timeoutMs = 8000 }) {
  let state = initial(), epoch = 0, editorGeneration = 0, confirmationGeneration = 0, controller = new AbortController(), disposed = false, preferred = "", attempt = null;
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; if (state.editorBaseline) freeze(state.editorBaseline); listeners.forEach(fn => fn()); };
  const canRead = () => Boolean(!disposed && state.phase === "ready" && state.context?.workspaceId === state.workspaceId && state.context.permissions.includes(READ));
  const canManage = () => canRead() && state.context.permissions.includes(MANAGE) && !state.blocked;
  function transport(signal) {
    return (path, options = {}) => {
      const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
      return new Promise((resolve,reject) => {
        const abort = () => reject(combined.reason);
        combined.addEventListener("abort", abort, { once: true });
        if (combined.aborted) { abort(); return; }
        Promise.resolve().then(() => { combined.throwIfAborted(); return request(path, { ...options, signal: combined }); }).then(resolve,reject).finally(() => combined.removeEventListener("abort", abort));
      });
    };
  }
  function begin(patch = {}) {
    controller.abort(); controller = new AbortController(); const generation = ++epoch, signal = controller.signal;
    publish({ busy: true, confirmation: null, issue: null, notice: "", ...patch });
    const api = transport(signal);
    return { workspaceId: state.workspaceId, signal, current: () => !disposed && epoch === generation && !signal.aborted, request: api, workflows: createPersonalWorkflowsClient(api), agents: createPersonalAgentsClient(api) };
  }
  function fail(e,t,op = "read") {
    if (!t.current()) return;
    const error = issue(e);
    if (op === "create" && [400,404,409].includes(error.status)) attempt = null;
    if ([401,403].includes(error.status) || e instanceof InvalidResponse) {
      attempt = null; controller.abort(); ++epoch;
      publish({ ...initial(), issue: error }); if (error.status === 401) onUnauthorized();
    } else {
      const unknownWrite = op !== "read" && ![400,404,409].includes(error.status);
      publish({ issue: error, blocked: error.status === 0 || error.status === 409 || error.status === 404 || error.status === 503 || unknownWrite,
        replay: op === "create" && unknownWrite && Boolean(attempt), confirmation: null,
        ...(["linear","rename"].includes(state.editor) ? { editor: null, editorBaseline: null, editorToken: ++editorGeneration, draft: draft(), selectedAgent: null, agentVersions: [], agentVersionCursor: null, historical: null, versions: [] } : {}) });
    }
  }
  const finish = t => { if (t.current()) publish({ busy: false }); };
  async function start(workspaceId = preferred) {
    disposed = false; preferred = workspaceId; attempt = null;
    const t = begin({ ...initial(), phase: "loading" });
    try {
      if (!configured()) throw { status: 503 };
      const p = await t.request("/client/auth/me"); if (!t.current()) return;
      exact(p, ["id", "email", "nickname"]); check(id(p.id) && (p.email === null || text(p.email, 320)) && text(p.nickname, 100));
      const workspaces = [];
      for (let page = 1; page <= 100; page++) {
        const v = await t.request(`/client/workspaces?page=${page}&pageSize=100`); if (!t.current()) return;
        exact(v, ["page", "pageSize", "total", "items"]); check(v.page === page && v.pageSize === 100 && Number.isSafeInteger(v.total) && v.total >= 0 && v.total <= 10000);
        for (const x of array(v.items, 100)) {
          exact(x, ["membershipId", "joinedAt", "workspace", "role"]); exact(x.workspace, ["id", "code", "name", "status"]); exact(x.role, ["id", "code", "name"]);
          check(id(x.membershipId) && date(x.joinedAt) && id(x.workspace.id) && text(x.workspace.code, 128) && text(x.workspace.name) && x.workspace.status === "active" && id(x.role.id) && text(x.role.code, 128) && text(x.role.name));
          workspaces.push({ workspace: { id: x.workspace.id, name: x.workspace.name }, role: { name: x.role.name } });
        }
        check(new Set(workspaces.map(w => w.workspace.id)).size === workspaces.length && workspaces.length <= v.total);
        if (workspaces.length === v.total) break;
        check(v.items.length === 100 && page < 100);
      }
      publish({ principal: { ...p }, workspaces });
      // An absent/foreign selector NEVER selects the first or a default space.
      if (!workspaceId) { publish({ phase: "ready" }); return; }
      if (!id(workspaceId) || !workspaces.some(w => w.workspace.id === workspaceId)) throw { status: 403 };
      const c = await t.request("/client/workspaces/context", { workspaceId }); if (!t.current()) return;
      exact(c, ["workspaceId", "workspaceCode", "workspaceName", "roleId", "roleCode", "permissions", "sessionGeneration"]);
      check(c.workspaceId === workspaceId && text(c.workspaceCode, 128) && text(c.workspaceName) && id(c.roleId) && text(c.roleCode, 128) && typeof c.sessionGeneration === "string" && /^[a-f0-9]{64}$/.test(c.sessionGeneration));
      array(c.permissions, 500); check(new Set(c.permissions).size === c.permissions.length && c.permissions.every(p => typeof p === "string" && /^[a-z][A-Za-z0-9.:-]{0,127}$/.test(p)));
      publish({ workspaceId, context: { ...c, permissions: [...c.permissions] }, phase: "ready" });
      if (canRead()) { const v = await t.workflows.list(workspaceId, { limit: 20 }); if (t.current()) publish(parseWorkflowPage(v)); }
    } catch (e) { fail(e,t); if (t.current()) publish({ phase: "ready" }); } finally { finish(t); }
  }
  async function nextPage() {
    if (!canRead() || state.busy || !state.nextCursor) return;
    attempt = null; const afterId = state.nextCursor, t = begin(privateState());
    try { const v = await t.workflows.list(t.workspaceId, { limit: 20, afterId }); if (t.current()) publish(parseWorkflowPage(v, { afterId })); } catch(e) { fail(e,t); } finally { finish(t); }
  }
  async function allAgents(t) {
    const items = []; let afterId;
    for (let page = 0; page < 50; page++) {
      const v = await t.agents.list(t.workspaceId, { limit: 20, ...(afterId ? { afterId } : {}) }); if (!t.current()) return null;
      const p = agentPage(v, afterId); items.push(...p.items); if (!p.nextCursor) return items; afterId = p.nextCursor;
    }
    throw new InvalidResponse();
  }
  async function openDetail(workflowId) {
    if (!canRead() || state.busy || !id(workflowId)) return;
    attempt = null; const t = begin({ ...privateState(), items: state.items, nextCursor: state.nextCursor });
    try {
      const raw = await t.workflows.get(t.workspaceId, workflowId); if (!t.current()) return;
      const detail = await parseWorkflow(raw, { expectedId: workflowId }); if (!t.current()) return; publish({ detail });
      const agents = await allAgents(t); if (t.current() && agents) publish({ agents });
    } catch(e) { fail(e,t); } finally { finish(t); }
  }
  async function loadVersions(next = false) {
    if (!canRead() || state.busy || !state.detail || next && !state.versionCursor) return;
    const parent = state.detail, beforeRevision = next ? state.versionCursor : undefined;
    const t = begin({ editor: null, draft: draft(), versions: [], historical: null, versionCursor: null });
    try { const raw = await t.workflows.versions(t.workspaceId, parent.id, { limit: 20, ...(beforeRevision ? { beforeRevision } : {}) }); if (t.current()) { const v = parseWorkflowPage(raw, { parent, beforeRevision }); publish({ versions: v.items, versionCursor: v.nextCursor }); } } catch(e) { fail(e,t); } finally { finish(t); }
  }
  async function previewVersion(revision) {
    if (!canRead() || state.busy || !state.detail) return;
    const parent = state.detail, version = state.versions.find(v => v.revision === revision); if (!version) return;
    const t = begin({ historical: null, editor: null, draft: draft() });
    try { const raw = await t.workflows.getVersion(t.workspaceId, parent.id, revision); if (!t.current()) return; const historical = await parseWorkflow(raw, { parent, version }); if (t.current()) publish({ historical }); } catch(e) { fail(e,t); } finally { finish(t); }
  }
  async function openCreate() {
    if (!canManage() || state.busy) return;
    attempt = null; const t = begin({ ...privateState(), items: state.items, nextCursor: state.nextCursor, editor: "create", editorToken: ++editorGeneration });
    try { const agents = await allAgents(t); if (t.current() && agents) publish({ agents }); } catch(e) { fail(e,t); } finally { finish(t); }
  }
  const editable = (token = state.editorToken) => token === state.editorToken && canManage() && !state.busy && state.editor && !state.confirmation && !state.replay;
  const graphEditable = token => editable(token) && ["create","linear"].includes(state.editor);
  function openEdit(token = state.editorToken) { if (token === state.editorToken && canManage() && !state.busy && state.detail) { attempt = null; publish({ editor: "rename", editorBaseline: structuredClone(state.detail), editorToken: ++editorGeneration, historical: null, versions: [], versionCursor: null, draft: { ...draft(), code: state.detail.code, name: state.detail.name } }); } }
  function openLinearEdit(token = state.editorToken) {
    if (token !== state.editorToken || !canManage() || state.busy || !state.detail) return;
    const linear = classifyLinearWorkflow(state.detail.graph); if (!linear) return;
    const steps = linear.steps.map((p,i) => {
      const a = state.agents.find(a => a.id === p.agentId), pin = state.detail.agentBindings.find(b => b.nodeId === `step${i+1}`);
      check(pin && pin.agentId === p.agentId && pin.revision === p.revision);
      return { ...p, versionId: pin.agentVersionId, name: a?.name || "当前不可用的 Agent", code: a?.code || "", kind: a?.revision === p.revision ? "current" : "historical" };
    });
    attempt = null; publish({ editor: "linear", editorBaseline: structuredClone(state.detail), editorToken: ++editorGeneration, historical: null, versions: [], versionCursor: null, selectedAgent: null, agentVersions: [], agentVersionCursor: null, draft: { code: state.detail.code, name: state.detail.name, inputKeys: linear.inputKeys.join(", "), steps } });
  }
  function cancelEdit(token = state.editorToken) { if (!disposed && !state.busy && token === state.editorToken) publish({ editor: null, editorBaseline: null, editorToken: ++editorGeneration, draft: draft(), confirmation: null, selectedAgent: null, agentVersions: [], agentVersionCursor: null }); }
  function setDraft(field, value, token) {
    if (!editable(token) || !["name", ...(graphEditable(token) ? ["inputKeys"] : []), ...(state.editor === "create" ? ["code"] : [])].includes(field) || typeof value !== "string") return;
    if (value.length > (field === "name" ? 100 : field === "code" ? 63 : 1000)) return;
    publish({ draft: { ...state.draft, [field]: value } });
  }
  async function selectAgent(agentId, next = false, token) {
    if (!graphEditable(token)) return;
    const agent = state.agents.find(a => a.id === agentId); if (!agent) return;
    const beforeRevision = next && state.selectedAgent?.id === agentId ? state.agentVersionCursor : undefined; if (next && !beforeRevision) return;
    const t = begin({ selectedAgent: agent, agentVersions: [], agentVersionCursor: null, editorToken: ++editorGeneration });
    try { const raw = await t.agents.versions(t.workspaceId, agentId, { limit: 20, ...(beforeRevision ? { beforeRevision } : {}) }); if (t.current()) { const v = agentVersions(raw, agent, beforeRevision); publish({ agentVersions: v.items, agentVersionCursor: v.nextCursor }); } } catch(e) { fail(e,t); } finally { finish(t); }
  }
  function addStep(revision, token) {
    if (!graphEditable(token) || state.draft.steps.length >= 62 || !state.selectedAgent?.enabled) return;
    const v = state.agentVersions.find(x => x.revision === revision); if (!v) return;
    publish({ draft: { ...state.draft, steps: [...state.draft.steps, { agentId: v.agentId, revision: v.revision, versionId: v.id, name: v.name, code: v.code, kind: v.revision === state.selectedAgent.revision ? "current" : "historical" }] } });
  }
  function reorderStep(index, to, token) {
    if (!graphEditable(token) || !Number.isInteger(index) || !Number.isInteger(to) || index === to) return;
    const steps = [...state.draft.steps]; if (index < 0 || to < 0 || !steps[index] || !steps[to]) return;
    const [step] = steps.splice(index,1); steps.splice(to,0,step); publish({ draft: { ...state.draft, steps } });
  }
  function moveStep(index, delta, token) { if ([-1,1].includes(delta)) reorderStep(index,index+delta,token); }
  function removeStep(index, token) { if (graphEditable(token) && Number.isInteger(index) && index >= 0 && index < state.draft.steps.length) publish({ draft: { ...state.draft, steps: state.draft.steps.filter((_,i) => i !== index) } }); }
  function payload() {
    if (!text(state.draft.name)) throw new InvalidResponse();
    if (state.editor === "rename") { check(state.editorBaseline); return { name: state.draft.name, graph: structuredClone(state.editorBaseline.graph), expectedRevision: state.editorBaseline.revision }; }
    if (state.editor === "linear") { check(state.editorBaseline && classifyLinearWorkflow(state.editorBaseline.graph)); return { name: state.draft.name, graph: buildLinearWorkflow(state.draft.inputKeys.trim() ? state.draft.inputKeys.split(",").map(k => k.trim()) : [], state.draft.steps), expectedRevision: state.editorBaseline.revision }; }
    check(code(state.draft.code));
    return { code: state.draft.code, name: state.draft.name, graph: buildLinearWorkflow(state.draft.inputKeys.trim() ? state.draft.inputKeys.split(",").map(k => k.trim()) : [], state.draft.steps) };
  }
  const readyToSave = () => { try { payload(); return editable(); } catch { return false; } };
  function requestSave(token) { if (editable(token) && readyToSave()) publish({ confirmation: { token: ++confirmationGeneration, kind: state.editor === "create" ? "create" : "update", id: state.detail?.id, revision: state.editorBaseline?.revision ?? state.detail?.revision } }); }
  function requestDelete(token = state.editorToken) { if (token === state.editorToken && canManage() && !state.busy && state.detail) { attempt = null; publish({ editor: null, editorBaseline: null, editorToken: ++editorGeneration, draft: draft(), historical: null, versions: [], confirmation: { token: ++confirmationGeneration, kind: "delete", id: state.detail.id, revision: state.detail.revision } }); } }
  async function checkDependencies(t, steps) {
    const agents = await allAgents(t); if (!t.current() || !agents) return false;
    publish({ agents });
    const checked = new Set();
    for (const p of steps) {
      const a = agents.find(a => a.id === p.agentId);
      if (!a?.enabled || p.kind === "current" && a.revision !== p.revision) { publish({ blocked: true, issue: { status: 409, message: "Agent 已缺失、停用或当前版本已变化；请重新读取当前草稿并明确选择版本。" } }); return false; }
      const key = JSON.stringify([p.agentId,p.revision,p.versionId]); if (checked.has(key)) continue;
      const v = agentVersions(await t.agents.versions(t.workspaceId, a.id, { limit: 1, ...(p.revision < 2147483647 ? { beforeRevision: p.revision+1 } : {}) }), a, p.revision < 2147483647 ? p.revision+1 : undefined, 1); if (!t.current()) return false;
      if (!v.items.some(v => v.revision === p.revision && v.id === p.versionId)) { publish({ blocked: true, issue: { status: 409, message: "固定的 Agent 历史版本不可用，请重新读取并选择。" } }); return false; }
      checked.add(key);
    }
    return true;
  }
  async function mutate(replay = false, confirmationToken) {
    if (disposed || state.busy || !canRead()) return;
    const confirmation = state.confirmation;
    if (!replay && confirmationToken !== undefined && confirmationToken !== confirmation?.token) return;
    if (replay ? !state.replay || !attempt : !canManage() || !confirmation) return;
    const op = replay ? "create" : confirmation.kind, parent = state.detail;
    if (op !== "create" && (!parent || confirmation.id !== parent.id || confirmation.revision !== parent.revision)) return;
    let body; try { body = replay ? structuredClone(attempt.body) : op === "delete" ? null : payload(); } catch { return; }
    const steps = replay ? attempt.steps : structuredClone(state.draft.steps);
    const t = begin({ replay: false });
    try {
      if ((op === "create" && !replay || op === "update" && state.editor === "linear") && !await checkDependencies(t, steps)) return;
      if (!t.current()) return;
      if (op === "create" && !attempt) attempt = { body: structuredClone(body), steps };
      const raw = op === "create" ? await t.workflows.create(t.workspaceId, body) : op === "update" ? await t.workflows.update(t.workspaceId, parent.id, body) : await t.workflows.delete(t.workspaceId, parent.id, parent.revision);
      if (!t.current()) return;
      let saved = null;
      if (op === "delete") { exact(raw, ["id", "revision", "deleted"]); check(raw.id === parent.id && raw.revision === parent.revision && raw.deleted === true); }
      else {
        saved = await parseWorkflow(raw, { expectedId: op === "update" ? parent.id : undefined }); if (!t.current()) return;
        check(saved.code === (op === "create" ? body.code : parent.code));
        if (op === "update") {
          const intendedDigest = await digestGraph(body.graph); if (!t.current()) return;
          const changed = body.name !== parent.name || intendedDigest !== parent.graphDigest;
          const intendedPins = state.editor === "linear" ? steps.map((p,i) => ({ nodeId: `step${i+1}`, agentId: p.agentId, revision: p.revision, agentVersionId: p.versionId })) : parent.agentBindings;
          const pins = value => [...value].sort((a,b) => a.nodeId.localeCompare(b.nodeId)).map(p => [p.nodeId,p.agentId,p.revision,p.agentVersionId]);
          check(saved.name === body.name && saved.revision === parent.revision + (changed ? 1 : 0) && saved.graphDigest === intendedDigest && validatePersonalWorkflowDraft(saved.graph).canonical === validatePersonalWorkflowDraft(body.graph).canonical && JSON.stringify(pins(saved.agentBindings)) === JSON.stringify(pins(intendedPins)));
        }
        // Exact initial create replay intentionally returns CURRENT server state.
      }
      attempt = null; publish({ ...privateState(), detail: saved, notice: op === "delete" ? "服务端已确认删除并保留编号墓碑；不能复用该编号。" : "服务端已确认草稿。相同创建请求可能返回当前版本，请核对详情；结构有效不表示可执行。" });
      const v = await t.workflows.list(t.workspaceId, { limit: 20 }); if (t.current()) { publish(parseWorkflowPage(v)); if (saved) { const agents = await allAgents(t); if (t.current() && agents) publish({ agents }); } }
    } catch(e) { fail(e,t,op); } finally { finish(t); }
  }
  function closeDetail() { if (!disposed) { controller.abort(); ++epoch; attempt = null; publish({ ...privateState(), items: state.items, nextCursor: state.nextCursor, busy: false }); } }
  function dispose() { disposed = true; controller.abort(); ++epoch; attempt = null; publish(initial()); }
  async function signOut() {
    preferred = ""; attempt = null; disposed = false; const t = begin(initial());
    try { const v = await t.request("/client/auth/logout", { method: "POST" }); if (!t.current()) return; exact(v, ["signedOut"]); check(v.signedOut === true); onUnauthorized(); } catch(e) { fail(e,t); } finally { finish(t); }
  }
  return { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, start, refresh: () => start(preferred), selectWorkspace: start,
    nextPage, openDetail, loadVersions, previewVersion, openCreate, openEdit, openLinearEdit, cancelEdit, setDraft, selectAgent, addStep, moveStep, reorderStep, removeStep, readyToSave, requestSave, requestDelete,
    confirmMutation: token => mutate(false, token), replayCreate: () => mutate(true), closeDetail, dispose, signOut,
    cancelConfirmation: token => { if (!disposed && !state.busy && (token === undefined || token === state.confirmation?.token)) publish({ confirmation: null }); } };
}
