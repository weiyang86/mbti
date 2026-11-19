import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import ts from 'typescript';

// Small collaborators prove the actual boundary code, not PG/HTTP/provider acceptance.
const require = createRequire(resolve('apps/api/package.json'));
require('ts-node').register({ project: resolve('apps/api/tsconfig.json'), transpileOnly: true });
require('reflect-metadata');
const controller = require(resolve('apps/api/src/plugins/aij-ai/ai-personal-workflow-execution.controller.ts'));
const dto = require(resolve('apps/api/src/plugins/aij-ai/ai-personal-workflow-execution.dto.ts'));
const { CLIENT_WORKSPACE_PERMISSIONS_KEY } = require(resolve('apps/api/src/client-workspaces/client-workspace-permission.decorator.ts'));
const source = resolve('packages/sdk/src/personal-workflow-execution.ts');
mkdirSync(resolve('.artifacts'), { recursive: true });
const temp = mkdtempSync(resolve('.artifacts/af207-'));
const sdk = [];
for (const [module, suffix] of [[ts.ModuleKind.ES2022, 'mjs'], [ts.ModuleKind.CommonJS, 'cjs']]) {
  const output = ts.transpileModule(readFileSync(source, 'utf8'), { fileName: source, compilerOptions: { module, target: ts.ScriptTarget.ES2022, strict: true }, reportDiagnostics: true });
  assert.equal(output.diagnostics.length, 0);
  const path = resolve(temp, 'sdk.' + suffix); writeFileSync(path, output.outputText);
  sdk.push([suffix, suffix === 'mjs' ? await import(pathToFileURL(path)) : require(path)]);
}
const publicationId = '31c46c8a-38e4-493b-82cc-e4f69de26be0';
const origin = { id: publicationId, workflowId: 'workflow', workflowVersionId: 'wf-version', revision: 2, graphDigest: 'a'.repeat(64), publicationEpoch: 3,
  nodeId: 'agent-node', agentId: 'agent-id', agentVersionId: 'agent-version', agentRevision: 4, agentPublicationEpoch: 5 };
const published = () => ({ workflowId: 'workflow', revision: 2, publishedRevision: 2, publicationEpoch: 3, publication: { ...origin }, dependencyReadiness: { ready: true, reason: 'ready' } });
const unpublished = () => ({ workflowId: 'workflow', revision: 2, publishedRevision: null, publicationEpoch: 4, publication: null, dependencyReadiness: { ready: false, reason: 'not_published' } });
const run = () => ({ origin: { ...origin }, run: { id: 'run-id', agentCode: 'personal:agent-id', status: 'unknown', budgetStatus: 'reserved',
  output: null, failureCode: 'transport_failed', estimatedCostNanos: '123', imageAssetId: null, createdAt: '2026-11-07T00:00:00.000Z', expiresAt: '2026-11-08T00:00:00.000Z' } });
const recovery = () => { const r = run().run; return { origin: { ...origin }, request: { id: r.id, agentCode: r.agentCode, status: r.status, budgetStatus: r.budgetStatus, createdAt: r.createdAt, expiresAt: r.expiresAt, contentAvailable: true } }; };
const preview = () => ({ publication: { ...origin }, inputFields: ['question'], maximumEstimatedCostNanos: '1000', modelExecutionConfigured: false });
const input = () => ({ publicationId, input: { question: 'private input sentinel' }, idempotencyKey: 'explicit-key' });
const mutation = { expectedRevision: 2, expectedPublicationEpoch: 2 };
const status = n => e => e.getStatus?.() === n;

