import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
const require = createRequire(resolve('apps/api/package.json'));
require('ts-node').register({ project: resolve('apps/api/tsconfig.json'), transpileOnly: true });
require('reflect-metadata');
const ai = name => require(resolve('apps/api/src/plugins/aij-ai/' + name + '.ts'));
const { AiPersonalAgentPublicationsService: Service } = ai('ai-personal-agent-publications.service');
const { AiPersonalAgentPublicationsController: Controller } = ai('ai-personal-agent-publications.controller');
const dto = ai('ai-personal-agent-publications.dto');
const { WorkspaceContextService } = require(resolve('apps/api/src/client-workspaces/workspace-context.service.ts'));
const { PluginRuntimeAccessService } = require(resolve('apps/api/src/plugin-runtime/plugin-runtime-access.service.ts'));
const { CLIENT_WORKSPACE_PERMISSION: P } = require(resolve('apps/api/src/client-workspaces/client-workspace-permissions.ts'));
const { ConflictException } = require('@nestjs/common');
const id = '7ac902e2-d7fa-44f0-82bd-2a4c27f7c009';
const cas = (epoch = 0, revision = 2) => ({ expectedAgentRevision: revision, expectedPublicationVersion: epoch });
const status = n => e => e.getStatus?.() === n;
const metadata = (epoch = 0, published = false) => ({ agentId: id, revision: 2, publishedRevision: published ? 2 : null,
  publicationVersion: epoch, published, dependencyReadiness: { ready: true, reason: 'ready' } });
function compile(path, extras = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {}, local = createRequire(resolve(path));
  new Function('require', 'exports', code)(name => Object.hasOwn(extras, name) ? extras[name] : local(name), exports);
  return exports;
}
const sdk = compile('packages/sdk/src/personal-agent-publications.ts');
const ui = compile('apps/web/app/components/client-agent-publication.tsx', { antd: {}, react: {}, 'react/jsx-runtime': {} });
// OFFLINE ONLY. Real services + rollback model, not evidence of PG lock scheduling.
function fixture(withValidator = true) {
  const state = { h: { id, revision: 2, enabled: true, published_revision: null, publication_version: 0 }, deleted: false,
    project: true, org: true, plugin: true, member: true, allowForeignMember: false, denied: new Set(), validations: 0, valid: true,
    audits: [], sql: [], auditFail: false, updateMiss: false, transactions: 0 };
  const tx = {
    projectProfile: { findFirst: async () => state.project && state.org ? { id: 'project' } : null },
    pluginInstallation: { findUnique: async () => ({ status: state.plugin ? 'enabled' : 'disabled' }) },
    auditLog: { create: async ({ data }) => { if (state.auditFail) throw Error('PRIVATE_SQL_ERROR'); state.audits.push(data); return {}; } },
    $executeRaw: async (s, ...v) => { state.sql.push({ q: s.join('?'), v }); return 1; },
    $queryRaw: async (s, ...v) => {
      const q = s.join('?'); state.sql.push({ q, v });
      if (q.includes('client_workspace_membership')) return state.member && (v.includes('owner') || state.allowForeignMember) && v.includes('space') && !state.denied.has(v.at(-1)) ? [{ id: 'membership' }] : [];
      if (q.includes('project_profile')) return state.project && state.org ? [{ id: 'project' }] : [];
      if (q.includes('plugin_installation')) return state.plugin ? [{ id: 'installation' }] : [];
      if (q.includes('scoped_config')) return [{ id: 'catalog' }];
      if (q.includes('ai_personal_agent')) {
        if (!v.includes(id) || !v.includes('space') || !v.includes('owner') || state.deleted) return [];
        if (/^UPDATE/.test(q)) {
          if (state.updateMiss) return [];
          state.h = { ...state.h, published_revision: v[0], publication_version: state.h.publication_version + 1 };
        }
        return [{ ...state.h }];
      }
      assert.fail('Unexpected SQL: ' + q);
    }
  };
  const prisma = { $transaction: async (fn, options) => {
    state.transactions++; assert.equal(options.isolationLevel, 'ReadCommitted');
    const before = structuredClone({ h: state.h, audits: state.audits });
    try { return await fn(tx); } catch (e) { state.h = before.h; state.audits = before.audits; throw e; }
  } };
  const config = { getOrThrow: key => ({ projectId: 'aij-foundation', environment: 'test' })[key] };
  const validator = { validate: async (store, scope) => {
    assert.equal(store, tx); assert.deepEqual(scope, { projectId: 'project', memberId: 'owner', workspaceId: 'space', agentId: id, revision: 2 });
    state.validations++; if (!state.valid) throw new ConflictException('PRIVATE_DEPENDENCY');
  } };
  const service = new Service(prisma, new WorkspaceContextService(prisma), new PluginRuntimeAccessService(prisma, config), withValidator ? validator : undefined);
  return { state, service, get: (member = 'owner', space = 'space') => service.get(member, space, id),
    publish: (b = cas()) => service.publish('owner', 'space', id, b, 'af189-safe'), unpublish: (b = cas(1)) => service.unpublish('owner', 'space', id, b) };
}

