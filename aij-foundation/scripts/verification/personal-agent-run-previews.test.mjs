import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { syntheticAiCatalog } from './ai-center-fixture.mjs';

const require = createRequire(resolve('apps/api/package.json'));
require('ts-node').register({ project: resolve('apps/api/tsconfig.json'), transpileOnly: true });
require('reflect-metadata');
const load = path => require(resolve('apps/api/src/' + path + '.ts'));
const ai = path => load('plugins/aij-ai/' + path);
const { AiPersonalAgentRunPreviewsService } = ai('ai-personal-agent-run-previews.service');
const { AiPersonalAgentRunPreviewsController, PersonalAgentRunPreviewNoStoreGuard, personalAgentRunPreviewNoStore } = ai('ai-personal-agent-run-previews.controller');
const { personalAgentPreviewId, personalAgentRunPreviewQuery, assertPersonalAgentPreviewNoBody } = ai('ai-personal-agent-run-previews.dto');
const { AiPersonalAgentSnapshotsService } = ai('ai-personal-agent-snapshots.service');
const { AiCenterConfigurationService } = ai('ai-center-configuration.service');
const { AiCenterBudgetService } = ai('ai-center-budget.service');
const { WorkspaceContextService } = load('client-workspaces/workspace-context.service');
const { PluginRuntimeAccessService } = load('plugin-runtime/plugin-runtime-access.service');
const { CLIENT_WORKSPACE_PERMISSION: P } = load('client-workspaces/client-workspace-permissions');
const { CLIENT_WORKSPACE_PERMISSIONS_KEY } = load('client-workspaces/client-workspace-permission.decorator');
const id = '7ac902e2-d7fa-44f0-82bd-2a4c27f7c009';
const sid = 'e39285c8-78eb-45bc-81c5-9be1bfcdaf3b';
const keys = ['personalAgentId', 'code', 'name', 'revision', 'inputFields', 'outputFormat', 'outputFields', 'capability',
  'modelCode', 'modelRevision', 'catalogVersion', 'maximumEstimatedCostNanos', 'modelExecutionConfigured'];