for (const [kind, { createPersonalWorkflowExecutionClient: create }] of sdk) {
  test(kind + ': all seven methods issue exactly one scoped original transport request, preserving unknown/configured=false', async () => {
    const calls = []; let response;
    const client = create(async (path, options) => { calls.push({ path, options }); return response; });
    assert.deepEqual(Object.keys(client).sort(), ['publication', 'publish', 'unpublish', 'preview', 'submit', 'recover', 'read'].sort());
    const signal = new AbortController().signal;
    response = published(); assert.deepEqual(await client.publication('space', 'workflow', { signal }), response);
    response = published(); await client.publish('space', { workflowId: 'workflow', ...mutation });
    response = unpublished(); await client.unpublish('space', 'workflow', { expectedRevision: 2, expectedPublicationEpoch: 3 });
    response = preview(); assert.equal((await client.preview('space', publicationId)).modelExecutionConfigured, false);
    response = run(); assert.equal((await client.submit('space', input())).run.status, 'unknown');
    response = recovery(); await client.recover('space', 'explicit-key');
    response = run(); await client.read('space', 'run-id');
    assert.equal(calls.length, 7); assert.equal(calls[0].options.signal, signal);
    assert.deepEqual(calls.map(c => c.options.method), ['GET', 'POST', 'POST', 'GET', 'POST', 'GET', 'GET']);
    assert.deepEqual(calls.map(c => c.path), ['/publications/workflow', '/publications', '/publications/workflow/unpublish', '/capability?publicationId=' + publicationId, '/runs', '/requests/explicit-key', '/runs/run-id'].map(p => '/client/workflow-executions' + p));
    for (const c of calls) { assert.equal(c.options.workspaceId, 'space'); assert.ok(!c.path.includes('sentinel')); }
    assert.deepEqual(JSON.parse(calls[4].options.body), input());
  });
  test(kind + ': invalid request data/accessors/prototypes/epochs never invoke transport', () => {
    let calls = 0; const c = create(async () => { calls++; });
    for (const value of [0, -1, NaN, Infinity, 2147483648, '2']) assert.throws(() => c.publish('space', { workflowId: 'workflow', ...mutation, expectedRevision: value }), TypeError);
    for (const value of [-1, NaN, Infinity, 2147483648, '0']) assert.throws(() => c.unpublish('space', 'workflow', { expectedRevision: 2, expectedPublicationEpoch: value }), TypeError);
    for (const patch of [b => b.actor = 'fake', b => b.claims = {}, b => b.snapshot = {}, b => b.publicationId = '../bad', b => b.input.question = '', b => b.input.question = 'x'.repeat(2001),
      b => b.input = Object.create({ question: 'inherited' }), b => b.input = { constructor: 'x' }, b => b.input = Object.fromEntries(Array.from({ length: 21 }, (_, i) => ['a' + i, 'x'])),
      b => Object.defineProperty(b, 'publicationId', { get() { return assert.fail('getter executed'); } }), b => b.input.question = Infinity, b => b.idempotencyKey = 'tiny']) {
      const b = input(); patch(b); assert.throws(() => c.submit('space', b), TypeError);
    }
    assert.throws(() => c.preview('space', publicationId, { headers: {} }), TypeError);
    assert.throws(() => c.read('constructor', 'run-id'), TypeError);
    assert.throws(() => c.recover('space', '../key'), TypeError); assert.equal(calls, 0);
  });
  test(kind + ': strict output shape, origin identities, ISO/decimal/counter/status and unknown extension refusal', async () => {
    let response, calls = 0; const c = create(async () => { calls++; return response; });
    const failures = [r => r.run.id = 'other', r => r.run.agentCode = 'personal:other', r => r.run.status = 'completed', r => r.run.budgetStatus = 'refunded',
      r => r.origin.agentPublicationEpoch = 0, r => r.origin.publicationEpoch = 2147483648, r => r.origin.graphDigest = 'A'.repeat(64), r => r.origin.sessionId = 'hidden',
      r => r.run.createdAt = '2026-02-30T00:00:00.000Z', r => r.run.expiresAt = r.run.createdAt, r => r.run.estimatedCostNanos = '1e3', r => r.run.estimatedCostNanos = '-1',
      r => r.run.estimatedCostNanos = '01', r => r.run.output = { x: Infinity }, r => r.run.output = new Date(), r => r.run.unknown = true,
      r => Object.defineProperty(r.origin, 'id', { get() { return assert.fail('response getter'); } })];
    for (const patch of failures) { response = run(); patch(response); await assert.rejects(c.read('space', 'run-id'), TypeError); }
    response = run(); response.origin.id = '41c46c8a-38e4-493b-82cc-e4f69de26be0'; await assert.rejects(c.submit('space', input()), TypeError);
    for (const patch of [r => r.workflowId = 'other', r => r.publication.publicationEpoch = 4, r => r.publication.revision = 1, r => r.dependencyReadiness.ready = false, r => r.revision = 1]) {
      response = published(); patch(response); await assert.rejects(c.publication('space', 'workflow'), TypeError);
    }
    response = published(); response.revision = 3; response.dependencyReadiness = { ready: false, reason: 'revision_changed' }; await c.publication('space', 'workflow');
    response = preview(); response.inputFields = ['x', 'x']; await assert.rejects(c.preview('space', publicationId), TypeError);
    response = recovery(); response.request.contentAvailable = 'yes'; await assert.rejects(c.recover('space', 'explicit-key'), TypeError);
    assert.equal(calls, failures.length + 9);
  });
  test(kind + ': malformed success/network/5xx never cause implicit retry; recovery uses only original explicit key', async () => {
    const calls = []; let mode = 'network';
    const c = create(async (path, options) => { calls.push({ path, options }); if (mode === 'network') throw new Error('network'); if (mode === '503') throw Object.assign(new Error('failed'), { status: 503 }); if (mode === 'malformed') return { success: true }; return recovery(); });
    for (mode of ['network', '503', 'malformed']) { const count = calls.length; await assert.rejects(c.submit('space', input())); assert.equal(calls.length, count + 1); }
    mode = 'read'; await c.recover('space', 'explicit-key');
    assert.equal(calls.length, 4); assert.equal(calls[3].options.method, 'GET'); assert.equal(calls[3].options.body, undefined); assert.equal(calls[3].path, '/client/workflow-executions/requests/explicit-key');
  });
}

