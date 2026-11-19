import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExternalServicesState } from '../../apps/web/app/components/admin-external-services-state.mjs';
const view = version => ({ providerCode: 'p', version, fields: { x: 'old' }, credentialStates: { secret: true }, missingFields: [], configurationStatus: 'draft', runtimeEnabled: false, externalVerification: 'not_run' });
const setup = overrides => { let state; const api = { catalog: async () => ({ providers: [] }), get: async () => view(1), save: async (_, dto) => view(dto.expectedVersion + 1), ...overrides }; const m = createExternalServicesState(api, s => { state = s; }); return { m, get state() { return state; } }; };
test('authorization refusal during an explicit recovery read clears the private draft and references', async () => {
  for (const status of [401, 403]) {
    let refused = false;
    const x = setup({ get: async () => { if (refused) throw { status }; return view(1); } });
    await x.m.open('p'); x.m.field('x', 'private-draft'); x.m.ref('secret', 'synthetic-reference');
    refused = true; await x.m.reload();
    assert.equal(x.state.view, null); assert.deepEqual(x.state.fields, {}); assert.deepEqual(x.state.refs, {});
    assert.equal(x.state.busy, false); assert.equal(x.state.blocked, true);
  }
});
test('stale identity responses cannot repopulate disposed drafts', async () => { let resolve; const x = setup({ get: () => new Promise(r => resolve = r) }); const pending = x.m.open('p'); x.m.dispose(); resolve(view(1)); await pending; assert.equal(x.state.view, null); });
test('cleared fields and explicit reference clearing are sent, blanks preserve', async () => { let dto; const x = setup({ save: async (_, d) => { dto = d; return view(2); } }); await x.m.open('p'); x.m.field('x', ''); x.m.ref('secret', null); x.m.ref('other', ''); await x.m.save(); assert.deepEqual(dto, { expectedVersion: 1, fields: { x: '' }, credentialRefs: { secret: null } }); assert.deepEqual(x.state.refs, {}); });
test('conflict and unknown failure retain draft and require explicit reread and confirmation; no retry', async () => { for (const failure of [{ status: 409 }, new Error('network')]) { let calls = 0; const x = setup({ save: async () => { calls++; throw failure; }, get: async () => view(calls ? 2 : 1) }); await x.m.open('p'); x.m.field('x', 'draft'); await x.m.save(); await x.m.save(); assert.equal(calls, 1); assert.equal(x.state.fields.x, 'draft'); assert.equal(x.state.blocked, true); await x.m.reload(); assert.equal(x.state.view.version, 1); x.m.confirm(); assert.equal(x.state.view.version, 2); assert.equal(x.state.fields.x, 'draft'); } });
test('failed reload keeps blocked draft', async () => { let reads = 0; const x = setup({ get: async () => { if (reads++) throw Error(); return view(1); }, save: async () => { throw Error(); } }); await x.m.open('p'); x.m.field('x', 'draft'); await x.m.save(); await x.m.reload(); x.m.confirm(); assert.equal(x.state.blocked, true); assert.equal(x.state.fields.x, 'draft'); });
test('in-flight save freezes draft edits and submits what remains visible', async () => {
  let resolveSave, submitted;
  const x = setup({ save: (_, dto) => { submitted = dto; return new Promise(r => { resolveSave = r; }); } });
  await x.m.open('p'); x.m.field('x', 'submitted'); x.m.ref('secret', 'ref-one');
  const pending = x.m.save(); x.m.field('x', 'too late'); x.m.ref('secret', null); x.m.ref('other', 'too late'); x.m.confirm();
  assert.deepEqual(submitted, { expectedVersion: 1, fields: { x: 'submitted' }, credentialRefs: { secret: 'ref-one' } });
  assert.equal(x.state.fields.x, 'submitted'); assert.deepEqual(x.state.refs, { secret: 'ref-one' });
  resolveSave({ ...view(2), fields: { x: 'submitted' } }); await pending;
  assert.equal(x.state.fields.x, 'submitted'); assert.deepEqual(x.state.refs, {});
});
test('confirm cannot unblock while a reload is in flight', async () => {
  let reads = 0, resolveRead;
  const x = setup({ save: async () => { throw { status: 409 }; }, get: () => ++reads < 3 ? Promise.resolve(view(reads)) : new Promise(r => { resolveRead = r; }) });
  await x.m.open('p'); await x.m.save(); await x.m.reload(); const pending = x.m.reload(); x.m.confirm();
  assert.equal(x.state.blocked, true); assert.equal(x.state.view.version, 1);
  resolveRead(view(3)); await pending; x.m.confirm(); assert.equal(x.state.view.version, 3);
});
test('401 and 403 erase private drafts and prevent further save', async () => {
  for (const status of [401, 403]) {
    let saves = 0;
    const x = setup({ save: async () => { saves++; throw { status }; } });
    await x.m.open('p'); x.m.field('x', 'private'); x.m.ref('secret', 'private-reference'); await x.m.save();
    assert.equal(x.state.view, null); assert.deepEqual(x.state.fields, {}); assert.deepEqual(x.state.refs, {}); assert.deepEqual(x.state.providers, []);
    assert.match(x.state.error, /重新验证权限/); assert.equal(x.state.blocked, true); await x.m.save(); assert.equal(saves, 1);
  }
});
test('catalog failure is retryable', async () => {
  let calls = 0; const x = setup({ catalog: async () => { if (++calls === 1) throw Error(); return { providers: [{ code: 'p' }] }; } });
  await x.m.start(); assert.equal(x.state.catalogFailed, true); await x.m.start(); assert.equal(x.state.catalogFailed, false); assert.equal(x.state.providers[0].code, 'p');
});