// Explicit OFFLINE transaction adapter. Actual source services run; this does not prove PostgreSQL locks.
function fixture() {
  const catalog = syntheticAiCatalog('env://AIJ_SECRET_AIJ_FOUNDATION_TEST_AF165');
  const a = { id, code: 'own-agent', name: 'Own Agent', instructions: 'PRIVATE_AGENT_SENTINEL', enabled: true, published_revision: 2, publication_version: 1,
    model_code: 'advice-text', model_revision: 1, catalog_version: 4, input_fields: ['question'],
    output_format: 'json', output_fields: ['answer'], revision: 2 };
  const state = { catalog, a, v: { ...a, id: 'version', skill_binding_count: 2 }, version: 4, activeProject: true, activeOrg: true,
    plugin: true, denied: new Set(), activeMember: true, skills: [
      { id: 'pin2', skill_id: sid, revision: 2, name: 'Private Skill', instructions: 'PRIVATE_SKILL_SENTINEL', position: 0 },
      { id: 'pin1', skill_id: '27870614-6339-41e9-b4ce-dbe55b074f9e', revision: 1, name: 'Another', instructions: 'SECOND_SKILL', position: 1 }],
    flags: {}, sql: [], permissions: [], transactions: 0, configured: true, checks: 0, resolutions: 0 };
  const tx = {
    projectProfile: { findFirst: async () => state.activeProject && state.activeOrg ? { id: 'project' } : null },
    pluginInstallation: { findUnique: async () => ({ status: state.plugin ? 'enabled' : 'installed' }) },
    scopedConfig: { findUnique: async () => ({ version: state.version, status: 'active', deletedAt: null, valueType: 'string', configValue: JSON.stringify(catalog) }) },
    $executeRaw: async (s, ...values) => { const q = s.join('?'); assert.match(q, /^SELECT pg_advisory_xact_lock/); state.sql.push({ q, values }); },
    $queryRaw: async (s, ...values) => {
      const q = s.join('?'); state.sql.push({ q, values }); assert.match(q.trim(), /^SELECT /);
      if (q.includes('client_workspace_membership')) {
        const permission = values.at(-1); state.permissions.push(permission);
        return state.activeMember && values.includes('owner') && values.includes('space') && !state.denied.has(permission) ? [{ id: 'membership' }] : [];
      }
      if (q.includes('project_profile')) return state.activeProject && state.activeOrg ? [{ id: 'project' }] : [];
      if (q.includes('plugin_installation')) return state.plugin ? [{ id: 'installation' }] : [];
      if (q.includes('ai_personal_agent_skill_binding')) return state.skills;
      if (q.includes('ai_personal_agent_version')) return [state.v];
      if (q.includes('ai_personal_agent')) return state.a && values.includes('owner') && values.includes('space') ? [state.a] : [];
      if (q.includes('scoped_config')) return [{ id: 'catalog' }];
      assert.fail('unexpected query ' + q);
    }
  };
  const prisma = { $transaction: async (fn, options) => {
    state.transactions++; assert.equal(options.isolationLevel, 'ReadCommitted'); return fn(tx);
  } };
  const config = { get: key => state.flags[key], getOrThrow: key => ({ projectId: 'aij-foundation', environment: 'test' })[key] };
  const plugins = new PluginRuntimeAccessService(prisma, config), workspaces = new WorkspaceContextService(prisma);
  const secrets = { configuredTrusted: async (store, ref) => { assert.equal(store, tx); assert.equal(ref, catalog.providers[0].credentialRef); state.checks++; if (state.secretError) throw state.secretError; return state.configured; },
    resolveTrusted: async () => { state.resolutions++; assert.fail('secret resolution'); },
    resolveTrustedForPlugin: async () => { state.resolutions++; assert.fail('secret resolution'); } };
  const configuration = new AiCenterConfigurationService(prisma, {}, {}, plugins, secrets, config);
  const budget = new AiCenterBudgetService();
  const service = new AiPersonalAgentRunPreviewsService(prisma, workspaces, plugins, configuration, new AiPersonalAgentSnapshotsService(), budget, secrets, config);
  const preview = (member = 'owner', space = 'space', query = { expectedRevision: '2' }) => service.preview(member, space, id, query);
  const enable = () => { state.flags.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'true'; state.flags.AI_CENTER_LIVE_ENABLED = 'true'; catalog.providers[0].liveEnabled = true; };
  return { state, service, preview, enable, budget };
}
const status = code => error => error.getStatus?.() === code;

test('strict UUID/query/no-body accepts only canonical expectedRevision, rejects context/source and duplicate arrays', () => {
  assert.equal(personalAgentPreviewId(id), id); assert.deepEqual(personalAgentRunPreviewQuery({ expectedRevision: '2147483647' }), { expectedRevision: 2147483647 });
  for (const x of [undefined, 'p-' + id, 'personal:' + id, id.toUpperCase(), '../x', id + '/runs']) assert.throws(() => personalAgentPreviewId(x), status(400));
  for (const q of [null, [], {}, { expectedRevision: 2 }, { expectedRevision: ['2', '2'] }, ...['0', '-1', '01', '1e2', ' 2', '2147483648'].map(expectedRevision => ({ expectedRevision }))])
    assert.throws(() => personalAgentRunPreviewQuery(q), status(400));
  for (const field of ['workspaceId', 'memberId', 'source', 'snapshot', 'model', 'provider', 'instructions', 'memory', 'tools', 'input'])
    assert.throws(() => personalAgentRunPreviewQuery({ expectedRevision: '2', [field]: 'forged' }), status(400));
  assertPersonalAgentPreviewNoBody(undefined, {}); assertPersonalAgentPreviewNoBody(undefined, { 'content-length': '0' });
  for (const body of [null, {}, [], '']) assert.throws(() => assertPersonalAgentPreviewNoBody(body, {}), status(400));
  for (const headers of [{ 'content-length': '2' }, { 'transfer-encoding': 'chunked' }]) assert.throws(() => assertPersonalAgentPreviewNoBody(undefined, headers), status(400));
});