test('DTO strict shape and input provenance limits match original input owner, including max counters', () => {
  assert.deepEqual(dto.executionSubmit(input()), input()); assert.deepEqual(dto.executionMutation({ expectedRevision: 2147483647, expectedPublicationEpoch: 0 }), { expectedRevision: 2147483647, expectedPublicationEpoch: 0 });
  for (const value of [undefined, null, [], { ...input(), session: {} }, { ...input(), actor: 'fake' }, { ...input(), input: { question: NaN } }]) assert.throws(() => dto.executionSubmit(value), status(400));
  for (const value of [Infinity, 2147483648, -1, '0']) assert.throws(() => dto.executionMutation({ expectedRevision: 1, expectedPublicationEpoch: value }), status(400));
  let invoked = false; const b = input(); Object.defineProperty(b, 'input', { get() { invoked = true; return {}; } }); assert.throws(() => dto.executionSubmit(b), status(400)); assert.equal(invoked, false);
  for (const b of [{}, null, '', []]) assert.throws(() => dto.executionNoBody(b, {}), status(400));
  for (const h of [{ 'transfer-encoding': 'chunked' }, { 'content-length': '2' }]) assert.throws(() => dto.executionNoBody(undefined, h), status(400));
});

test('actual controller forwards only current guarded claims/member/scope and original transactional session gate', async () => {
  const calls = [], tx = {}, claims = Object.freeze({ sub: 'member', sessionId: 'session', tokenVersion: 7 }); let expired = false;
  const auth = { async assertSessionInTransaction(t, c) { assert.equal(t, tx); assert.equal(c, claims); if (expired) throw Object.assign(new Error(), { getStatus: () => 401 }); } };
  const pubs = Object.fromEntries(['read', 'publish', 'unpublish'].map(method => [method, async (...args) => { calls.push([method, ...args]); await args.at(-1)(tx); return published(); }]));
  const runs = Object.fromEntries(['preview', 'submit', 'read', 'recover'].map(method => [method, async (...args) => { calls.push([method, ...args]); return run(); }]));
  const c = new controller.AiPersonalWorkflowExecutionController(pubs, runs, { getOrThrow: () => 'https://web.test', get: () => 'true' }, auth);
  const r = { client: { id: 'member' }, clientClaims: claims, workspaceContext: { workspaceId: 'space' }, headers: { origin: 'https://web.test' }, correlationId: 'correlation' };
  await c.publication(r, 'workflow', {}); await c.publish(r, { workflowId: 'workflow', ...mutation }, {}); await c.unpublish(r, 'workflow', mutation, {});
  await c.preview(r, { publicationId }); await c.submit(r, input(), {}); await c.recover(r, 'explicit-key', {}); await c.read(r, 'run-id', {});
  assert.equal(calls.length, 7); for (const call of calls) { assert.equal(call[1], 'member'); assert.equal(call[2], 'space'); }
  for (const call of calls.slice(3)) assert.equal(call[4], claims); assert.equal(calls[4][5], 'correlation');
  assert.throws(() => c.submit({ ...r, client: { id: 'attacker' } }, input(), {}), status(401));
  assert.throws(() => c.read({ ...r, clientClaims: undefined }, 'run-id', {}), status(401));
  assert.throws(() => c.submit({ ...r, headers: { origin: 'https://evil.test' } }, input(), {}), status(403));
  assert.throws(() => c.submit({ ...r, headers: { origin: 'https://web.test', 'sec-fetch-site': 'cross-site' } }, input(), {}), status(403));
  assert.throws(() => c.read(r, 'run-id', { actor: 'fake' }), status(400));
  const disabled = new controller.AiPersonalWorkflowExecutionController(pubs, runs, { getOrThrow: () => 'https://web.test', get: () => 'false' }, auth);
  assert.throws(() => disabled.submit(r, input(), {}), status(503));
  expired = true; await assert.rejects(c.publication(r, 'workflow', {}), status(401));
  const expected = { publication: ['workspace.ai.assets.read'], publish: ['workspace.ai.assets.manage', 'workspace.ai.workflows.publish'], unpublish: ['workspace.ai.assets.manage', 'workspace.ai.workflows.publish'],
    preview: ['workspace.ai.assets.read', 'workspace.ai.execute', 'workspace.ai.workflows.execute'], submit: ['workspace.ai.assets.read', 'workspace.ai.execute', 'workspace.ai.workflows.execute'],
    recover: ['workspace.ai.assets.read', 'workspace.ai.read', 'workspace.ai.workflows.execute'], read: ['workspace.ai.assets.read', 'workspace.ai.read', 'workspace.ai.workflows.execute'] };
  for (const [method, permissions] of Object.entries(expected)) assert.deepEqual(Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY, c[method]), permissions);
  for (const [method, code] of [['publish', 201], ['unpublish', 200], ['submit', 201]]) assert.equal(Reflect.getMetadata('__httpCode__', c[method]), code);
});

