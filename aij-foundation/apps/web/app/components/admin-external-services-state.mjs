// Per-mount RAM-only controller. Invalidation fences responses even when an adapter ignores AbortSignal.
export function createExternalServicesState(api, notify) {
  let epoch = 0, controller = new AbortController();
  let state = { providers: [], view: null, fields: {}, refs: {}, error: '', busy: false, blocked: false, latest: null, catalogFailed: false };
  const publish = patch => { state = { ...state, ...patch }; notify(state); };
  const invalidate = () => { epoch++; controller.abort(); controller = new AbortController(); };
  const run = async (fn, success, failure) => {
    const ticket = epoch; publish({ busy: true, error: '' });
    try { const result = await fn(controller.signal); if (ticket === epoch) success(result); }
    catch (err) { if (ticket === epoch) {
      if (err?.status === 401 || err?.status === 403) {
        invalidate();
        publish({ providers: [], view: null, fields: {}, refs: {}, latest: null, busy: false, blocked: true, catalogFailed: false, error: '登录或权限已失效，请重新验证权限后再操作。' });
      } else failure(err);
    } }
    finally { if (ticket === epoch) publish({ busy: false }); }
  };
  return {
    start() { invalidate(); publish({ providers: [], view: null, fields: {}, refs: {}, latest: null, blocked: false, catalogFailed: false }); return run(s => api.catalog(s), data => publish({ providers: data.providers }), () => publish({ catalogFailed: true, error: '无法读取服务目录，请重试。' })); },
    open(code) { invalidate(); publish({ view: null, fields: {}, refs: {}, latest: null, blocked: false }); return run(s => api.get(code, s), view => publish({ view, fields: { ...view.fields } }), () => publish({ error: '无法读取配置，请重试。' })); },
    field(key, value) { if (state.busy) return; publish({ fields: { ...state.fields, [key]: value } }); },
    ref(key, value) { if (state.busy) return; const refs = { ...state.refs }; if (value === '') delete refs[key]; else refs[key] = value; publish({ refs }); },
    save() { if (!state.view || state.busy || state.blocked) return; const { view, fields, refs } = state; const dto = { expectedVersion: view.version, fields: { ...fields }, ...(Object.keys(refs).length ? { credentialRefs: { ...refs } } : {}) }; return run(s => api.save(view.providerCode, dto, s), next => publish({ view: next, fields: { ...next.fields }, refs: {}, latest: null }), err => err?.status === 401 || err?.status === 403 ? publish({ providers: [], view: null, fields: {}, refs: {}, latest: null, blocked: true, catalogFailed: false, error: '登录或权限已失效，请重新验证权限后再操作。' }) : publish({ blocked: true, error: err?.status === 409 ? '版本冲突。请读取最新版本并确认后再保存；当前草稿已保留。' : '保存失败或结果未知。请先读取最新版本并核对；不会自动重试。' })); },
    reload() { if (!state.view || state.busy) return; return run(s => api.get(state.view.providerCode, s), latest => publish({ latest, error: '请核对最新版本后确认继续，草稿不会自动覆盖。' }), () => publish({ error: '读取最新版本失败，请重试。' })); },
    confirm() { if (!state.busy && state.latest) publish({ view: state.latest, latest: null, blocked: false, error: '' }); },
    dispose() { invalidate(); state = { providers: [], view: null, fields: {}, refs: {}, error: '', busy: false, blocked: false, latest: null, catalogFailed: false }; }
  };
}