test('real resolver/validator/estimate returns literal SAFE allowlist with flags off and repeated reads have no domain writes', async () => {
  const f = fixture(), first = await f.preview();
  assert.deepEqual(Object.keys(first), keys); assert.equal(first.personalAgentId, id); assert.equal(first.code, 'own-agent');
  assert.equal(first.capability, 'text'); assert.equal(first.catalogVersion, 4); assert.equal(first.maximumEstimatedCostNanos, f.budget.estimate(f.state.catalog.models[0]).toString());
  assert.equal(first.maximumEstimatedCostNanos, '18432000'); assert.equal(first.modelExecutionConfigured, false);
  for (let i = 0; i < 3; i++) assert.deepEqual(await f.preview(), first);
  assert.equal(f.state.transactions, 4); assert.equal(f.state.checks, 4); assert.equal(f.state.resolutions, 0);
  assert.deepEqual(new Set(f.state.permissions), new Set([P.aiExecute, P.aiAssetsRead]));
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE_|SECOND_SKILL|https:|env:|upstreamModel|providerCode|credential|snapshot|instructions|skills|memory/i);
  assert.ok(f.state.sql.some(({ q }) => /FOR SHARE OF p,o/.test(q)));
  assert.ok(f.state.sql.some(({ q }) => /FOR SHARE OF u, w, m, r, g, p/.test(q)));
  assert.ok(f.state.sql.some(({ q, values }) => /scoped_config/.test(q) && /FOR SHARE/.test(q) && values.includes('ai.center.catalog')));
  assert.ok(f.state.sql.some(({ q }) => /ORDER BY b.position ASC FOR SHARE OF b,v,s/.test(q)));
});

test('configured means existing feature/protocol/host/metadata gates only, never resolves or invokes', async () => {
  const f = fixture(); f.enable(); assert.equal((await f.preview()).modelExecutionConfigured, true);
  f.state.configured = false; assert.equal((await f.preview()).modelExecutionConfigured, false);
  for (const key of ['AI_CENTER_CLIENT_EXECUTION_ENABLED', 'AI_CENTER_LIVE_ENABLED']) {
    f.state.flags[key] = 'false'; assert.equal((await f.preview()).modelExecutionConfigured, false); f.state.flags[key] = 'true';
  }
  f.state.catalog.providers[0].liveEnabled = false; assert.equal((await f.preview()).modelExecutionConfigured, false);
  assert.equal(f.state.resolutions, 0);
  f.state.catalog.providers[0].baseUrl = 'https://unapproved.invalid/v1'; await assert.rejects(f.preview(), status(409));
});

test('DeepSeek confirmation flags and compatible first-party alias retain existing protocol gates', async () => {
  const f = fixture(); f.enable(); f.state.catalog.providers[0].vendor = 'compatible'; f.state.catalog.providers[0].baseUrl = 'https://api.deepseek.com/v1';
  assert.equal((await f.preview()).modelExecutionConfigured, false);
  Object.assign(f.state.flags, { AI_DEEPSEEK_UPSTREAM_CONFIRMED: 'true', AI_DEEPSEEK_LIVE_ENABLED: 'true', AI_DEEPSEEK_DATA_CLASS: 'synthetic-or-deidentified' });
  assert.equal((await f.preview()).modelExecutionConfigured, true);
  for (const key of ['AI_DEEPSEEK_UPSTREAM_CONFIRMED', 'AI_DEEPSEEK_LIVE_ENABLED', 'AI_DEEPSEEK_DATA_CLASS']) {
    const v = f.state.flags[key]; f.state.flags[key] = 'false'; assert.equal((await f.preview()).modelExecutionConfigured, false); f.state.flags[key] = v;
  }
  f.state.catalog.models[0].tokenParameter = 'max_completion_tokens'; await assert.rejects(f.preview(), status(409));
});

test('corrupt stored configuration and foreign references fail with safe typed errors even when flags are off', async () => {
  const { ForbiddenException } = require('@nestjs/common');
  const f = fixture(); f.state.secretError = new ForbiddenException('Foreign reference namespace denied');
  await assert.rejects(f.preview(), e => e.getStatus() === 409 && e.message === 'Personal Agent model configuration unavailable');
  f.state.secretError = new Error('SECRET_VALUE_MUST_NOT_LEAK');
  await assert.rejects(f.preview(), e => e.getStatus() === 503 && e.message === 'Personal Agent preview unavailable');
  const corrupt = fixture(); corrupt.state.a.input_fields = corrupt.state.v.input_fields = ['__proto__'];
  await assert.rejects(corrupt.preview(), status(409));
});