test('real chunked streams feed strict raw JSON hook: duplicate escaped keys, UTF8, size limits; early headers survive rejection', async () => {
  const request = { originalUrl: '/api/client/workflow-executions/runs' }, headers = new Map(), response = { setHeader: (k, v) => headers.set(k, v) };
  let next = false; controller.workflowExecutionPrivateMiddleware(request, response, () => next = true); assert.equal(next, true);
  for (const [bytes, expected] of [[Buffer.from(JSON.stringify(input())), null], [Buffer.from('{"input":{"q":"a","q":"b"}}'), 400], [Buffer.from('{"input":{},"inpu\\u0074":{}}'), 400], [Buffer.from('{"expectedRevision":1e999}'), 400], [Buffer.from([0xc3, 0x28]), 400], [Buffer.alloc(98305, 32), 413]]) {
    const chunks = []; for await (const chunk of Readable.from([bytes.subarray(0, 3), bytes.subarray(3)])) chunks.push(chunk);
    const verify = () => controller.workflowExecutionJsonVerify(request, response, Buffer.concat(chunks));
    if (expected) assert.throws(verify, status(expected)); else verify();
    assert.equal(headers.get('Cache-Control'), 'private, no-store'); assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  }
  const guard = new controller.WorkflowExecutionPrivateGuard(); assert.equal(guard.canActivate({ switchToHttp: () => ({ getResponse: () => response }) }), true);
});

test('new SDK module compiles under strict TypeScript without changing original SDK index', () => {
  const program = ts.createProgram([source], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true, skipLibCheck: true, noEmit: true, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] });
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: x => x, getNewLine: () => '\n' }));
});

