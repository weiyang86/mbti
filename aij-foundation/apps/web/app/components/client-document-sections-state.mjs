import { createPersonalDocumentsClient } from "@aij/sdk";

// Page-instance RAM. Only the parent editor owns network saves and unknown results.
const READ = "workspace.documents.read", MANAGE = "workspace.documents.manage";
const id = v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const uuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const revision = v => Number.isInteger(v) && v >= 1 && v <= 200;
const hex = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max && ![...v].some(c => c.codePointAt(0) < 32 || c.codePointAt(0) >= 127 && c.codePointAt(0) <= 159);
const scopeKey = s => s ? JSON.stringify([s.memberId, s.workspaceId, s.documentId, s.revision]) : null;
class InvalidResponse extends Error {}
const check = v => { if (!v) throw new InvalidResponse(); };
function exact(v, keys) {
  check(v && typeof v === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(v)) &&
    Reflect.ownKeys(v).length === keys.length && Reflect.ownKeys(v).every(k => typeof k === "string" && keys.includes(k) &&
      Object.getOwnPropertyDescriptor(v, k)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value")));
}
const hash = async body => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))].map(v => v.toString(16).padStart(2, "0")).join("");
const blank = () => ({ scopeKey: null, busy: false, canManage: false, head: null, index: null, selected: null, replacement: "", comparison: null,
  confirmation: false, issue: null, notice: "" });
function issue(error) {
  const status = Number.isInteger(error?.status) ? error.status : 0;
  const messages = { 400: "章节或局部草稿未通过校验，请重新读取并检查完整章节及换行。", 401: "登录已失效，私有内容已清除，请重新登录。",
    403: "身份、空间、角色、会话或权限已变化，私有内容已清除，请重新验证访问。", 404: "文档或文档能力已不可用，私有内容已清除，请重新验证访问。",
    409: "当前修订或正文已变化，请重新读取后比较；不会自动合并。", 503: "服务暂不可用，请检查连接后明确重新读取。" };
  return { status, message: messages[status] ?? "无法安全核对章节，私有内容已清除，请明确重新读取。" };
}

