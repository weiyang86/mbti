/** RAM-only export controller. IO is supplied by the real public SDK and browser host. */
const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' };
const MAX = 5 * 1024 * 1024;
const copyMeta = m => Object.fromEntries(['id', 'documentId', 'revision', 'format', 'mimeType', 'size', 'checksum', 'rendererVersion', 'pageCount', 'createdAt'].map(k => [k, m[k]]));
const status = e => e && typeof e === 'object' && typeof e.status === 'number' ? e.status : 0;
const blank = () => ({ capability: null, items: [], busy: false, unknown: false, checked: false, conflict: false, issue: '', notice: '', suspended: false });
const key = c => JSON.stringify([c.scope, c.document?.id, c.document?.revision, c.hasUnsavedChanges]);
const allowed = c => !!c.scope && !!c.document && Number.isInteger(c.document.revision) && c.document.revision >= 1 && c.document.revision <= 200 && c.scope.permissions.includes('workspace.documents.read') && c.scope.permissions.includes('workspace.documents.export');
const validMeta = (m, d) => m && typeof m.id === 'string' && m.id.length > 0 && m.documentId === d.id && m.revision === d.revision && Object.hasOwn(MIME, m.format) && m.mimeType === MIME[m.format] && Number.isInteger(m.size) && m.size > 0 && m.size <= MAX && /^[a-f0-9]{64}$/.test(m.checksum) && m.rendererVersion === 'aij-plain-document-v1' && (m.format === 'docx' ? m.pageCount === null : Number.isInteger(m.pageCount) && m.pageCount >= 1 && m.pageCount <= 100) && typeof m.createdAt === 'string' && Number.isFinite(Date.parse(m.createdAt));
const validCapability = c => c && typeof c.configured === 'boolean' && typeof c.canExport === 'boolean' && ['ready', 'not_configured', 'not_permitted'].includes(c.reason) && c.canExport === (c.reason === 'ready') && (c.reason !== 'ready' || c.configured) && (c.reason !== 'not_configured' || !c.configured);