test('actual lifecycle/member permission services fence both permissions before reading private assets', async () => {
  for (const key of ['activeProject', 'activeOrg', 'plugin', 'activeMember']) {
    const f = fixture(); f.state[key] = false; await assert.rejects(f.preview(), status(key === 'plugin' ? 404 : key === 'activeMember' ? 403 : 503));
    assert.equal(f.state.sql.some(({ q }) => q.includes('ai_personal_agent')), false);
  }
  for (const p of [P.aiExecute, P.aiAssetsRead]) { const f = fixture(); f.state.denied.add(p); await assert.rejects(f.preview(), status(403)); }
  const f = fixture(); await assert.rejects(f.preview('foreign'), status(403)); await assert.rejects(f.preview('owner', 'foreign'), status(403));
});

test('owned active current Agent and exact model/catalog/ordered own Skill pins are resolved by existing owner', async () => {
  const changes = [
    [f => { f.state.a = null; }, 404], [f => { f.state.a.enabled = false; }, 404], [f => { f.state.a.revision++; }, 409],
    [f => { f.state.v.instructions = 'tampered'; }, 409], [f => { f.state.version++; }, 409],
    [f => { f.state.skills.pop(); }, 404], [f => { f.state.skills.reverse(); }, 404],
    [f => { f.state.skills[0].position = 4; }, 404],
    [f => { f.state.catalog.models[0].revision++; }, 409],
    [f => { f.state.catalog.models[0].enabled = false; f.state.catalog.agents[0].published = false; }, 409],
    [f => { f.state.catalog.providers[0].enabled = false; f.state.catalog.agents[0].published = false; }, 409]
  ];
  for (const [change, code] of changes) { const f = fixture(); change(f); await assert.rejects(f.preview(), status(code)); assert.equal(f.state.checks, 0); }
  const f = fixture(); f.state.catalog.agents.push({ ...f.state.catalog.agents[0], code: 'p-' + id });
  assert.equal((await f.preview()).personalAgentId, id, 'legacy catalog code still validates without claiming private identity');
});

test('controller uses actual session/workspace, dual permission metadata, readonly Origin policy and early no-store', async () => {
  const seen = [], c = new AiPersonalAgentRunPreviewsController({ preview: (...args) => { seen.push(args); return 'ok'; } });
  const req = { client: { id: 'session-owner' }, workspaceContext: { workspaceId: 'server-space' }, headers: { origin: 'https://foreign.invalid', 'sec-fetch-site': 'cross-site' } };
  assert.equal(c.preview(req, id, { expectedRevision: '2' }, undefined), 'ok');
  assert.deepEqual(seen[0], ['session-owner', 'server-space', id, { expectedRevision: '2' }]);
  assert.throws(() => c.preview({ headers: {} }, id, {}, undefined), status(403));
  assert.throws(() => c.preview(req, id, {}, {}), status(400));
  assert.deepEqual(Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY, c.preview), [P.aiExecute, P.aiAssetsRead]);
  const headers = {}, response = { setHeader: (k, v) => { headers[k] = v; } };
  assert.equal(new PersonalAgentRunPreviewNoStoreGuard().canActivate({ switchToHttp: () => ({ getResponse: () => response }) }), true);
  assert.equal(headers['Cache-Control'], 'private, no-store');
  for (const path of ['/api/client/ai/personal-agents/' + id + '/run-preview?expectedRevision=2', '/api/client/ai/personal-agents/%ZZ/run-preview']) {
    let next = 0; personalAgentRunPreviewNoStore({ url: path }, response, () => { next++; }); assert.equal(next, 1); assert.equal(headers['Cache-Control'], 'private, no-store');
  }
  let touched = false; personalAgentRunPreviewNoStore({ url: '/api/client/ai/personal-agents-elsewhere/x' }, { setHeader: () => { touched = true; } }, () => {}); assert.equal(touched, false);
});