export function createDocumentSectionsEditor({ request, sectionsApi, composeDraft, onDraftReady = () => false, onScopeRejected = () => {}, isActive = () => true }) {
  let state = blank(), scope = null, epoch = 0, abort = new AbortController(), identity = null;
  const listeners = new Set();
  const publish = patch => { state = Object.freeze({ ...state, ...patch }); listeners.forEach(fn => fn()); };
  function invalidate() { abort.abort(); abort = new AbortController(); epoch++; }
  function clear(problem = null) { invalidate(); identity = null; publish({ ...blank(), issue: problem }); }
  function setScope(value) {
    let next = null;
    if (value !== null) {
      exact(value, ["memberId", "workspaceId", "documentId", "revision"]);
      check(id(value.memberId) && id(value.workspaceId) && uuid(value.documentId) && revision(value.revision));
      next = Object.freeze({ ...value });
    }
    if (scopeKey(scope) !== scopeKey(next)) { scope = next; clear(); }
  }
  function ticket() {
    const t = { epoch, scope: { ...scope }, signal: abort.signal };
    t.current = () => Boolean(scope && epoch === t.epoch && !t.signal.aborted && scopeKey(scope) === scopeKey(t.scope) && isActive());
    // Bound ignored transport/compose aborts as well as guarding their late results.
    t.wait = fn => new Promise((resolve, reject) => {
      const signal = AbortSignal.any([t.signal, AbortSignal.timeout(8000)]);
      const cancel = () => reject(signal.reason);
      signal.addEventListener("abort", cancel, { once: true });
      Promise.resolve().then(() => { signal.throwIfAborted(); live(t); return fn(signal); }).then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", cancel));
    });
    t.api = (path, options = {}) => t.wait(signal => request(path, { ...options, cache: "no-store", signal }));
    t.documents = createPersonalDocumentsClient(t.api);
    return t;
  }
  function live(t) { if (!t.current()) throw new DOMException("Scope changed", "AbortError"); }
  async function auth(t, manage, expected = identity) {
    const p = await t.api("/client/auth/me"); live(t);
    const c = await t.api("/client/workspaces/context", { workspaceId: t.scope.workspaceId }); live(t);
    exact(p, ["id", "email", "nickname"]);
    exact(c, ["workspaceId", "workspaceCode", "workspaceName", "roleId", "roleCode", "permissions", "sessionGeneration"]);
    check(id(p.id) && (p.email === null || text(p.email, 320)) && text(p.nickname, 100) && id(c.workspaceId) && text(c.workspaceCode, 128) &&
      text(c.workspaceName, 200) && id(c.roleId) && text(c.roleCode, 128) && hex(c.sessionGeneration) && Array.isArray(c.permissions) &&
      c.permissions.length <= 500 && c.permissions.every(v => typeof v === "string" && /^[a-z][A-Za-z0-9.:-]{0,127}$/.test(v)) && new Set(c.permissions).size === c.permissions.length);
    if (p.id !== t.scope.memberId || c.workspaceId !== t.scope.workspaceId || !c.permissions.includes(READ) || manage && !c.permissions.includes(MANAGE)) throw { status: 403 };
    const source = Object.freeze({ memberId: p.id, workspaceId: c.workspaceId, roleId: c.roleId, roleCode: c.roleCode,
      sessionGeneration: c.sessionGeneration, permissions: Object.freeze([...c.permissions].sort()) });
    const key = JSON.stringify(source);
    if (expected !== null && expected !== key) throw { status: 403 };
    return { source, key, canManage: c.permissions.includes(MANAGE) };
  }
  async function matchIndex(t, head, index) {
    // The injected AF224 port decodes the full wire shape; independently pin its source.
    check(index.documentId === head.id && index.revision === head.revision && index.bodyLength === head.body.length &&
      index.bodyByteLength === new TextEncoder().encode(head.body).length && hex(index.bodySha256));
    const digest = await hash(head.body); live(t);
    if (index.bodySha256 !== digest) throw { status: 409 };
  }
  async function validate(t, manage, index = state.index, expected = identity) {
    const before = await auth(t, manage, expected);
    const head = await t.documents.get(t.scope.workspaceId, t.scope.documentId, t.signal); live(t);
    if (head.revision !== t.scope.revision) throw { status: 409 };
    if (index) await matchIndex(t, head, index);
    const after = await auth(t, manage, before.key); live(t);
    return { head: Object.freeze(head), ...after };
  }
  async function action(fn) {
    if (!isActive()) { clear(); return; }
    if (!scope || state.busy) return;
    const t = ticket(); publish({ busy: true, issue: null, notice: "" });
    try { await fn(t); }
    catch (error) {
      if (t.current()) {
        clear(issue(error));
        // Current authorization/availability failures clear the parent synchronously.
        // A local parser/compose 400 is never reported as revoked access.
        if ([401, 403, 404].includes(error?.status)) onScopeRejected();
      } else if (t.epoch === epoch) clear();
    } finally { if (t.current()) publish({ busy: false }); }
  }
  async function load() {
    await action(async t => {
      publish({ head: null, index: null, selected: null, replacement: "", comparison: null, confirmation: false });
      const before = await validate(t, false, null);
      const index = await t.wait(signal => sectionsApi.get(t.scope.workspaceId, t.scope.documentId, t.scope.revision, signal)); live(t);
      // The port supplies decoded data; reject accidental incompatible wiring too.
      exact(index, ["format", "documentId", "revision", "bodySha256", "bodyLength", "bodyByteLength", "sections"]);
      check(index.format === "aij-plain-sections-v1" && Array.isArray(index.sections) && index.sections.length >= 1 && index.sections.length <= 128);
      let end = 0;
      for (const [i, s] of index.sections.entries()) {
        exact(s, ["id", "index", "title", "level", "start", "end"]);
        check(s.id === `section-${i}` && s.index === i && typeof s.title === "string" && [...s.title].length >= 1 && [...s.title].length <= 256 &&
          Number.isInteger(s.level) && s.level >= 0 && s.level <= 6 && Number.isInteger(s.start) && Number.isInteger(s.end) && s.start === end &&
          s.end >= s.start && s.end <= before.head.body.length && (s.end > s.start || index.sections.length === 1 && !before.head.body.length));
        // Never split a UTF16 surrogate pair at an editable boundary.
        for (const at of [s.start, s.end]) check(!(at > 0 && at < before.head.body.length && /[\uD800-\uDBFF]/u.test(before.head.body[at - 1]) && /[\uDC00-\uDFFF]/u.test(before.head.body[at])));
        end = s.end;
      }
      check(end === before.head.body.length);
      // Keep a private immutable copy, never an injected port's mutable object.
      const copy = structuredClone(index);
      copy.sections = Object.freeze(copy.sections.map(s => Object.freeze(s))); Object.freeze(copy);
      const after = await validate(t, false, copy, before.key); live(t); identity = after.key;
      publish({ scopeKey: scopeKey(t.scope), head: after.head, index: copy, canManage: after.canManage });
    });
  }
  async function select(sectionId) {
    if (!state.index?.sections.some(s => s.id === sectionId)) return;
    await action(async t => {
      publish({ selected: null, replacement: "", comparison: null, confirmation: false });
      const valid = await validate(t, false); live(t); identity = valid.key;
      const selected = state.index.sections.find(s => s.id === sectionId);
      publish({ head: valid.head, selected, replacement: valid.head.body.slice(selected.start, selected.end), canManage: valid.canManage });
    });
  }
  function draft(replacement) {
    if (!isActive()) { clear(); return; }
    if (!scope || state.busy || !state.selected || typeof replacement !== "string") return;
    publish({ replacement, comparison: null, confirmation: false, issue: null, notice: "" });
  }
  async function compose(t, valid, sectionId, replacement) {
    const result = await t.wait(() => composeDraft({ document: valid.head, index: state.index, sectionId, replacement })); live(t);
    exact(result, ["documentId", "expectedRevision", "sourceSha256", "sectionId", "body", "changed"]);
    const selected = state.index.sections.find(s => s.id === sectionId);
    check(result.documentId === t.scope.documentId && result.expectedRevision === t.scope.revision && result.sourceSha256 === state.index.bodySha256 &&
      result.sectionId === sectionId && typeof result.body === "string" && typeof result.changed === "boolean" && selected &&
      result.body === valid.head.body.slice(0, selected.start) + replacement + valid.head.body.slice(selected.end) && result.changed === (result.body !== valid.head.body));
    return Object.freeze({ ...result });
  }
  async function preview() {
    if (!state.selected) return;
    const sectionId = state.selected.id, replacement = state.replacement;
    await action(async t => {
      publish({ comparison: null, confirmation: false });
      const before = await validate(t, false);
      const comparison = await compose(t, before, sectionId, replacement);
      const after = await validate(t, false, state.index, before.key); live(t); identity = after.key;
      publish({ head: after.head, comparison, canManage: after.canManage, notice: comparison.changed ? "" : "章节内容相同，无需应用；未保存任何更改。" });
    });
  }
  async function requestConfirmation() {
    if (!state.comparison || !state.canManage) return;
    await action(async t => {
      const valid = await validate(t, true); live(t); identity = valid.key;
      publish({ confirmation: state.comparison.changed, canManage: true, notice: state.comparison.changed ? "" : "章节内容相同，无需应用；未保存任何更改。" });
    });
  }
  function cancelConfirmation() {
    // Also fence an in-flight confirmation read/compose; there is no mutation lock.
    invalidate(); publish({ confirmation: false, busy: false });
  }
  async function confirmDraft() {
    if (!state.confirmation || !state.comparison || !state.canManage) return;
    const sectionId = state.selected.id, replacement = state.replacement, comparison = state.comparison;
    await action(async t => {
      publish({ confirmation: false });
      const before = await validate(t, true);
      const result = await compose(t, before, sectionId, replacement);
      check(Object.keys(result).every(key => result[key] === comparison[key]));
      const after = await validate(t, true, state.index, before.key); live(t);
      if (!result.changed) { publish({ notice: "章节内容相同，无需应用；未保存任何更改。" }); return; }
      const proposal = Object.freeze({ ...result, ...after.source });
      // Parent synchronously rechecks its saved view, exact source and mutation guards.
      const accepted = onDraftReady(proposal) === true;
      // Callback may synchronously null scope or dispose this controller.
      if (!t.current()) return;
      clear(); publish({ notice: accepted ? "已应用到全文草稿，尚未保存，请在全文编辑器明确保存。" : "父编辑器未接收局部草稿，请回到已保存文档重新读取。" });
    });
  }
  return { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, setScope,
    setCallbacks(next) {
      if (request !== next.request || sectionsApi !== next.sectionsApi || composeDraft !== next.composeDraft) clear();
      request = next.request; sectionsApi = next.sectionsApi; composeDraft = next.composeDraft;
      onDraftReady = next.onDraftReady; onScopeRejected = next.onScopeRejected ?? (() => {});
    }, load, select, draft, preview, requestConfirmation, cancelConfirmation, confirmDraft,
    suspend: () => clear(), dispose() { scope = null; clear(); } };
}