export function createDocumentExportStore(api, host, onAccessFailure = () => {}) {
  let accessFailure = onAccessFailure;
  let state = blank(), context = { scope: null, document: null, hasUnsavedChanges: false }, epoch = 0, active = null, url = null, unknownOrigin = null;
  const originalOwner = c => !!unknownOrigin && !!c.scope && !!c.document &&
    unknownOrigin.memberId === c.scope.memberId && unknownOrigin.workspaceId === c.scope.workspaceId && unknownOrigin.documentId === c.document.id;
  const readDocument = c => state.unknown && originalOwner(c) ? { id: unknownOrigin.documentId, revision: unknownOrigin.revision } : c.document;
  const validList = (r, d) => r && Array.isArray(r.items) && r.items.length <= 2 && r.items.every(m => validMeta(m, d)) && new Set(r.items.map(m => m.format)).size === r.items.length;
  const listeners = new Set();
  const publish = patch => { state = { ...state, ...patch }; for (const f of listeners) f(); };
  const revoke = () => { if (url !== null) { const old = url; url = null; host.revokeObjectURL(old); } };
  const fence = () => { epoch++; if (active) { clearTimeout(active.timer); active.controller.abort(); active = null; } revoke(); };
  const reset = suspended => {
    // A POST is marked unknown BEFORE awaiting. Fences must never silently authorize replay.
    const unknown = state.unknown, conflict = state.conflict;
    fence(); state = { ...blank(), unknown, conflict, suspended }; publish({});
  };
  const canRead = () => allowed(context) && !context.hasUnsavedChanges && !state.busy && !state.suspended && ['ready', 'not_configured'].includes(state.capability?.reason);
  const canCreate = () => canRead() && state.capability.configured && state.capability.canExport && state.capability.reason === 'ready' && !state.unknown && !state.conflict;
  const begin = mutation => {
    fence(); const controller = new AbortController(), token = epoch;
    const abort = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('interrupted')), { once: true }));
    active = { controller, timer: setTimeout(() => controller.abort(), mutation ? 120000 : 30000) };
    publish({ busy: true, issue: '', notice: '', ...(mutation ? { unknown: true, checked: false } : {}) });
    return { token, signal: controller.signal, context, run: fn => Promise.race([Promise.resolve().then(() => { if (token !== epoch || controller.signal.aborted) throw new Error('interrupted'); return fn(); }), abort]) };
  };
  const current = op => op.token === epoch;
  const finish = op => { if (current(op)) { clearTimeout(active?.timer); active = null; publish({ busy: false }); } };
  const fail = (error, mutation = false) => {
    const code = status(error);
    if ([401, 403, 404].includes(code)) {
      reset(true); context = { scope: null, document: null, hasUnsavedChanges: false };
      publish({ issue: '会话、权限或文档已失效，请重新验证访问。' });
      accessFailure(error); return;
    }
    if (code === 409) publish({ unknown: state.unknown, checked: false, conflict: true, issue: '版本冲突或服务忙。请在文档编辑器重读当前文档并合并草稿后再导出；已尝试生成仍需核对原结果。' });
    else if (mutation) publish({ unknown: true, checked: false, issue: '生成结果未知，已锁定新生成。请读取原文档原版本已有导出，核对并单独确认。' });
    else publish({ ...(mutation ? { unknown: false } : {}), checked: false, issue: code === 400 ? '导出参数不符合要求，请检查已保存文档。' : '读取或下载失败，请重新验证访问或主动重读。' });
  };
  return {
    setApi(next) { if (api !== next) { reset(true); context = { scope: null, document: null, hasUnsavedChanges: false }; api = next; } },
    setAccessFailure(callback) { accessFailure = callback ?? (() => {}); },
    subscribe(f) { listeners.add(f); return () => { listeners.delete(f); }; },
    getSnapshot: () => state,
    canRead, canCreate,
    setContext(next) {
      // Copy identity so an externally mutated permissions array cannot change an in-flight context.
      next = { ...next, scope: next.scope ? { ...next.scope, permissions: [...next.scope.permissions] } : null, document: next.document ? { id: next.document.id, revision: next.document.revision } : null };
      if (key(context) === key(next)) return;
      const conflict = state.conflict && context.document?.id === next.document?.id && context.document?.revision === next.document?.revision;
      reset(false); context = next; publish({ conflict });
    },
    conceal() { reset(true); },
    // Resume requires a host-verified context transition (null -> verified scope, or new validationKey).
    // Merely focusing the window never re-enables access with a stale scope.
    clear() { reset(true); context = { scope: null, document: null, hasUnsavedChanges: false }; },
    async capability() {
      if (!allowed(context) || state.busy || state.suspended) return;
      const op = begin(false);
      try { const result = await op.run(() => api.capability(op.context.scope.workspaceId)); if (!current(op)) return; if (!validCapability(result)) throw new Error('invalid response'); publish({ capability: { configured: result.configured, canExport: result.canExport, reason: result.reason } }); }
      catch (e) { if (current(op)) fail(e); } finally { finish(op); }
    },
    async create(format) {
      if (!canCreate() || !Object.hasOwn(MIME, format)) return;
      const op = begin(true), d = op.context.document;
      unknownOrigin = { memberId: op.context.scope.memberId, workspaceId: op.context.scope.workspaceId, documentId: d.id, revision: d.revision };
      try {
        const result = await op.run(() => api.create(op.context.scope.workspaceId, { documentId: d.id, expectedRevision: d.revision, format }, { signal: op.signal }));
        if (!current(op)) return;
        if (!validMeta(result, d) || result.format !== format) throw new Error('invalid response');
        unknownOrigin = null;
        publish({ items: [...state.items.filter(m => m.format !== format), copyMeta(result)], unknown: false, checked: false, notice: '导出已生成，请点击下载。' });
      } catch (e) { if (current(op)) fail(e, true); } finally { finish(op); }
    },
    async list() {
      if (!canRead()) return;
      const op = begin(false), d = readDocument(op.context);
      publish({ checked: false, items: [] });
      try {
        const result = await op.run(() => api.list(op.context.scope.workspaceId, { documentId: d.id, revision: d.revision }, { signal: op.signal }));
        if (!current(op)) return;
        if (!validList(result, d)) throw new Error('invalid response');
        publish({ items: result.items.map(copyMeta), checked: state.unknown && originalOwner(op.context), notice: result.items.length ? `已读取保存版本 v${d.revision} 的导出，请核对格式与版本。` : `保存版本 v${d.revision} 没有已有导出。` });
      } catch (e) { if (current(op)) fail(e); } finally { finish(op); }
    },
    async acknowledge() {
      if (!canRead() || !state.unknown || !state.checked || !originalOwner(context)) return;
      const origin = unknownOrigin, expected = JSON.stringify(state.items), op = begin(false), d = readDocument(op.context);
      try {
        const result = await op.run(() => api.list(op.context.scope.workspaceId, { documentId: d.id, revision: d.revision }, { signal: op.signal }));
        if (!current(op)) return;
        if (unknownOrigin !== origin || !originalOwner(op.context) || !validList(result, d) || JSON.stringify(result.items.map(copyMeta)) !== expected) throw new Error('Reconciliation changed');
        unknownOrigin = null;
        publish({ unknown: false, checked: false, items: [], issue: '', notice: '已确认原生成版本的当前读取结果，可明确发起下一次生成。' });
      } catch (e) { if (current(op)) { publish({ checked: false }); fail(e); } } finally { finish(op); }
    },
    async download(id) {
      if (!canRead()) return;
      const expected = state.items.find(m => m.id === id); if (!expected) return;
      const op = begin(false);
      let bytes;
      try {
        const result = await op.run(() => api.download(op.context.scope.workspaceId, expected, { signal: op.signal }).then(result => { if ((!current(op) || op.signal.aborted) && result?.bytes instanceof Uint8Array) result.bytes.fill(0); return result; }));
        bytes = result?.bytes;
        if (!current(op)) return;
        // The SDK verifies HTTP headers, streaming bound and actual SHA256. Check its returned identity again here.
        if (!(bytes instanceof Uint8Array) || bytes.length !== expected.size || result.mimeType !== expected.mimeType || result.checksum !== expected.checksum || typeof result.filename !== 'string' || !result.filename.endsWith(`.${expected.format}`) || result.filename.length > 180 || (/[\\/]/.test(result.filename) || [...result.filename].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) throw new Error('invalid response');
        url = host.createObjectURL(bytes, result.mimeType);
        if (!current(op)) { revoke(); return; }
        host.download(url, result.filename);
        publish({ notice: '已发起浏览器下载。' });
      } catch (e) { if (current(op)) fail(e); }
      finally { if (bytes instanceof Uint8Array) bytes.fill(0); revoke(); finish(op); }
    }
  };
}
