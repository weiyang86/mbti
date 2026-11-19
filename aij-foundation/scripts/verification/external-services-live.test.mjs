// ROOT ONLY. Does not create/adopt/reset a database or migrate/seed it.
// Root supplies an AF-193 protected freshly migrated acceptance lease; missing opt-in/module/lease is FAIL.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { resolve, join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import test from 'node:test';
import { acceptanceRecord, repositoryRoot, checkDatabase, readDatabaseEnvironment, withDatabase } from '../database/connection.mjs';
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
test('AF193 root actual application HTTP and fresh protected PG draft acceptance', { timeout: 60000 }, async () => {
    assert.equal(process.env.AIJ_AF193_ROOT_ACCEPTANCE, 'true', 'Root explicit opt-in required');
    assert.equal(resolve(process.cwd()), root);
    assert.equal(resolve(repositoryRoot), root);
    assert.equal(execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(), 'dev');
    const gitPath = flag => resolve(execFileSync('git', ['rev-parse', flag], { encoding: 'utf8' }).trim());
    assert.equal(gitPath('--git-dir'), gitPath('--git-common-dir'));
    const leaseId = process.env.DATABASE_ACCEPTANCE_ID;
    assert.ok(leaseId, 'Root must supply a fresh AF-193 acceptance lease');
    const lease = acceptanceRecord('test', leaseId);
    assert.equal(lease.task, 'AF-193');
    await checkDatabase('test', readDatabaseEnvironment('test', process.env, leaseId), { acceptanceId: leaseId });
    const require = createRequire(join(root, 'apps/api/package.json'));
    require('reflect-metadata');
    const load = p => require(join(root, 'apps/api/dist', p + '.js'));
    // Load first: missing compiled/wired module is never a skip or a substitute host.
    const { ExternalServicesService } = load('configuration/external-services.service');
    const { ExternalServicesController } = load('configuration/external-services.controller');
    const publicSdk = createRequire(join(root, 'apps/web/package.json'))('@aij/sdk');
    assert.equal(typeof publicSdk.createExternalServicesApi, 'function', 'Root must export/build the real public SDK');
    const { PrismaService } = load('prisma/prisma.service');
    const original = { ...process.env }, originalFetch = globalThis.fetch, originalHttp = http.request, originalHttps = https.request;
    const setEnv = v => { for (const k of Object.keys(process.env))
        delete process.env[k]; Object.assign(process.env, v); };
    const synthetic = randomBytes(32).toString('hex');
    setEnv({ PATH: original.PATH, HOME: original.HOME, TMPDIR: original.TMPDIR, RUNTIME_PROFILE: 'host', PROJECT_ID: 'aij-foundation', APP_ENV: 'test', NODE_ENV: 'test', DATABASE_ACCEPTANCE_ID: leaseId,
        AUTH_ENABLED: 'true', CLIENT_AUTH_ENABLED: 'false', DATABASE_ENABLED: 'true', STORAGE_ENABLED: 'false', ASYNC_RUNTIME_ENABLED: 'false', ENABLED_PLUGINS: '', JWT_SECRET: randomBytes(32).toString('hex'), CLIENT_JWT_SECRET: randomBytes(32).toString('hex'), CLIENT_AUTH_RATE_LIMIT_SECRET: randomBytes(32).toString('hex'), CLIENT_AUTH_TOKEN_SECRET: randomBytes(32).toString('hex'), WEB_PORT: '3655', API_PORT: '3656', WEB_URL: 'http://localhost:3655', NEXT_PUBLIC_API_URL: 'http://localhost:3656/api', JWT_ISSUER: 'urn:aij:aij-foundation:test:api', COOKIE_PREFIX: 'aij_foundation_test', LOCAL_STORAGE_ROOT: '.local-data/aij-foundation/test/storage', AIJ_SECRET_AIJ_FOUNDATION_TEST_DRAFT_KEY: synthetic });
    let app, prisma, base, externalCalls = 0, resolves = 0, admin, reader, org, project, foreign, secret;
    const permissionIds = [];
    const ref = 'env://AIJ_SECRET_AIJ_FOUNDATION_TEST_DRAFT_KEY';
    const query = fn => withDatabase('test', readDatabaseEnvironment('test', process.env, leaseId), fn, { acceptanceId: leaseId });
    globalThis.fetch = (url, options) => { if (!base || !String(url).startsWith(base + '/')) {
        externalCalls++;
        throw new Error('External request denied');
    } return originalFetch(url, options); };
    http.request = https.request = () => { externalCalls++; throw new Error('Unexpected HTTP transport denied'); };
    syncBuiltinESMExports();
    try {
        app = await load('bootstrap').createApplication();
        assert.ok(app.get(ExternalServicesService));
        assert.ok(app.get(ExternalServicesController));
        const secretPort = app.get(load('secret-center/secret-ref').SecretRefPort);
        secretPort.resolveTrusted = secretPort.resolveTrustedForPlugin = async () => { resolves++; throw new Error('Secret resolution denied'); };
        prisma = app.get(PrismaService);
        assert.equal((await prisma.readiness()).ready, true);
        for (const model of ['sysUser', 'sysPermission', 'organizationProfile', 'projectProfile', 'scopedConfig', 'configurationChange', 'secretReference'])
            assert.equal(await prisma[model].count(), 0, 'Lease must be fresh: ' + model);
        org = await prisma.organizationProfile.create({ data: { code: 'af193-synthetic', name: 'AF193 synthetic' } });
        project = await prisma.projectProfile.create({ data: { code: 'aij-foundation-test', name: 'AF193 synthetic', organizationId: org.id, environment: 'test' } });
        foreign = await prisma.projectProfile.create({ data: { code: 'af193-foreign-test', name: 'AF193 foreign synthetic', organizationId: org.id, environment: 'test' } });
        for (const permissionCode of ['admin.config.manage', 'admin.secret.manage'])
            permissionIds.push((await prisma.sysPermission.create({ data: { permissionCode, permissionName: 'AF193 synthetic', resourceType: 'api', module: 'configuration', action: 'manage' } })).id);
        const password = 'T9-' + randomBytes(24).toString('hex'), passwordHash = await require('bcryptjs').hash(password, 12);
        admin = await prisma.sysUser.create({ data: { username: 'af193_admin', realName: 'AF193 synthetic admin', passwordHash, isSuperAdmin: true } });
        reader = await prisma.sysUser.create({ data: { username: 'af193_reader', realName: 'AF193 synthetic reader', passwordHash } });
        secret = await prisma.secretReference.create({ data: { ref, provider: 'env' } });
        await app.listen(0, '127.0.0.1');
        base = await app.getUrl();
        const send = async (path, { method = 'GET', body, cookie, csrf, token } = {}) => {
            const r = await fetch(base + '/api/' + path, { method, headers: { connection: 'close', origin: 'http://localhost:3655', 'x-aij-client': 'web', ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-aij-csrf': csrf } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
            const value = await r.json();
            assert.ok(!JSON.stringify(value).includes(synthetic));
            if (path.startsWith('admin/'))
                assert.ok(!JSON.stringify(value).includes(ref));
            return { status: r.status, data: value.data, headers: r.headers };
        };
        const login = async (username) => { const r = await send('auth/browser-login', { method: 'POST', body: { username, password } }); assert.equal(r.status, 200); const cookie = r.headers.get('set-cookie').split(';')[0]; const s = await send('auth/session', { cookie }); assert.equal(s.status, 200); return { cookie, csrf: s.data.csrfToken }; };
        const owner = await login(admin.username), ungranted = await login(reader.username), path = 'admin/external-services/deepseek', empty = { expectedVersion: 0, fields: {} };
        const put = (body, auth = owner) => send(path, { ...auth, method: 'PUT', body });
        const sdk = publicSdk.createExternalServicesApi(async (p, o) => { const r = await send(p.replace(/^\//, ''), { ...owner, method: o.method, body: o.body ? JSON.parse(o.body) : undefined }); assert.equal(r.status, 200); return r.data; });
        assert.equal((await sdk.catalog()).providers.length, 14);
        assert.equal((await sdk.list()).projectId, project.id);
        assert.equal((await sdk.get('deepseek')).version, 0);
        assert.equal((await send(path)).status, 401);
        assert.equal((await send(path, ungranted)).status, 403);
        assert.equal((await put(empty, ungranted)).status, 403);
        assert.equal((await put(empty, { cookie: owner.cookie })).status, 403);
        const { JwtService } = require('@nestjs/jwt');
        const wrongToken = await app.get(JwtService).signAsync({ sub: admin.id, tokenKind: 'admin', projectId: 'foreign', environment: 'test', sessionId: require('node:crypto').randomUUID(), tokenVersion: 0, transport: 'bearer' });
        assert.equal((await send(path, { token: wrongToken })).status, 401);
        assert.equal((await send(path, owner)).data.version, 0);
        for (const body of [{ ...empty, projectId: foreign.id }, { ...empty, scope: 'global' }, { ...empty, rawSecret: synthetic }, { ...empty, fields: { apiKey: synthetic } }, { ...empty, fields: { model: 'x\nforbidden' } }, { ...empty, fields: { baseUrl: 'https://u:p@example.test' } }, { ...empty, credentialRefs: { apiKey: synthetic } }, { ...empty, credentialRefs: { apiKey: 'env://AIJ_SECRET_FOREIGN_TEST_DRAFT_KEY' } }, JSON.parse('{"expectedVersion":0,"fields":{"__proto__":"forbidden"}}')])
            assert.equal((await put(body)).status, 400);
        assert.equal(await prisma.scopedConfig.count(), 0);
        assert.equal((await put(empty)).status, 200);
        assert.equal((await send(path, owner)).data.version, 1);
        let row = await prisma.scopedConfig.findFirstOrThrow({ where: { scopeId: project.id } });
        assert.equal(row.status, 'disabled');
        assert.equal(row.sensitive, true);
        assert.equal(row.isPublic, false);
        assert.equal(row.valueType, 'string');
        assert.equal(row.pluginCode, '');
        assert.equal(await prisma.scopedConfig.count({ where: { scopeId: foreign.id } }), 0);
        const results = await Promise.all([put({ expectedVersion: 1, fields: { model: 'synthetic-a' } }), put({ expectedVersion: 1, fields: { model: 'synthetic-b' } })]);
        assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
        row = await prisma.scopedConfig.findUniqueOrThrow({ where: { id: row.id } });
        const fields = { model: 'synthetic', baseUrl: 'https://example.test' };
        const ready = await put({ expectedVersion: row.version, fields, credentialRefs: { apiKey: ref } });
        assert.equal(ready.status, 200);
        assert.equal(ready.data.configurationStatus, 'credentials_ready');
        assert.equal(ready.data.runtimeEnabled, false);
        assert.equal(ready.data.externalVerification, 'not_run');
        await prisma.sysPermission.update({ where: { permissionCode: 'admin.secret.manage' }, data: { status: 'disabled' } });
        try {
            assert.equal((await put({ expectedVersion: ready.data.version, fields, credentialRefs: { apiKey: null } })).status, 403);
        }
        finally {
            await prisma.sysPermission.update({ where: { permissionCode: 'admin.secret.manage' }, data: { status: 'active' } });
        }
        const preserved = await put({ expectedVersion: ready.data.version, fields: { ...fields, model: 'synthetic-update' } });
        assert.equal(preserved.status, 200);
        assert.equal(preserved.data.credentialStates.apiKey, true);
        const cleared = await put({ expectedVersion: preserved.data.version, fields, credentialRefs: { apiKey: null } });
        assert.equal(cleared.status, 200);
        assert.equal(cleared.data.credentialStates.apiKey, false);
        const projected = await send('admin/scoped-configs', owner);
        assert.equal(projected.status, 200);
        assert.ok(!JSON.stringify(projected.data).includes('example.test'));
        assert.ok(!JSON.stringify(projected.data).includes(ref));
        const before = await prisma.scopedConfig.findUniqueOrThrow({ where: { id: row.id } }), changes = await prisma.configurationChange.count(), audits = await prisma.auditLog.count({ where: { module: 'configuration' } });
        await query(async (c) => { await c.query("CREATE FUNCTION public.af193_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.module = 'configuration' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$"); await c.query('CREATE TRIGGER af193_reject_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af193_reject_audit()'); });
        try {
            assert.equal((await put({ expectedVersion: before.version, fields: { model: 'must-rollback' } })).status, 503);
            assert.deepEqual(await prisma.scopedConfig.findUniqueOrThrow({ where: { id: row.id } }), before);
            assert.equal(await prisma.configurationChange.count(), changes);
            assert.equal(await prisma.auditLog.count({ where: { module: 'configuration' } }), audits);
        }
        finally {
            await query(async (c) => { await c.query('DROP TRIGGER af193_reject_audit ON public.audit_log'); await c.query('DROP FUNCTION public.af193_reject_audit()'); });
        }
        // Current DB state is checked on each read and write, not just token/UI snapshots.
        for (const [model, id] of [['projectProfile', project.id], ['organizationProfile', org.id]]) {
            await prisma[model].update({ where: { id }, data: { status: 'disabled' } });
            try {
                assert.equal((await send(path, owner)).status, 403);
                assert.equal((await put({ expectedVersion: before.version, fields: {} })).status, 403);
            }
            finally {
                await prisma[model].update({ where: { id }, data: { status: 'active' } });
            }
        }
        await prisma.sysPermission.update({ where: { permissionCode: 'admin.config.manage' }, data: { status: 'disabled' } });
        try {
            assert.equal((await send(path, owner)).status, 403);
        }
        finally {
            await prisma.sysPermission.update({ where: { permissionCode: 'admin.config.manage' }, data: { status: 'active' } });
        }
        const allAudit = await prisma.auditLog.findMany({ where: { module: 'configuration' } }), allChanges = await prisma.configurationChange.findMany();
        assert.ok(!JSON.stringify([...allAudit, ...allChanges]).includes(ref));
        assert.equal(externalCalls, 0);
        assert.equal(resolves, 0);
    }
    finally {
        try {
            // Remove only this fresh lease's synthetic rows, preserving the acceptance DB and its lease.
            if (prisma) {
                await prisma.configurationChange.deleteMany({ where: { scopeId: project?.id ?? 'never' } });
                await prisma.scopedConfig.deleteMany({ where: { scopeId: { in: [project?.id, foreign?.id].filter(Boolean) } } });
                if (secret)
                    await prisma.secretReference.delete({ where: { id: secret.id } });
                const ids = [admin?.id, reader?.id].filter(Boolean);
                await prisma.adminAuthSession.deleteMany({ where: { userId: { in: ids } } });
                await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
                await prisma.sysUser.deleteMany({ where: { id: { in: ids } } });
                await prisma.sysPermission.deleteMany({ where: { id: { in: permissionIds } } });
                await prisma.projectProfile.deleteMany({ where: { id: { in: [project?.id, foreign?.id].filter(Boolean) } } });
                if (org)
                    await prisma.organizationProfile.delete({ where: { id: org.id } });
            }
        }
        finally {
            try {
                app?.getHttpServer()?.closeAllConnections();
                await app?.close();
                if (prisma) {
                    const pools = await query(async (c) => (await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows[0].n);
                    assert.equal(pools, 0);
                }
            }
            finally {
                globalThis.fetch = originalFetch;
                http.request = originalHttp;
                https.request = originalHttps;
                syncBuiltinESMExports();
                setEnv(original);
            }
        }
    }
});
