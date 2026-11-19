// Page-instance RAM only. The original SDK and server own identity, versions,
// dependency validation and update CAS; this controller never executes history.
const READ = "workspace.ai.assets.read", MANAGE = "workspace.ai.assets.manage";
const id = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const rev = v => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const record = v => v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const text = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max && !v.includes("\0");
const fields = v => Array.isArray(v) && v.length <= 20 && new Set(v).size === v.length && v.every(x => typeof x === "string" && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(x) && !["constructor", "prototype", "__proto__"].includes(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
class InvalidResponse extends Error {}
const check = value => { if (!value) throw new InvalidResponse(); };
const ownValues = v => record(v) && Reflect.ownKeys(v).every(k => typeof k === "string" && "value" in Object.getOwnPropertyDescriptor(v, k));
const blank = () => ({ busy: false, canManage: false, head: null, versions: [], nextCursor: null, selected: null, models: null, confirmation: false, recovery: null, issue: null, notice: "", locked: false });

// Explicit projection: historical identity/code/owner/session/publication and
// credentials never enter an update, nor does the immutable skillVersionId.
export function historicalAgentConfiguration(v) {
  check(ownValues(v) && text(v.name, 100) && v.name.trim() === v.name && v.name.trim() && text(v.instructions, 8000) && v.instructions.trim() &&
    new TextEncoder().encode(v.instructions).length <= 32768 && typeof v.enabled === "boolean" &&
    typeof v.modelCode === "string" && /^[a-z][a-z0-9-]{1,62}$/.test(v.modelCode) && rev(v.modelRevision) && rev(v.catalogVersion) &&
    fields(v.inputFields) && v.inputFields.length > 0 && fields(v.outputFields) && ["text", "json"].includes(v.outputFormat) &&
    (v.outputFormat !== "json" || v.outputFields.length > 0) && Array.isArray(v.skillBindings) && v.skillBindings.length <= 8 &&
    v.skillBindings.every(p => ownValues(p) && id(p.skillId) && rev(p.revision) && id(p.skillVersionId)) &&
    new Set(v.skillBindings.map(p => p.skillId)).size === v.skillBindings.length);
  return { name: v.name, instructions: v.instructions, enabled: false, modelCode: v.modelCode, modelRevision: v.modelRevision,
    catalogVersion: v.catalogVersion, inputFields: [...v.inputFields], outputFormat: v.outputFormat, outputFields: [...v.outputFields],
    skillBindings: v.skillBindings.map(p => ({ skillId: p.skillId, revision: p.revision })) };
}
function parseAgent(v, agentId, historical = false) {
  const content = historicalAgentConfiguration(v);
  check(id(v.id) && rev(v.revision) && text(v.code, 63) && v.code.length >= 2 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(v.code) &&
    typeof v.createdAt === "string" && Number.isFinite(Date.parse(v.createdAt)) &&
    (historical ? v.agentId === agentId : v.id === agentId && typeof v.updatedAt === "string" && Number.isFinite(Date.parse(v.updatedAt))));
  return { ...content, enabled: v.enabled, id: v.id, agentId, code: v.code, revision: v.revision, createdAt: v.createdAt,
    ...(!historical ? { updatedAt: v.updatedAt } : {}),
    skillBindings: v.skillBindings.map(p => ({ skillId: p.skillId, revision: p.revision, skillVersionId: p.skillVersionId })) };
}
const contentOf = v => ({ ...historicalAgentConfiguration(v), enabled: v.enabled });
function parseModels(v) {
  check(ownValues(v) && rev(v.catalogVersion) && Array.isArray(v.items) && v.items.length <= 1000 && v.items.every(m =>
    ownValues(m) && typeof m.code === "string" && /^[a-z][a-z0-9-]{1,62}$/.test(m.code) && text(m.name, 200) && rev(m.revision) && m.capability === "text") &&
    new Set(v.items.map(m => m.code)).size === v.items.length);
  return { catalogVersion: v.catalogVersion, items: v.items.map(m => ({ code: m.code, name: m.name, revision: m.revision, capability: "text" })) };
}
const modelMatches = (v, m) => Boolean(v && m && m.catalogVersion === v.catalogVersion && m.items.some(x => x.code === v.modelCode && x.revision === v.modelRevision));
export function agentRestoreDifferences(head, selected) {
  const current = contentOf(head), target = historicalAgentConfiguration(selected);
  return Object.keys(target).map(field => ({ field, current: current[field], selected: field === "enabled" ? selected.enabled : target[field],
    target: target[field], changed: !same(current[field], target[field]) }));
}
export function agentRestoreIssue(error, attempted = false) {
  const status = Number.isInteger(error?.status) ? error.status : 0;
  const messages = {
    400: "配置未通过校验，请重新读取并核对历史字段；不会自动移除依赖。",
    401: "登录已失效，私有内容已清除，请重新登录后读取。",
    403: "成员、角色或权限已变化，私有内容已清除，请重新验证访问或联系空间管理员。",
    404: "Agent 或固定 Skill 可能已删除、不可读，或能力未启用，请重新读取并联系管理员核对。",
    409: "当前版本、模型目录或固定依赖已变化，私有内容已清除，请重新读取当前 Agent；不会覆盖并发修改。",
    410: "历史配置已不可用，请重新读取当前 Agent。",
    503: "服务暂不可用，请稍后明确重新读取或联系管理员。"
  };
  return { status, message: (error instanceof InvalidResponse ? "响应无法安全核对，私有内容已清除，请重新读取。" : messages[status] ?? "请求未完成，私有内容已清除，请检查连接后明确重新读取。") +
    (attempted ? " 前次恢复结果未确认，恢复锁仍保留；先读取当前配置与发布状态，再单独确认已核对，禁止自动重试。" : "") };
}

export function createAgentVersionRestore({ request, agentsClientFactory, publicationsClientFactory, onAgentChanged = () => {}, onScopeRejected = () => {}, timeoutMs = 8000, isActive = () => true }) {
  let state = blank(), scope = null, epoch = 0, controller = new AbortController(), identity = null, lock = null;
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch, locked: Boolean(lock) }; listeners.forEach(fn => fn()); };
  const ownerMatches = () => Boolean(scope && lock && ["memberId", "workspaceId", "agentId"].every(k => scope[k] === lock[k]));
  function clear(issue = null) {
    controller.abort(); controller = new AbortController(); epoch++; identity = null;
    publish({ ...blank(), issue });
  }
  function setScope(value) {
    const next = value === null ? null : (() => { check(ownValues(value) && Object.keys(value).length === 4 && id(value.memberId) && id(value.workspaceId) && id(value.agentId) && rev(value.revision));
      return { memberId: value.memberId, workspaceId: value.workspaceId, agentId: value.agentId, revision: value.revision }; })();
    if (!same(scope, next)) { scope = next; clear(); }
  }
  function ticket() {
    const t = { epoch, scope: { ...scope }, signal: controller.signal };
    t.current = () => Boolean(scope && t.epoch === epoch && !t.signal.aborted && same(scope, t.scope) && isActive());
    t.api = (path, options = {}) => new Promise((resolve, reject) => {
      const signal = AbortSignal.any([t.signal, AbortSignal.timeout(timeoutMs)]);
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve().then(() => { signal.throwIfAborted(); if (!t.current()) throw new DOMException("Scope changed", "AbortError");
        return request(path, { ...options, signal }); }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
    t.agents = agentsClientFactory(t.api); t.publications = publicationsClientFactory(t.api);
    return t;
  }
  const live = t => { if (!t.current()) throw new DOMException("Scope changed", "AbortError"); };
  async function validate(t, manage, expectedRevision, expectedIdentity = identity) {
    const p = await t.api("/client/auth/me"); live(t);
    const c = await t.api("/client/workspaces/context", { workspaceId: t.scope.workspaceId }); live(t);
    check(ownValues(p) && id(p.id) && ownValues(c) && id(c.workspaceId) && id(c.roleId) && text(c.roleCode, 128) &&
      typeof c.sessionGeneration === "string" && /^[a-f0-9]{64}$/.test(c.sessionGeneration) && Array.isArray(c.permissions) &&
      c.permissions.every(x => text(x, 200)) && new Set(c.permissions).size === c.permissions.length);
    if (p.id !== t.scope.memberId || c.workspaceId !== t.scope.workspaceId || !c.permissions.includes(READ) || manage && !c.permissions.includes(MANAGE)) throw { status: 403 };
    const key = JSON.stringify([p.id, c.workspaceId, c.roleId, c.roleCode, c.sessionGeneration, [...c.permissions].sort()]);
    if (expectedIdentity !== null && key !== expectedIdentity) throw { status: 403 };
    const head = parseAgent(await t.agents.get(t.scope.workspaceId, t.scope.agentId), t.scope.agentId); live(t);
    if (expectedRevision !== undefined && head.revision !== expectedRevision) throw { status: 409 };
    return { head, key, canManage: c.permissions.includes(MANAGE) };
  }
  async function metadata(t, head) {
    const m = await t.publications.get(t.scope.workspaceId, t.scope.agentId); live(t);
    check(ownValues(m) && m.agentId === t.scope.agentId && m.revision === head.revision && Number.isSafeInteger(m.publicationVersion) &&
      m.publicationVersion >= 0 && m.publicationVersion <= 2147483647 && typeof m.published === "boolean" &&
      (m.publishedRevision === null || m.publishedRevision === head.revision) && m.published === (m.publishedRevision === head.revision));
    return { revision: head.revision, enabled: head.enabled, published: m.published, publicationVersion: m.publicationVersion };
  }
  async function action(fn) {
    if (!scope || !isActive() || state.busy) return;
    const t = ticket(); publish({ busy: true, issue: null, notice: "" });
    try { await fn(t); }
    catch (error) { if (t.current()) { clear(agentRestoreIssue(error, Boolean(lock))); if ([401, 403].includes(error?.status)) onScopeRejected(); } }
    finally { if (t.current()) publish({ busy: false }); }
  }
  async function loadHistory(next = false) {
    if (lock || next && !state.nextCursor) return;
    await action(async t => {
      const beforeRevision = next ? state.nextCursor : undefined;
      const previous = next ? state.versions : [];
      publish({ versions: previous, selected: null, models: null, confirmation: false, recovery: null });
      const before = await validate(t, false, t.scope.revision);
      const page = await t.agents.versions(t.scope.workspaceId, t.scope.agentId, { limit: 10, ...(beforeRevision ? { beforeRevision } : {}) }); live(t);
      check(ownValues(page) && Array.isArray(page.items) && page.items.length <= 10);
      const versions = page.items.map(v => parseAgent(v, t.scope.agentId, true));
      check(versions.every((v, i) => v.code === before.head.code && v.revision <= before.head.revision && (!beforeRevision || v.revision < beforeRevision) &&
        (!i || v.revision < versions[i - 1].revision)) && new Set([...previous, ...versions].map(v => v.id)).size === previous.length + versions.length &&
        (page.nextCursor === null || versions.length === 10 && page.nextCursor === versions.at(-1).revision));
      const after = await validate(t, false, before.head.revision, before.key); live(t); identity = after.key;
      publish({ head: after.head, versions: [...previous, ...versions], nextCursor: page.nextCursor, canManage: after.canManage });
    });
  }
  async function selectVersion(versionId) {
    if (lock || !state.head) return;
    const selected = state.versions.find(v => v.id === versionId && v.revision < state.head.revision);
    if (!selected) return;
    await action(async t => {
      publish({ selected: null, models: null, confirmation: false });
      const before = await validate(t, false, t.scope.revision);
      const models = parseModels(await t.agents.modelOptions(t.scope.workspaceId)); live(t);
      const after = await validate(t, false, before.head.revision, before.key); live(t); identity = after.key;
      publish({ head: after.head, selected, models, canManage: after.canManage });
    });
  }
  const noChange = () => Boolean(state.head && state.selected && same(contentOf(state.head), historicalAgentConfiguration(state.selected)));
  const canRestore = () => Boolean(scope && isActive() && !state.busy && !lock && state.canManage && state.head && state.selected && state.selected.revision < state.head.revision);
  async function requestConfirmation() {
    if (!canRestore()) return;
    await action(async t => {
      const before = await validate(t, true, t.scope.revision);
      const models = parseModels(await t.agents.modelOptions(t.scope.workspaceId)); live(t);
      const after = await validate(t, true, before.head.revision, before.key); live(t); identity = after.key;
      publish({ head: after.head, models, canManage: true });
      if (noChange()) { publish({ confirmation: false, notice: "目标禁用配置与当前版本一致，无需更改；未发送 PATCH，也未创建新版本。" }); return; }
      if (!modelMatches(state.selected, models)) throw { status: 409 };
      publish({ confirmation: true });
    });
  }
  async function confirmRestore() {
    if (!canRestore() || !state.confirmation) return;
    const selected = state.selected;
    await action(async t => {
      publish({ confirmation: false });
      const before = await validate(t, true, t.scope.revision);
      const originalPublication = await metadata(t, before.head);
      const models = parseModels(await t.agents.modelOptions(t.scope.workspaceId)); live(t);
      const payload = historicalAgentConfiguration(selected);
      const prewrite = await validate(t, true, before.head.revision, before.key); live(t);
      if (same(contentOf(prewrite.head), payload)) { publish({ notice: "目标禁用配置与当前版本一致；未发送 PATCH，也未创建新版本。" }); return; }
      if (!modelMatches(selected, models)) throw { status: 409 };
      if (before.head.revision === 2147483647 || originalPublication.publicationVersion === 2147483647) throw { status: 409 };
      // Set before the attempted SDK PATCH. Every failure, including 4xx or a
      // lost committed reply, keeps only these opaque ownership IDs in RAM.
      lock = { memberId: t.scope.memberId, workspaceId: t.scope.workspaceId, agentId: t.scope.agentId }; publish({ recovery: null });
      const updated = parseAgent(await t.agents.update(t.scope.workspaceId, t.scope.agentId, { ...payload, expectedRevision: before.head.revision }), t.scope.agentId); live(t);
      check(updated.revision === before.head.revision + 1 && updated.code === before.head.code && same(contentOf(updated), payload) && same(updated.skillBindings, selected.skillBindings));
      const result = await validate(t, true, updated.revision, before.key);
      check(result.head.code === before.head.code && same(contentOf(result.head), payload) && same(result.head.skillBindings, selected.skillBindings));
      const publication = await metadata(t, result.head);
      const final = await validate(t, true, updated.revision, before.key); live(t);
      check(final.head.code === before.head.code && same(contentOf(final.head), payload) && same(final.head.skillBindings, selected.skillBindings) &&
        !publication.enabled && !publication.published && publication.publicationVersion === originalPublication.publicationVersion + 1);
      lock = null; clear(); publish({ notice: `已核对新版本 v${updated.revision}：配置禁用且未发布。原历史版本与已有 Run 引用保持不变。` });
      onAgentChanged();
    });
  }
  async function readRecovery() {
    if (!ownerMatches()) return;
    await action(async t => {
      publish({ ...blank(), busy: true });
      const before = await validate(t, false, undefined, null);
      const recovery = await metadata(t, before.head);
      const after = await validate(t, false, before.head.revision, before.key); live(t); identity = after.key;
      check(after.head.enabled === recovery.enabled);
      publish({ recovery, canManage: after.canManage });
    });
  }
  async function acknowledgeRecovery() {
    if (!ownerMatches() || !state.recovery || !state.canManage) return;
    const expected = state.recovery;
    await action(async t => {
      const before = await validate(t, true, expected.revision);
      const actual = await metadata(t, before.head);
      await validate(t, true, before.head.revision, before.key); live(t);
      if (!same(expected, actual)) throw { status: 409 };
      lock = null; clear(); publish({ notice: "已确认当前配置与发布状态；前次操作不自动重试。请重新读取当前 Agent 后再选择历史版本。" });
      onAgentChanged();
    });
  }
  return { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, setScope, loadHistory, selectVersion,
    setCallbacks: next => { if (request !== next.request) clear(); request = next.request; onAgentChanged = next.onAgentChanged; onScopeRejected = next.onScopeRejected ?? (() => {}); },
    requestConfirmation, confirmRestore, cancelConfirmation: () => publish({ confirmation: false }), canRestore, noChange,
    readRecovery, acknowledgeRecovery, suspend: () => clear(), dispose: () => { scope = null; clear(); } };
}