test('strict DTO accepts only exact numeric CAS pair and canonical private UUID', () => {
  assert.deepEqual(dto.personalAgentPublicationMutation(cas()), cas());
  for (const raw of [null, [], {}, { ...cas(), snapshot: {} }, { ...cas(), expectedAgentRevision: '2' },
    { ...cas(), expectedPublicationVersion: -1 }, { ...cas(), expectedPublicationVersion: 2147483648 },
    { ...cas(), expectedAgentRevision: 0 }, { ...cas(), expectedPublicationVersion: 1.2 }, { ...cas(), expectedPublicationVersion: NaN },
    Object.assign(Object.create({ extra: 1 }), cas()), Object.defineProperty(cas(), 'getter', { get() { throw Error(); } }),
    Object.assign(cas(), { [Symbol('extra')]: true })]) assert.throws(() => dto.personalAgentPublicationMutation(raw), status(400));
  for (const value of ['personal:' + id, 'p-' + id, id.toUpperCase(), '../x', undefined]) assert.throws(() => dto.personalAgentPublicationId(value), status(400));
});
test('metadata allowlist, real permission/lifecycle fence, lock ordering and no secret content', async () => {
  const f = fixture(); assert.deepEqual(await f.get(), metadata()); assert.equal(f.state.audits.length, 0);
  const q = f.state.sql.map(x => x.q);
  assert.ok(q.some(x => x.includes('FOR SHARE OF p,o'))); assert.ok(q.some(x => x.includes('FOR SHARE OF u, w, m, r, g, p')));
  assert.ok(q.findIndex(x => x.includes('scoped_config')) < q.findIndex(x => x.includes('ai_personal_agent')));
  assert.match(q.at(-1), /FOR UPDATE/); assert.doesNotMatch(JSON.stringify(await f.get()), /instructions|PRIVATE_|credential|https:|env:|snapshot/i);
});
test('publish/noop/unpublish ABA advances only epoch, with immutable authored revision and metadata-only audits', async () => {
  const f = fixture(); assert.deepEqual(await f.publish(), metadata(1, true));
  assert.deepEqual(await f.publish(cas(1)), metadata(1, true)); assert.equal(f.state.audits.length, 1);
  assert.deepEqual(await f.unpublish(), metadata(2)); assert.deepEqual(await f.unpublish(cas(2)), metadata(2));
  assert.deepEqual(await f.publish(cas(2)), metadata(3, true)); assert.equal(f.state.h.revision, 2); assert.equal(f.state.audits.length, 3);
  assert.deepEqual(Object.keys(f.state.audits[0].afterData).sort(), ['agentId', 'publicationVersion', 'publishedRevision', 'revision']);
  assert.doesNotMatch(f.state.sql.filter(x => /^UPDATE/.test(x.q)).map(x => x.q).join(''), /revision=revision|version SET|runtime_job|ai_agent_run/);
});
test('CAS mismatch including desired-state replay refuses without audit/epoch changes', async () => {
  const f = fixture(); await f.publish();
  for (const b of [cas(), cas(1, 3), cas(2)]) await assert.rejects(f.publish(b), status(409));
  assert.equal(f.state.audits.length, 1); assert.equal(f.state.h.publication_version, 1);
  f.state.updateMiss = true; await assert.rejects(f.unpublish(), status(409)); assert.equal(f.state.h.publication_version, 1);
});
test('same transaction audit failure rolls back committed-state candidates and hides SQL details', async () => {
  const f = fixture(); f.state.auditFail = true; await assert.rejects(f.publish(), e => status(503)(e) && !e.message.includes('PRIVATE_'));
  assert.deepEqual(f.state.h, { id, revision: 2, enabled: true, published_revision: null, publication_version: 0 }); assert.deepEqual(f.state.audits, []);
});
test('foreign/deleted/readonly/member/project/org/plugin refusal; denied writes leave epoch untouched', async () => {
  for (const key of ['project', 'org', 'plugin', 'member']) {
    const f = fixture(); f.state[key] = false; await assert.rejects(f.publish()); assert.equal(f.state.audits.length, 0);
  }
  const f = fixture(); await assert.rejects(f.get('foreign'), status(403));
  f.state.allowForeignMember = true; await assert.rejects(f.get('foreign'), status(404));
  f.state.deleted = true; await assert.rejects(f.get(), status(404)); f.state.deleted = false;
  f.state.denied.add(P.aiAssetsManage); await assert.rejects(f.publish(), status(403)); assert.deepEqual(await f.get(), metadata());
  f.state.denied.add(P.aiAssetsRead); await assert.rejects(f.get(), status(403)); assert.equal(f.state.h.publication_version, 0);
});
test('disabled/current dependency failure and missing validator fail closed; revocation remains available', async () => {
  const f = fixture(); f.state.valid = false; assert.equal((await f.get()).dependencyReadiness.reason, 'dependencies_unavailable'); await assert.rejects(f.publish(), status(409));
  f.state.valid = true; await f.publish(); f.state.valid = false; assert.equal((await f.unpublish()).published, false);
  f.state.h.enabled = false; assert.equal((await f.get()).dependencyReadiness.reason, 'disabled'); await assert.rejects(f.publish(cas(2)), status(409));
  const missing = fixture(false); assert.equal((await missing.get()).dependencyReadiness.reason, 'validator_unavailable'); await assert.rejects(missing.publish(), status(503));
  assert.equal((await missing.unpublish(cas())).publicationVersion, 0);
});
test('epoch overflow fails without writing; legacy schema state fails closed', async () => {
  const f = fixture(); f.state.h.publication_version = 2147483647; await assert.rejects(f.publish(cas(2147483647)), status(409));
  f.state.h.publication_version = undefined; await assert.rejects(f.get(), status(503)); assert.equal(f.state.audits.length, 0);
});
test('controller strict query, origin, bodyless GET, no-store and permission metadata', () => {
  const { CLIENT_WORKSPACE_PERMISSIONS_KEY } = require(resolve('apps/api/src/client-workspaces/client-workspace-permission.decorator.ts'));
  const { GUARDS_METADATA } = require('@nestjs/common/constants');
  const { PersonalAgentNoStoreGuard } = ai('ai-personal-agents.controller');
  const c = new Controller({ get: (...args) => args, publish: (...args) => args, unpublish: (...args) => args }, { getOrThrow: () => 'http://127.0.0.1:3655' });
  const r = { client: { id: 'owner' }, workspaceContext: { workspaceId: 'space' }, headers: { origin: 'http://127.0.0.1:3655' } };
  assert.deepEqual(c.get(r, id, {}, undefined), ['owner', 'space', id]);
  for (const action of ['publish', 'unpublish']) {
    assert.deepEqual(c[action](r, id, {}, cas()).slice(0, 4), ['owner', 'space', id, cas()]);
    for (const headers of [{}, { origin: 'https://foreign.invalid' }, { ...r.headers, 'sec-fetch-site': 'cross-site' }]) assert.throws(() => c[action]({ ...r, headers }, id, {}, cas()), status(403));
    assert.deepEqual(Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY, Controller.prototype[action]), [P.aiAssetsManage]);
  }
  assert.deepEqual(Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY, Controller.prototype.get), [P.aiAssetsRead]);
  assert.ok(Reflect.getMetadata(GUARDS_METADATA, Controller).includes(PersonalAgentNoStoreGuard));
  assert.throws(() => c.get(r, id, { member: 'forged' }, undefined), status(400)); assert.throws(() => c.get(r, id, {}, {}), status(400));
});
test('SDK validates request/response and identity, immutable safe metadata, exact transport and no automatic retry', async () => {
  const calls = []; const client = sdk.createPersonalAgentPublicationsClient(async (path, options) => { calls.push({ path, options }); return path.endsWith('/publish') ? metadata(1, true) : path.endsWith('/unpublish') ? metadata(1) : metadata(); });
  assert.deepEqual(await client.get('space', id), metadata()); await client.publish('space', id, cas()); await client.unpublish('space', id, cas());
  assert.equal(calls[0].path, '/client/ai/personal-agents/' + id + '/publication'); assert.deepEqual(calls[0].options, { method: 'GET', workspaceId: 'space' });
  assert.deepEqual(JSON.parse(calls[1].options.body), cas()); assert.equal(calls[1].options.method, 'POST');
  await assert.rejects(sdk.createPersonalAgentPublicationsClient(async () => metadata()).publish('space', id, cas()), TypeError);
  await assert.rejects(sdk.createPersonalAgentPublicationsClient(async () => metadata(5, true)).publish('space', id, cas()), TypeError);
  assert.throws(() => client.publish('space', id, { ...cas(), published: true }), TypeError);
  for (const raw of [null, { ...metadata(), credentialRef: 'private' }, { ...metadata(), agentId: 'foreign' }, { ...metadata(), published: true },
    { ...metadata(), publicationVersion: '0' }, { ...metadata(), revision: 0 }, { ...metadata(), publishedRevision: 1 },
    { ...metadata(), dependencyReadiness: { ready: true, reason: 'disabled' } }, { ...metadata(), dependencyReadiness: { ready: false, reason: 'secret-missing' } }])
    await assert.rejects(sdk.createPersonalAgentPublicationsClient(async () => raw).get('space', id), TypeError);
  let attempts = 0; await assert.rejects(sdk.createPersonalAgentPublicationsClient(async () => { attempts++; throw Error('lost'); }).publish('space', id, cas())); assert.equal(attempts, 1);
  assert.equal(Object.isFrozen(await client.get('space', id)), true);
});
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function uiFixture() {
  const scope = { workspaceId: 'space', memberId: 'owner', sessionKey: 'session1', roleKey: 'owner', revalidationKey: 'r1', permissions: [P.aiAssetsRead, P.aiAssetsManage, P.aiExecute] };
  const f = { scope, fresh: scope, value: metadata(), writes: 0, debug: 0, getHook: null, writeHook: null };
  f.store = ui.createAgentPublicationState({ agentId: id, scope, revalidate: async () => f.fresh, onDebug: () => f.debug++, api: {
    get: async () => f.getHook ? f.getHook() : f.value,
    publish: async () => { f.writes++; if (f.writeHook) return f.writeHook(); return (f.value = metadata(1, true)); },
    unpublish: async () => { f.writes++; return (f.value = metadata(2)); }
  } }); return f;
}
test('UI deliberate confirmation, fresh CAS before mutation, conflicts preserve intent', async () => {
  const f = uiFixture(); await f.store.read(); await f.store.request('publish'); assert.equal(f.store.getSnapshot().confirmation, 'publish');
  f.value = metadata(4); await f.store.confirm(); assert.equal(f.writes, 0); assert.equal(f.store.getSnapshot().intent, 'publish'); assert.match(f.store.getSnapshot().issue, /版本/);
  await f.store.request('publish'); await f.store.confirm(); assert.equal(f.writes, 1); assert.equal(f.store.getSnapshot().intent, null);
  await f.store.debug(); assert.equal(f.debug, 1); f.store.dispose();
});
test('UI lost response requires explicit read and acknowledge, never automatic replay', async () => {
  const f = uiFixture(); f.writeHook = async () => { f.value = metadata(1, true); throw Error('lost'); };
  await f.store.request('publish'); await f.store.confirm(); assert.equal(f.writes, 1); assert.equal(f.store.getSnapshot().uncertain, true);
  await f.store.request('publish'); await f.store.confirm(); await f.store.debug(); assert.equal(f.writes, 1); assert.equal(f.debug, 0);
  f.store.acknowledge(); assert.equal(f.store.getSnapshot().uncertain, true); await f.store.read(); f.store.acknowledge(); assert.equal(f.store.getSnapshot().uncertain, false);
  assert.equal(f.writes, 1); f.store.dispose();
});
test('UI scope/session/member/role/grants/revalidation changes clear metadata and reject pending callbacks', async () => {
  for (const [key, value] of [['workspaceId', 'other'], ['sessionKey', 'session2'], ['memberId', 'other'], ['roleKey', 'readonly'], ['revalidationKey', 'r2'], ['permissions', []]]) {
    const f = uiFixture(), gate = deferred(); f.getHook = () => gate.promise; const pending = f.store.request('publish');
    await Promise.resolve(); f.fresh = { ...f.scope, [key]: value }; gate.resolve(metadata()); await pending;
    assert.equal(f.store.getSnapshot().metadata, null); assert.equal(f.store.getSnapshot().confirmation, null); assert.equal(f.writes, 0); f.store.dispose();
  }
});
test('UI dispose/focus/visibility generation fence blocks pending metadata, confirmation and debug', async () => {
  for (const action of ['request', 'debug', 'read']) {
    const f = uiFixture(), gate = deferred(); f.getHook = () => gate.promise;
    const pending = action === 'request' ? f.store.request('publish') : f.store[action](); await Promise.resolve(); f.store.dispose(); gate.resolve(metadata(1, true)); await pending;
    assert.equal(f.store.getSnapshot().metadata, null); assert.equal(f.store.getSnapshot().confirmation, null); assert.equal(f.debug, 0); assert.equal(f.writes, 0);
  }
});
test('UI lost in-flight write after dispose stays uncertain; readonly never writes', async () => {
  const f = uiFixture(), gate = deferred(); f.writeHook = () => gate.promise; await f.store.request('publish'); const pending = f.store.confirm();
  while (!f.writes) await Promise.resolve(); f.store.dispose(); gate.resolve(metadata(1, true)); await pending;
  assert.equal(f.store.getSnapshot().metadata, null); assert.equal(f.store.getSnapshot().uncertain, true);
  const ro = uiFixture(); ro.scope.permissions.splice(1, 1); await ro.store.request('publish'); assert.equal(ro.writes, 0); ro.store.dispose();
});
test('UI same-scope port refresh retains uncertain write fencing across parent renders', async () => {
  const f = uiFixture(); f.writeHook = async () => { throw Error('lost'); };
  await f.store.request('publish'); await f.store.confirm(); assert.equal(f.store.getSnapshot().uncertain, true);
  let writes = 0;
  f.store.updatePorts({ agentId: id, scope: { ...f.scope, permissions: [...f.scope.permissions] },
    revalidate: async () => ({ ...f.scope }), onDebug: () => {}, api: {
      get: async () => metadata(1, true), publish: async () => { writes++; return metadata(2, true); }, unpublish: async () => { writes++; return metadata(2); }
    } });
  await f.store.request('unpublish'); assert.equal(writes, 0); assert.equal(f.store.getSnapshot().uncertain, true);
  await f.store.read(); f.store.acknowledge(); assert.equal(f.store.getSnapshot().uncertain, false); f.store.dispose();
});
test('modal focus tickets cannot restore focus after scope disposal or a later operation', async () => {
  const f = uiFixture(); await f.store.request('publish');
  const ticket = f.store.cancel(); assert.equal(f.store.canRestoreFocus(ticket), true);
  await f.store.read(); assert.equal(f.store.canRestoreFocus(ticket), false);
  const next = f.store.cancel(); f.store.dispose(); assert.equal(f.store.canRestoreFocus(next), false);
});
test('source boundaries preserve RAM-only embedded design and registered owner transaction', () => {
  const component = readFileSync('apps/web/app/components/client-agent-publication.tsx', 'utf8');
  assert.doesNotMatch(component, /localStorage|sessionStorage|dangerouslySetInnerHTML|console\.|fetch\(|createPersonalAgentPublicationsClient/);
  assert.match(component, /import type .*personal-agent-publications/); assert.match(component, /visibilitychange/); assert.match(component, /'blur'/); assert.match(component, /'focus'/);
  const service = readFileSync('apps/api/src/plugins/aij-ai/ai-personal-agent-publications.service.ts', 'utf8');
  assert.doesNotMatch(service, /SecretRefPort|resolveTrusted|aiAgentRun|runtimeJob|budget\.reserve|skipPublished/);
});
test('strict noEmit for every candidate file; transitive baseline diagnostics remain explicit', () => {
  const files = ['packages/sdk/src/personal-agent-publications.ts', 'apps/web/app/components/client-agent-publication.tsx',
    ...['controller', 'service', 'dto'].map(x => `apps/api/src/plugins/aij-ai/ai-personal-agent-publications.${x}.ts`)];
  const program = ts.createProgram(files, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
    jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, noEmit: true, esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true });
  const all = ts.getPreEmitDiagnostics(program);
  const describe = d => `${d.file?.fileName}:${d.start} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
  const own = all.filter(d => !d.file || files.some(f => resolve(f) === resolve(d.file.fileName)));
  const inherited = all.filter(d => !own.includes(d));
  mkdirSync('.artifacts/af189', { recursive: true }); writeFileSync('.artifacts/af189/compiler.json', JSON.stringify({ candidate: own.map(describe), inherited: inherited.map(describe), wholeCompilation: all.length ? 'FAIL' : 'PASS' }, null, 2));
  assert.deepEqual(own.map(describe), []);
  // No allowlist suppresses unexpected transitive errors. This origin94 declaration is a root-owned bootstrap gap.
  for (const d of inherited) assert.match(describe(d), /scripts\/dictionary-policy\.cjs.*has no exported member named 'dictionaryEffectivePermissions'/);
});
