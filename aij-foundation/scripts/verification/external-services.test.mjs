import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
const require = createRequire(resolve('apps/api/package.json'));
require('reflect-metadata');
const ts = require('typescript');
// Compile real source classes to CommonJS in memory; no API build, database or source rewriting.
const prior = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => { const result = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true }, fileName: filename, reportDiagnostics: true }); assert.equal(result.diagnostics?.length ?? 0, 0); module._compile(result.outputText, filename); };
const load = p => require(resolve('apps/api/src/' + p + '.ts'));
const { ExternalServicesService } = load('configuration/external-services.service');
const { ExternalServicesController } = load('configuration/external-services.controller');
const { SaveExternalServiceDto, ExternalServicesBodyPipe, validateProviderDraft } = load('configuration/external-services.dto');
const { EXTERNAL_SERVICE_CATALOG } = load('configuration/external-services.catalog');
if (prior)
    require.extensions['.ts'] = prior;
else
    delete require.extensions['.ts'];
const sdkCode = ts.transpileModule(readFileSync('packages/sdk/src/external-services.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const sdk = await import('data:text/javascript;base64,' + Buffer.from(sdkCode).toString('base64'));
const { ConfigService } = require('@nestjs/config');
const { validate } = require('class-validator');
const ref = 'env://AIJ_SECRET_AIJ_FOUNDATION_TEST_API_KEY';
function fixture() {
    let row = null, allowed = true, active = true, auditFailure = false, secretAllowed = true;
    const audit = [], changes = [], permissions = [];
    let resolves = 0;
    const tx = { projectProfile: { findFirst: async () => ({ id: 'project-server', environment: 'test', status: active ? 'active' : 'disabled', organization: { status: 'active' } }) }, scopedConfig: { findUnique: async ({ where }) => where.id ? row : where.scope_scopeId_pluginCode_configKey.configKey === row?.configKey ? row : null, create: async ({ data }) => row = { ...data, id: 'config-id', version: 1, deletedAt: null }, updateMany: async ({ where, data }) => { if (row.version !== where.version)
                return { count: 0 }; row = { ...row, ...data, version: row.version + 1 }; return { count: 1 }; } }, configurationChange: { create: async ({ data }) => changes.push(data) } };
    let tail = Promise.resolve();
    const access = { write: (actor, required, fn) => { const next = tail.then(async () => { permissions.push(required); if (!allowed || required.includes('admin.secret.manage') && !secretAllowed)
            throw new (require('@nestjs/common').ForbiddenException)(); const snapshot = structuredClone(row), n = audit.length, c = changes.length; try {
            return await fn(tx, { id: actor });
        }
        catch (e) {
            row = snapshot;
            audit.length = n;
            changes.length = c;
            throw e;
        } }); tail = next.catch(() => { }); return next; }, audit: async (...args) => { if (auditFailure)
            throw new Error('audit failure'); audit.push(args.slice(2)); return { id: 'audit-id' }; } };
    const runtime = new ConfigService({ projectId: 'aij-foundation', environment: 'test', namespace: 'aij_foundation_test', repositoryRoot: process.cwd() });
    const secrets = { configuredTrusted: async (_tx, r) => r === ref, resolveTrusted: () => { resolves++; throw new Error('never resolve'); } };
    const service = new ExternalServicesService({}, access, runtime, secrets);
    return { service, access, runtime, secrets, audit, changes, permissions, tx, get row() { return row; }, get resolves() { return resolves; }, deny: () => allowed = false, disable: () => active = false, failAudit: () => auditFailure = true, denySecret: () => secretAllowed = false };
}
const empty = { expectedVersion: 0, fields: {} };
test('14 frozen catalog schemas and SDK strict parser agree; no defaults or runtime promises', () => { assert.equal(EXTERNAL_SERVICE_CATALOG.providers.length, 14); assert.ok(Object.isFrozen(EXTERNAL_SERVICE_CATALOG.providers[0].fields)); assert.deepEqual(sdk.parseExternalServiceCatalog(EXTERNAL_SERVICE_CATALOG), EXTERNAL_SERVICE_CATALOG); });
test('strict DTO class, raw body pipe and provider whitelist reject malicious shapes without echo', async () => {
    const pipe = new ExternalServicesBodyPipe();
    assert.deepEqual(pipe.transform(empty), empty);
    assert.equal((await validate(Object.assign(new SaveExternalServiceDto(), empty))).length, 0);
    for (const raw of [{ ...empty, projectId: 'foreign' }, { ...empty, rawSecret: 'SENSITIVE' }, { ...empty, credentialRefs: null }, { ...empty, expectedVersion: '0' }, { ...empty, fields: [] }, { ...empty, fields: { model: 'x\nSENSITIVE' } }, JSON.parse('{"expectedVersion":0,"fields":{"__proto__":"SENSITIVE"}}')])
        assert.throws(() => pipe.transform(raw), e => !e.message.includes('SENSITIVE'));
    assert.throws(() => pipe.transform({ ...empty, fields: Object.fromEntries(Array.from({ length: 16 }, (_, i) => ['field' + i, '界'.repeat(512)])) }));
    for (const fields of [{ rawSecret: 'SENSITIVE' }, { baseUrl: 'http://api.example.com' }, { baseUrl: 'https://name:pass@api.example.com' }, { baseUrl: 'https://api.example.com?key=SENSITIVE' }, { baseUrl: 'javascript:alert(1)' }, { model: '界'.repeat(513) }])
        assert.throws(() => validateProviderDraft('deepseek', { ...empty, fields }));
    for (const value of [null, [], { x: 3 }, JSON.parse('{"constructor":"SENSITIVE"}')])
        assert.ok((await validate(Object.assign(new SaveExternalServiceDto(), { ...empty, fields: value }))).length);
});
test('empty draft persists disabled/private and safe reads redact all references and audit values', async () => { const f = fixture(); const v0 = await f.service.get('deepseek', 'admin'); assert.equal(v0.version, 0); const v = await f.service.save('deepseek', empty, 'admin'); assert.equal(v.version, 1); assert.equal(v.configurationStatus, 'draft'); assert.equal(f.row.status, 'disabled'); assert.equal(f.row.sensitive, true); assert.equal(f.row.scopeId, 'project-server'); assert.equal(f.changes.length, 1); assert.equal(f.audit.length, 1); assert.equal((await f.service.list('admin')).items.length, 14); assert.equal(f.resolves, 0); });
test('fresh read permissions and server project state fail closed', async () => { for (const op of ['catalog', 'list', 'get']) {
    const f = fixture();
    f.deny();
    await assert.rejects(op === 'get' ? f.service.get('deepseek', 'admin') : f.service[op]('admin'));
} const f = fixture(); f.disable(); await assert.rejects(f.service.save('deepseek', empty, 'admin')); assert.equal(f.row, null); });
test('owned reference check, omitted preserve, explicit clear, fresh readiness and no secret resolution', async () => {
    const f = fixture(), fields = { model: 'synthetic', baseUrl: 'https://model.example.com' };
    const v = await f.service.save('deepseek', { ...empty, fields, credentialRefs: { apiKey: ref } }, 'admin');
    assert.equal(v.configurationStatus, 'credentials_ready');
    assert.equal(v.credentialStates.apiKey, true);
    assert.doesNotMatch(JSON.stringify(v), /AIJ_SECRET|credentialRefs/);
    assert.doesNotMatch(JSON.stringify(f.audit) + JSON.stringify(f.changes), /AIJ_SECRET|model.example/);
    assert.equal((await f.service.save('deepseek', { expectedVersion: 1, fields }, 'admin')).version, 1);
    const v2 = await f.service.save('deepseek', { expectedVersion: 1, fields, credentialRefs: { apiKey: null } }, 'admin');
    assert.equal(v2.credentialStates.apiKey, false);
    assert.equal(v2.configurationStatus, 'draft');
    assert.equal(f.resolves, 0);
    for (const bad of ['raw-SENSITIVE', 'env://AIJ_SECRET_FOREIGN_TEST_API_KEY', 'env://AIJ_SECRET_AIJ_FOUNDATION_TEST_MISSING']) {
        const g = fixture();
        await assert.rejects(g.service.save('deepseek', { ...empty, credentialRefs: { apiKey: bad } }, 'admin'));
        assert.equal(g.row, null);
    }
    const g = fixture();
    g.denySecret();
    await assert.rejects(g.service.save('deepseek', { ...empty, credentialRefs: { apiKey: null } }, 'admin'));
});
test('CAS competition has one winner and audit failure rolls back config and change', async () => { const f = fixture(); const results = await Promise.allSettled([f.service.save('deepseek', empty, 'admin'), f.service.save('deepseek', empty, 'admin')]); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.getStatus(), 409); const g = fixture(); g.failAudit(); await assert.rejects(g.service.save('deepseek', empty, 'admin')); assert.equal(g.row, null); assert.equal(g.changes.length, 0); });
test('SDK explicit methods validate strict response and DTO; no retry on 409 or unknown outcome', async () => { const f = fixture(), calls = [], signal = new AbortController().signal; const api = sdk.createExternalServicesApi(async (path, opts) => { calls.push({ path, opts }); if (path.endsWith('/catalog'))
    return EXTERNAL_SERVICE_CATALOG; if (path === '/admin/external-services')
    return f.service.list('admin'); return opts.method === 'PUT' ? f.service.save(path.split('/').at(-1), JSON.parse(opts.body), 'admin') : f.service.get(path.split('/').at(-1), 'admin'); }); await api.catalog(signal); await api.list(signal); await api.get('deepseek', signal); await api.save('deepseek', empty, signal); assert.equal(calls.length, 4); assert.ok(calls.every(c => c.opts.signal === signal && c.opts.cache === 'no-store')); for (const dto of [{ ...empty, rawSecret: 'SENSITIVE' }, { ...empty, credentialRefs: { apiKey: 'SENSITIVE' } }, { ...empty, credentialRefs: null }])
    await assert.rejects(api.save('deepseek', dto), e => e.status === 400); assert.equal(calls.length, 4); await assert.rejects(api.save('foreign', empty)); let count = 0; const broken = sdk.createExternalServicesApi(async () => { count++; throw Object.assign(new Error('conflict'), { status: 409 }); }); await assert.rejects(broken.save('deepseek', empty)); assert.equal(count, 1); const bad = sdk.createExternalServicesApi(async () => ({ ...await f.service.get('deepseek', 'admin'), credentialRefs: { apiKey: ref } })); await assert.rejects(bad.get('deepseek')); });
test('actual compiled controller runs in bounded Nest HTTP module and closes all sockets', async () => { const f = fixture(), { Module } = require('@nestjs/common'), { NestFactory } = require('@nestjs/core'); class Host {
} Module({ controllers: [ExternalServicesController], providers: [{ provide: ExternalServicesService, useValue: f.service }] })(Host); const app = await NestFactory.create(Host, { logger: false }); app.use((req, _res, next) => { req.user = { id: 'admin' }; next(); }); app.setGlobalPrefix('api'); app.useGlobalPipes(new (require('@nestjs/common').ValidationPipe)({ whitelist: true, transform: true })); await app.listen(0, '127.0.0.1'); try {
    const base = await app.getUrl();
    let r = await fetch(base + '/api/admin/external-services/deepseek', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(empty) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).version, 1);
    r = await fetch(base + '/api/admin/external-services/deepseek', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...empty, projectId: 'forged' }) });
    assert.equal(r.status, 400);
    r = await fetch(base + '/api/admin/external-services/catalog');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal((await r.json()).providers.length, 14);
}
finally {
    app.getHttpServer().closeAllConnections();
    await app.close();
} });
test('targeted API and SDK compiler diagnostics are empty (no heavy application build)', () => {
    const config = ts.readConfigFile('apps/api/tsconfig.json', ts.sys.readFile);
    const apiOptions = ts.parseJsonConfigFileContent(config.config, ts.sys, 'apps/api').options;
    const apiProgram = ts.createProgram(['catalog', 'dto', 'controller', 'service'].map(v => 'apps/api/src/configuration/external-services.' + v + '.ts'), { ...apiOptions, noEmit: true });
    const sdkProgram = ts.createProgram(['packages/sdk/src/external-services.ts'], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, skipLibCheck: true, noEmit: true, types: [], lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] });
    const diagnostics = [...ts.getPreEmitDiagnostics(apiProgram), ...ts.getPreEmitDiagnostics(sdkProgram)];
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: v => v, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
});