test('actual original ClientApi consumes a Web stream once and applies credentials/no-store/workspace/signal', async () => {
  const { createClientApi } = await import(pathToFileURL(resolve('packages/sdk/dist/index.mjs')));
  const calls = [], originalFetch = globalThis.fetch, signal = new AbortController().signal;
  const { createSuccessEnvelope } = await import(pathToFileURL(resolve('packages/contracts/dist/index.mjs')));
  const responseData = createSuccessEnvelope(run());
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      const bytes = new TextEncoder().encode(JSON.stringify(responseData));
      return new Response(new ReadableStream({ start(c) { c.enqueue(bytes.subarray(0, 9)); c.enqueue(bytes.subarray(9)); c.close(); } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const c = sdk[0][1].createPersonalWorkflowExecutionClient(createClientApi(() => 'https://api.test/api'));
    assert.equal((await c.submit('space', input(), { signal })).run.status, 'unknown');
    assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.test/api/client/workflow-executions/runs');
    assert.equal(calls[0].options.credentials, 'include'); assert.equal(calls[0].options.cache, 'no-store'); assert.equal(calls[0].options.signal, signal);
    assert.equal(calls[0].options.headers.get('x-aij-workspace-id'), 'space'); assert.equal(calls[0].options.headers.get('content-type'), 'application/json');
  } finally { globalThis.fetch = originalFetch; }
});

test('original auth/workspace guards derive current identity before the new handler; client header never supplies actor', async () => {
  const { ClientAuthGuard } = require(resolve('apps/api/src/client-auth/client-auth.guard.ts'));
  const { WorkspaceContextGuard } = require(resolve('apps/api/src/client-workspaces/workspace-context.guard.ts'));
  const { clientIssuer, clientAudience } = require(resolve('apps/api/src/client-auth/client-auth.security.ts'));
  const now = Math.floor(Date.now() / 1000), payload = { sub: 'current-member', sessionId: 'current-session', tokenVersion: 8, tokenKind: 'client', projectId: 'project', environment: 'test',
    iss: clientIssuer('issuer'), aud: clientAudience('namespace'), iat: now, exp: now + 60 };
  const settings = { clientSessionCookie: 'private-client', projectId: 'project', environment: 'test', issuer: 'issuer', namespace: 'namespace' };
  const config = { getOrThrow: k => settings[k] };
  const auth = new ClientAuthGuard({ verifyAsync: async token => { assert.equal(token, 'guard.token.signature'); return payload; } }, { authenticate: async claims => { assert.deepEqual(claims, { sub: payload.sub, sessionId: payload.sessionId, tokenVersion: 8 }); return { id: payload.sub }; } }, config);
  const required = ['workspace.ai.assets.read', 'workspace.ai.read', 'workspace.ai.workflows.execute'];
  const guard = new WorkspaceContextGuard({ getAllAndOverride: () => required }, auth, { resolve: async (member, workspace, permissions) => {
    assert.equal(member, 'current-member'); assert.equal(workspace, 'space'); assert.deepEqual(permissions, required); return { workspaceId: workspace, permissions };
  } });
  const r = { headers: { cookie: 'private-client=guard.token.signature', 'x-aij-workspace-id': 'space', 'x-member-id': 'forged-member' } };
  const context = { getHandler: () => controller.AiPersonalWorkflowExecutionController.prototype.read, getClass: () => controller.AiPersonalWorkflowExecutionController, switchToHttp: () => ({ getRequest: () => r }) };
  assert.equal(await guard.canActivate(context), true); assert.equal(r.client.id, 'current-member'); assert.equal(r.clientClaims.sessionId, 'current-session');
  payload.projectId = 'other-product'; await assert.rejects(guard.canActivate(context), status(401));
});

test('new controller/DTO compile with strict API decorator and generated-schema types', () => {
  const roots = ['apps/api/src/plugins/aij-ai/ai-personal-workflow-execution.controller.ts', 'apps/api/src/plugins/aij-ai/ai-personal-workflow-execution.dto.ts'];
  const p = ts.createProgram(roots, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: true, noEmit: true, skipLibCheck: true, experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true, types: ['node'], typeRoots: [resolve('node_modules/@types')] });
  const errors = ts.getPreEmitDiagnostics(p).filter(d => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => process.cwd(), getCanonicalFileName: x => x, getNewLine: () => '\n' }));
});
