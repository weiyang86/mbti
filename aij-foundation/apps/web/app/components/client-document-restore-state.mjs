import { createPersonalDocumentsClient } from "@aij/sdk";

// Page-instance RAM only. The existing SDK, document service and CAS own all
// versions/authorization/audit. No persistence, polling or mutation replay.
const READ = "workspace.documents.read", MANAGE = "workspace.documents.manage";
const id = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const documentId = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const revision = v => Number.isInteger(v) && v >= 1 && v <= 200;
const text = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max && ![...v].some(c => c.codePointAt(0) < 32 || c.codePointAt(0) === 127);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const contentSame = (a, b) => a.name === b.name && a.body === b.body;
const scopeKey = s => s ? JSON.stringify([s.memberId, s.workspaceId, s.documentId, s.revision]) : null;
class InvalidResponse extends Error {}
const check = v => { if (!v) throw new InvalidResponse(); };
function exact(v, keys) {
  check(v && typeof v === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(v)) &&
    Reflect.ownKeys(v).length === keys.length && Reflect.ownKeys(v).every(k => typeof k === "string" && keys.includes(k) &&
      Object.getOwnPropertyDescriptor(v, k)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value")));
}
const blank = () => ({ scopeKey: null, busy: false, canManage: false, head: null, versions: [], nextCursor: null, selected: null,
  confirmation: false, recovery: null, issue: null, notice: "", locked: false });
export function documentRestoreDifferences(head, selected) {
  return ["name", "body"].map(field => ({ field, current: head[field], historical: selected[field], changed: head[field] !== selected[field] }));
}
export function documentRestoreIssue(error, attempted = false) {
  const status = Number.isInteger(error?.status) ? error.status : 0;
  const messages = {
    400: "请求未通过校验，请明确重新读取后核对名称和正文。",
    401: "登录已失效，私有内容已清除，请重新登录。",
    403: "当前身份、空间、角色、会话或权限已变化，私有内容已清除，请重新验证访问。",
    404: "文档或文档能力已不可用，私有内容已清除，请重新验证访问。",
    409: "当前修订已变化或已达历史上限；不会覆盖并发修改。请主动重读后重新比较。",
    503: "服务暂不可用，请检查连接后明确重新读取。"
  };
  return { status, message: (error instanceof InvalidResponse || error instanceof TypeError ? "响应无法安全核对，私有内容已清除，请明确重新读取。" : messages[status] ?? "请求未完成，私有内容已清除，请明确重新读取。") +
    (attempted ? " 前次恢复结果未确认，恢复锁保留。须在原身份和原文档读取结果，再单独确认；不会自动重试。" : "") };
}

export function createDocumentVersionRestore({ request, onDocumentChanged = () => {}, onScopeRejected = () => {}, timeoutMs = 8000, isActive = () => true }) {
  let state = blank(), scope = null, epoch = 0, controller = new AbortController(), identity = null, lock = null;
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch, locked: Boolean(lock) }; listeners.forEach(fn => fn()); };
  function clear(issue = null) {
    controller.abort(); controller = new AbortController(); epoch++; identity = null;
    publish({ ...blank(), issue }); // lock contains opaque ownership only; never historical text.
  }
  function setScope(value) {
    let next = null;
    if (value !== null) {
      exact(value, ["memberId", "workspaceId", "documentId", "revision"]);
      check(id(value.memberId) && id(value.workspaceId) && documentId(value.documentId) && revision(value.revision));
      next = { memberId: value.memberId, workspaceId: value.workspaceId, documentId: value.documentId, revision: value.revision };
    }
    if (scopeKey(scope) !== scopeKey(next)) { scope = next; clear(); }
  }
  function ticket() {
    const t = { epoch, scope: { ...scope }, signal: controller.signal };
    t.current = () => Boolean(scope && t.epoch === epoch && !t.signal.aborted && scopeKey(scope) === scopeKey(t.scope) && isActive());
    t.api = (path, options = {}) => new Promise((resolve, reject) => {
      const signal = AbortSignal.any([t.signal, AbortSignal.timeout(timeoutMs)]);
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve().then(() => { signal.throwIfAborted(); live(t); return request(path, { ...options, cache: "no-store", signal }); })
        .then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
    t.documents = createPersonalDocumentsClient(t.api);
    return t;
  }
  function live(t) { if (!t.current()) throw new DOMException("Scope changed", "AbortError"); }
  async function auth(t, manage, expected = identity) {
    const p = await t.api("/client/auth/me"); live(t);
    const c = await t.api("/client/workspaces/context", { workspaceId: t.scope.workspaceId }); live(t);
    exact(p, ["id", "email", "nickname"]);
    exact(c, ["workspaceId", "workspaceCode", "workspaceName", "roleId", "roleCode", "permissions", "sessionGeneration"]);
    check(id(p.id) && (p.email === null || text(p.email, 320)) && text(p.nickname, 100) && id(c.workspaceId) &&
      text(c.workspaceCode, 128) && text(c.workspaceName, 200) && id(c.roleId) && text(c.roleCode, 128) &&
      typeof c.sessionGeneration === "string" && /^[a-f0-9]{64}$/.test(c.sessionGeneration) && Array.isArray(c.permissions) && c.permissions.length <= 500 &&
      c.permissions.every(v => typeof v === "string" && /^[a-z][A-Za-z0-9.:-]{0,127}$/.test(v)) && new Set(c.permissions).size === c.permissions.length);
    if (p.id !== t.scope.memberId || c.workspaceId !== t.scope.workspaceId || !c.permissions.includes(READ) || manage && !c.permissions.includes(MANAGE)) throw { status: 403 };
    const bytes = new TextEncoder().encode(JSON.stringify([p.id, c.workspaceId, c.roleId, c.roleCode, c.sessionGeneration, [...c.permissions].sort()]));
    const key = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join(""); live(t);
    if (expected !== null && key !== expected) throw { status: 403 };
    return { key, canManage: c.permissions.includes(MANAGE) };
  }
  async function validate(t, manage, expectedRevision, expectedIdentity = identity) {
    const before = await auth(t, manage, expectedIdentity);
    const head = await t.documents.get(t.scope.workspaceId, t.scope.documentId); live(t);
    if (expectedRevision !== undefined && head.revision !== expectedRevision) throw { status: 409 };
    const after = await auth(t, manage, before.key); live(t);
    return { head, key: after.key, canManage: after.canManage };
  }
  async function action(fn) {
    if (!scope || !isActive() || state.busy) return;
    const t = ticket(); publish({ busy: true, issue: null, notice: "" });
    try { await fn(t); }
    catch (error) {
      if (t.current()) {
        clear(documentRestoreIssue(error, Boolean(lock)));
        // Clear both owners synchronously; never change permissions here.
        if ([401, 403, 404].includes(error?.status)) onScopeRejected();
      } else if (t.epoch === epoch) clear();
    } finally { if (t.current()) publish({ busy: false }); }
  }
  const ownerMatches = () => Boolean(scope && lock && ["memberId", "workspaceId", "documentId"].every(k => scope[k] === lock[k]));
  async function loadHistory(next = false) {
    if (lock || next && !state.nextCursor) return;
    await action(async t => {
      const cursor = next ? state.nextCursor : null, previous = next ? state.versions : [];
      publish({ selected: null, confirmation: false, recovery: null });
      const before = await validate(t, false, t.scope.revision);
      const page = await t.documents.versions(t.scope.workspaceId, t.scope.documentId, { limit: 10, ...(cursor ? { beforeRevision: cursor } : {}) }); live(t);
      check(page.items.every(v => v.revision <= before.head.revision) && new Set([...previous, ...page.items].map(v => v.revision)).size === previous.length + page.items.length);
      const after = await validate(t, false, t.scope.revision, before.key); live(t); identity = after.key;
      publish({ scopeKey: scopeKey(t.scope), head: after.head, versions: [...previous, ...page.items], nextCursor: page.nextCursor, canManage: after.canManage });
    });
  }
  async function selectVersion(value) {
    if (lock || !state.head || !state.versions.some(v => v.revision === value && value < state.head.revision)) return;
    await action(async t => {
      publish({ selected: null, confirmation: false });
      const before = await validate(t, false, t.scope.revision);
      const selected = await t.documents.getVersion(t.scope.workspaceId, t.scope.documentId, value); live(t);
      const summary = state.versions.find(v => v.revision === value);
      check(summary && selected.name === summary.name && selected.createdAt === summary.createdAt);
      const after = await validate(t, false, t.scope.revision, before.key); live(t); identity = after.key;
      publish({ head: after.head, selected, canManage: after.canManage });
    });
  }
  const noChange = () => Boolean(state.head && state.selected && contentSame(state.head, state.selected));
  const canRestore = () => Boolean(scope && isActive() && !state.busy && !lock && state.canManage && state.head && state.selected && state.selected.revision < state.head.revision);
  async function requestConfirmation() {
    if (!canRestore()) return;
    await action(async t => {
      const before = await validate(t, true, t.scope.revision);
      const after = await validate(t, true, t.scope.revision, before.key); live(t); identity = after.key;
      publish({ head: after.head, canManage: true, confirmation: !contentSame(after.head, state.selected),
        notice: contentSame(after.head, state.selected) ? "名称和正文与当前版本相同；未发送 PATCH，也未创建新版本。" : "" });
    });
  }
  async function confirmRestore() {
    if (!canRestore() || !state.confirmation) return;
    const selected = state.selected;
    await action(async t => {
      publish({ confirmation: false });
      const before = await validate(t, true, t.scope.revision);
      const prewrite = await validate(t, true, t.scope.revision, before.key); live(t);
      if (contentSame(prewrite.head, selected)) { publish({ notice: "名称和正文相同；未发送 PATCH，也未创建新版本。" }); return; }
      if (prewrite.head.revision >= 200) throw { status: 409 };
      // Before the attempted PATCH: even 4xx, timeout, scope=null or teardown
      // cannot turn an uncertain outcome into permission to submit again.
      lock = { memberId: t.scope.memberId, workspaceId: t.scope.workspaceId, documentId: t.scope.documentId,
        expectedRevision: prewrite.head.revision, identity: before.key }; publish({ recovery: null });
      const updated = await t.documents.update(t.scope.workspaceId, t.scope.documentId,
        { expectedRevision: prewrite.head.revision, name: selected.name, body: selected.body }); live(t);
      check(updated.revision === prewrite.head.revision + 1 && updated.code === prewrite.head.code && updated.createdAt === prewrite.head.createdAt);
      const result = await validate(t, true, updated.revision, before.key); live(t);
      check(same(updated, result.head) && contentSame(result.head, selected));
      lock = null; clear(); publish({ notice: `已核对新版本 v${updated.revision}。旧历史和已有导出引用保持原归属。` });
      onDocumentChanged(); // Parent re-reads via its original owner; no data injection.
    });
  }
  async function readRecovery() {
    if (!ownerMatches()) return;
    await action(async t => {
      publish({ ...blank(), busy: true });
      // Never use a new role/session/owner to resolve an older write.
      const before = await validate(t, false, undefined, lock.identity);
      check(before.head.revision >= lock.expectedRevision);
      const after = await validate(t, false, before.head.revision, lock.identity); live(t);
      check(same(before.head, after.head)); identity = after.key;
      publish({ scopeKey: scopeKey(t.scope), recovery: after.head, canManage: after.canManage });
    });
  }
  async function acknowledgeRecovery() {
    if (!ownerMatches() || !state.recovery || !state.canManage) return;
    const expected = state.recovery;
    await action(async t => {
      const before = await validate(t, true, expected.revision, lock.identity);
      const after = await validate(t, true, expected.revision, lock.identity); live(t);
      check(same(expected, before.head) && same(expected, after.head));
      lock = null; clear(); publish({ notice: "已在原身份下重新验证并确认当前结果，恢复锁已解除。未重发写入；请重新读取并比较历史。" });
      onDocumentChanged();
    });
  }
  return { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, setScope,
    setCallbacks(next) { if (request !== next.request) clear(); request = next.request; onDocumentChanged = next.onDocumentChanged; onScopeRejected = next.onScopeRejected ?? (() => {}); },
    loadHistory, selectVersion, requestConfirmation, confirmRestore, cancelConfirmation: () => publish({ confirmation: false }),
    canRestore, noChange, readRecovery, acknowledgeRecovery, suspend: () => clear(), dispose() { scope = null; clear(); } };
}