test('stateless SDK source works as ESM and CJS with no body, rejects bad identity/revision and preserves typed transport failure', async () => {
  const path = resolve('packages/sdk/src/personal-agent-run-previews.ts'), source = readFileSync(path, 'utf8');
  for (const module of [ts.ModuleKind.ES2022, ts.ModuleKind.CommonJS]) {
    const code = ts.transpileModule(source, { compilerOptions: { module, target: ts.ScriptTarget.ES2022 } }).outputText;
    let exported;
    if (module === ts.ModuleKind.ES2022) exported = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    else { const m = { exports: {} }; new Function('exports', 'module', code)(m.exports, m); exported = m.exports; }
    const calls = [], client = exported.createPersonalAgentRunPreviewsClient(async (...args) => { calls.push(args); return { personalAgentId: id }; });
    await client.preview('space1', id, 2); await client.preview('space2', id, 3);
    assert.deepEqual(calls[0], ['/client/ai/personal-agents/' + id + '/run-preview?expectedRevision=2', { method: 'GET', workspaceId: 'space1' }]);
    assert.equal(calls[1][1].workspaceId, 'space2');
    for (const args of [['', id, 2], ['space', 'p-' + id, 2], ['space', id, 0], ['space', id, '2']]) assert.throws(() => client.preview(...args), TypeError);
    const error = Object.assign(new Error('transport'), { status: 409 });
    await assert.rejects(exported.createPersonalAgentRunPreviewsClient(async () => { throw error; }).preview('space', id, 2), e => e === error);
  }
});

test('SDK source has strict request/response types including text-only capability and readonly fields', () => {
  const folder = resolve('.artifacts/AF165/types'); mkdirSync(folder, { recursive: true });
  const path = resolve(folder, 'consumer.mts');
  writeFileSync(path, `import { createPersonalAgentRunPreviewsClient, type PersonalAgentRunPreview } from '../../../packages/sdk/src/personal-agent-run-previews.js';
    const c = createPersonalAgentRunPreviewsClient(async <T,>() => ({} as T));
    const value: Promise<PersonalAgentRunPreview> = c.preview('space', '${id}', 1); void value;
    // @ts-expect-error string revisions are forbidden
    c.preview('space', '${id}', '1');
    // @ts-expect-error no body argument
    c.preview('space', '${id}', 1, { input: {} });
    function response(r: PersonalAgentRunPreview) {
      const text: 'text' = r.capability; const nanos: string = r.maximumEstimatedCostNanos; void text; void nanos;
      // @ts-expect-error response cannot expose credentials
      r.credentialRef;
      // @ts-expect-error response fields are readonly
      r.modelExecutionConfigured = true;
    } void response;
  `);
  try {
    const program = ts.createProgram([path], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true, noEmit: true, types: [],
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] });
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
  } finally { rmSync(path); }
});


test('same error owner preserves private cache policy and retains ordinary no-store errors', () => {
  const { AuthExceptionFilter } = load('auth/auth-exception.filter');
  const { BadRequestException } = require('@nestjs/common');
  for (const [header, expected] of [[undefined, 'no-store'], ['public, max-age=600', 'no-store'], ['private, no-store', 'private, no-store'], ['PRIVATE, max-age=600', 'private, no-store']]) {
    let cache, body, status;
    const response = { getHeader: () => header };
    const filter = new AuthExceptionFilter({ httpAdapter: {
      setHeader: (actual, key, value) => { assert.equal(actual, response); assert.equal(key, 'Cache-Control'); cache = value; },
      reply: (actual, value, code) => { assert.equal(actual, response); body = value; status = code; }
    } });
    filter.catch(new BadRequestException('private sentinel must not leak'), { switchToHttp: () => ({ getRequest: () => ({ url: '/api/client/ai/personal-agents/id/run-preview' }), getResponse: () => response }) });
    assert.equal(cache, expected); assert.equal(status, 400); assert.deepEqual(body, { success: false, data: null, message: 'Invalid request' });
  }
});

test('body-parser size errors retain 413 while unrelated errors stay generic 503', () => {
  const { AuthExceptionFilter } = load('auth/auth-exception.filter');
  for (const [error, expected] of [[Object.assign(new Error('body omitted'), { type: 'entity.too.large', status: 413 }), 413], [Object.assign(new Error('generic'), { status: 413 }), 503], [Object.assign(new Error('generic'), { type: 'entity.too.large', status: 500 }), 503]]) {
    let actual;
    const filter = new AuthExceptionFilter({ httpAdapter: { setHeader: () => {}, reply: (_response, value, code) => { actual = { value, code }; } } });
    filter.catch(error, { switchToHttp: () => ({ getRequest: () => ({ url: '/api/client/ai/personal-agents/id/run-preview' }), getResponse: () => ({}) }) });
    assert.equal(actual.code, expected); assert.deepEqual(actual.value, { success: false, data: null, message: expected === 413 ? 'Invalid request' : 'Service unavailable' });
  }
});
