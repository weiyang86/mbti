import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
test('AF211 real HTTP/private parsers and outside installed SDK private script execution', { timeout: 600000 }, async t => {
  assert.equal(process.env.AIJ_AF211_ROOT_ACCEPTANCE, 'true');
  const consumer = realpathSync(process.env.AIJ_AF211_PACKED_CONSUMER); assert.match(consumer, /^\/private\/tmp\/aij-af211-packed-[A-Za-z0-9]+$/);
  const esm = await import(pathToFileURL(join(consumer, 'entry.mjs')).href), cjs = createRequire(join(consumer, 'package.json'))('@aij/sdk');
  const receipt = JSON.parse(readFileSync('.artifacts/auto-ai-program-20261105/AF-175/image-receipt.json'));
  const f = await createRemainingClientFixture('AF-211', { workbenchTargetSafety: true, storageEnabled: true,
    scriptSandbox: { dockerCliPath: receipt.cli, approvedImage: receipt.approvedImage }, configuration: true, secrets: true, runtimeManagement: true, pluginManagement: true, realPluginLifecycle: true });
  const proof = { task: 'AF-211', acceptanceId: f.lease.id, checks: [] }, originalFetch = globalThis.fetch;
  const { AiPersonalSkillsService } = f.requireApi('plugins/aij-ai/ai-personal-skills.service.js');
  const { ScriptRunAccessPort } = f.requireApi('plugins/aij-ai/ai-personal-script-runs.service.js');
  const { AiPersonalScriptSkillService } = f.requireApi('plugins/aij-ai/ai-personal-script-skill.service.js');
  const { ScriptSandboxConfiguration } = f.requireApi('plugins/aij-ai/ai-personal-script-execution.service.js');
  const { JobService } = f.requireApi('async-runtime/job.service.js');
  const { ClientAuthGuard } = f.requireApi('client-auth/client-auth.guard.js');
  const { ClientAuthService } = f.requireApi('client-auth/client-auth.service.js');
  const { FileContentService } = f.requireApi('files/file-content.service.js');
  const skills = f.app.get(AiPersonalSkillsService), jobs = f.app.get(JobService), member = f.accounts[0].id, workspace = f.workspaces[0].id;
  const r = { headers: { cookie: f.cookies[0] } }; await f.app.get(ClientAuthGuard).canActivate({ switchToHttp: () => ({ getRequest: () => r }) }); const claims = r.clientClaims;
  const role = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: workspace, code: 'OWNER' } } });
  const grant = async (permission, on) => { const g = await f.prisma.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: role.id, permission: { code: permission } } }); await f.prisma.clientWorkspaceRolePermission.update({ where: { id: g.id }, data: { deletedAt: on ? null : new Date() } }); };
  const source = 'import json\nprint(json.dumps({"value":input_data},ensure_ascii=False))\n';
  const makeHead = () => skills.create(member, workspace, { code: 's-' + randomUUID(), name: 'Private synthetic script', instructions: 'PRIVATE_SCRIPT_PROMPT' });
  const counts = async () => ({ scripts: await f.prisma.aiPersonalScriptVersion.count(), runs: await f.prisma.aiPersonalScriptRun.count(), jobs: await f.prisma.runtimeJob.count(), assets: await f.prisma.fileAsset.count(), audits: await f.prisma.auditLog.count(), ai: await f.prisma.aiAgentRun.count(), traces: await f.prisma.aiExecutionTrace.count(), costs: await f.prisma.aiEvaluationBudgetReservation.count() });
  const sub = async (name, work) => { let fail; await t.test(name, async () => { try { await work(); proof.checks.push(name); } catch (e) { fail = e; throw e; } }); if (fail) throw fail; };
  const traffic = [], observed = [], control = { cookie: f.cookies[0], lose: false }; let proxy, base, disabled, primary, ref, head;
  const privacy = response => { assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); };
  const clientFor = sdk => { const api = sdk.createClientApi(() => base); return sdk.createPersonalScriptExecutionClient((path, options) => api(path, { ...options, headers: { cookie: control.cookie, origin: process.env.WEB_URL } })); };
  const raw = async (method, path, options = {}) => {
    const response = await originalFetch((options.base ?? base) + '/client/script-executions' + path, { method, headers: { connection: 'close', cookie: control.cookie, origin: process.env.WEB_URL, 'x-aij-workspace-id': workspace, ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...options.headers }, ...(options.body === undefined ? {} : { body: options.body }), signal: AbortSignal.timeout(30000) });
    const bytes = Buffer.from(await response.arrayBuffer()); privacy(response);
    if (options.status !== undefined) assert.equal(response.status, options.status, method + ' ' + path + ' ' + bytes.toString().slice(0, 250));
    if (response.status >= 400) { for (const h of ['x-aij-script-run-id', 'x-aij-script-version-id', 'x-aij-asset-id', 'x-aij-checksum-sha256', 'content-disposition']) assert.equal(response.headers.get(h), null); for (const text of [source, 'PRIVATE_SCRIPT_PROMPT', claims.sessionId]) assert.ok(!bytes.toString().includes(text)); }
    return { response, bytes, data: response.headers.get('content-type')?.includes('json') ? JSON.parse(bytes.toString()).data : undefined };
  };
  const postCount = () => traffic.filter(x => x.method === 'POST' && x.path === '/api/client/script-executions/runs').length;
  const execute = async run => { const rows = await jobs.claim('af211-' + randomUUID(), 100), row = rows.find(r => r.id === run.jobId); assert.ok(row); await jobs.execute(row); };
  try {
    proxy = createServer(async (request, response) => {
      const entry = { method: request.method, path: new URL(request.url, 'http://owned.invalid').pathname, status: null }; traffic.push(entry);
      try {
        const chunks = []; let length = 0; for await (const b of request) { length += b.length; assert.ok(length <= 600000); chunks.push(b); }
        const body = Buffer.concat(chunks), headers = new Headers();
        for (const [key, value] of Object.entries(request.headers)) if (value !== undefined && !['host', 'connection', 'transfer-encoding', 'content-length'].includes(key)) headers.set(key, Array.isArray(value) ? value.join(',') : value);
        const upstream = await originalFetch(f.baseUrl + request.url.replace(/^\/api/, ''), { method: request.method, headers, ...(body.length ? { body } : {}), signal: AbortSignal.timeout(30000) });
        entry.status = upstream.status; const output = Buffer.from(await upstream.arrayBuffer());
        if (control.lose && entry.method === 'POST' && entry.path === '/api/client/script-executions/runs') { control.lose = false; assert.equal(upstream.status, 201); entry.committedResponseLost = true; response.destroy(); return; }
        response.writeHead(upstream.status, Object.fromEntries(upstream.headers)); response.end(output);
      } catch { if (!response.destroyed) { response.writeHead(502, { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }); response.end('{}'); } }
    });
    await new Promise((yes, no) => { proxy.once('error', no); proxy.listen(0, '127.0.0.1', yes); }); base = `http://127.0.0.1:${proxy.address().port}/api`;
    globalThis.fetch = (url, options) => {
      if (String(url).startsWith(base + '/client/script-executions')) { observed.push({ credentials: options?.credentials, cache: options?.cache, workspace: new Headers(options?.headers).get('x-aij-workspace-id') }); assert.equal('responseKind' in options, false); assert.equal('maxResponseBytes' in options, false); }
      return originalFetch(url, options);
    };
    let client = clientFor(esm);
    await sub('all seven actual installed ESM/CJS SDK methods, fixed Python output and original single fetch transport', async () => {
      for (const sdk of [esm, cjs]) {
        client = clientFor(sdk); head = await makeHead();
        ref = await client.createVersion(workspace, { skillId: head.id, expectedRevision: 1, name: head.name, instructions: 'PRIVATE_SCRIPT_PROMPT', scriptSource: source });
        assert.equal((await client.version(workspace, ref.scriptVersionId)).scriptSource, source);
        assert.deepEqual(await client.capability(workspace), { configured: true, canExecute: true, reason: 'ready' });
        const key = 'sdk-' + randomUUID(), input = { text: '合成', nul: 'x\u0000y' }, before = await counts();
        primary = await client.submit(workspace, { scriptVersionId: ref.scriptVersionId, input, idempotencyKey: key });
        assert.equal((await client.recover(workspace, key)).id, primary.id); await execute(primary);
        primary = await client.read(workspace, primary.id); assert.equal(primary.outcome, 'SUCCESS');
        const downloaded = await client.download(workspace, primary); assert.deepEqual(JSON.parse(Buffer.from(downloaded.bytes)), { value: input }); assert.equal(digest(downloaded.bytes), primary.result.checksum); downloaded.bytes.fill(0);
        const after = await counts(); assert.equal(after.runs, before.runs + 1); assert.equal(after.jobs, before.jobs + 1); assert.equal(after.assets, before.assets + 1);
        for (const k of ['ai', 'traces', 'costs']) assert.equal(after[k], 0);
      }
      assert.equal(observed.length, 14); for (const request of observed) { assert.equal(request.credentials, 'include'); assert.equal(request.cache, 'no-store'); assert.equal(request.workspace, workspace); }
    });
    await sub('default disabled real application refuses submission while existing authorized downloads remain readable', async () => {
      disabled = await f.requireApi('bootstrap.js').createApplication(); await disabled.listen(0, '127.0.0.1');
      assert.equal(disabled.get(ScriptSandboxConfiguration).configured, false);
      const disabledBase = `http://127.0.0.1:${disabled.getHttpServer().address().port}/api`, before = await counts();
      assert.deepEqual((await raw('GET', '/capability', { base: disabledBase, status: 200 })).data, { configured: false, canExecute: false, reason: 'not_configured' });
      await raw('POST', '/runs', { base: disabledBase, body: JSON.stringify({ scriptVersionId: ref.scriptVersionId, input: null, idempotencyKey: 'disabled-' + randomUUID() }), status: 503 });
      const result = await raw('GET', '/runs/' + primary.id + '/content', { base: disabledBase, status: 200 }); assert.equal(digest(result.bytes), primary.result.checksum); assert.deepEqual(await counts(), before);
      disabled.getHttpServer().closeAllConnections(); await disabled.close(); disabled = undefined;
    });
    await sub('anonymous, foreign-product tokens, Origin and authenticated other owners are refused without effects', async () => {
      const before = await counts(); await raw('GET', '/runs/' + primary.id, { headers: { cookie: '' }, status: 401 });
      const { CLIENT_JWT_SERVICE } = f.requireApi('client-auth/client-auth.security.js'), jwt = f.app.get(CLIENT_JWT_SERVICE), payload = jwt.decode(f.cookies[0].slice(f.cookies[0].indexOf('=') + 1));
      const foreign = await jwt.signAsync({ ...Object.fromEntries(Object.entries(payload).filter(([k]) => !['iat', 'exp', 'iss', 'aud'].includes(k))), projectId: 'foreign-product' });
      await raw('GET', '/runs/' + primary.id, { headers: { cookie: f.cookies[0].split('=')[0] + '=' + foreign }, status: 401 });
      for (const origin of ['', 'https://foreign.invalid']) await raw('POST', '/runs', { headers: { origin }, body: JSON.stringify({ scriptVersionId: ref.scriptVersionId, input: {}, idempotencyKey: 'origin-' + randomUUID() }), status: 403 });
      await raw('POST', '/runs', { headers: { 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ scriptVersionId: ref.scriptVersionId, input: {}, idempotencyKey: 'site-' + randomUUID() }), status: 403 });
      await raw('GET', '/runs/' + primary.id, { headers: { cookie: f.cookies[1], 'x-aij-workspace-id': f.workspaces[1].id }, status: 404 });
      await f.prisma.clientWorkspaceMembership.create({ data: { workspaceId: workspace, memberId: f.accounts[1].id, roleId: role.id } });
      await raw('GET', '/runs/' + primary.id, { headers: { cookie: f.cookies[1] }, status: 404 }); await raw('GET', '/versions/' + ref.scriptVersionId, { headers: { cookie: f.cookies[1] }, status: 404 });
      assert.deepEqual(await counts(), before);
    });
    await sub('raw UTF8/duplicate/unsafe/oversize/media errors and unknown routes retain private headers', async () => {
      const before = await counts(), input = { scriptVersionId: ref.scriptVersionId, input: null, idempotencyKey: 'parser-' + randomUUID() };
      for (const body of ['{"input":1,"\\u0069nput":2}', JSON.stringify({ ...input, input: { constructor: 1 } }), '{"x":1e999}', '{"x":"\\ud800"}', '\ufeff{}', Buffer.from([0xff]), JSON.stringify({ ...input, input: 'x'.repeat(16385) }), JSON.stringify({ ...input, workspaceId: workspace }), JSON.stringify({ ...input, input: null }) + ' {}']) await raw('POST', '/runs', { body, status: 400 });
      for (const headers of [{ 'content-type': 'text/plain' }, { 'content-type': 'application/json; charset=utf-16' }, { 'content-encoding': 'gzip' }]) await raw('POST', '/runs', { body: '{}', headers, status: 415 });
      await raw('POST', '/versions', { body: JSON.stringify({ skillId: head.id, expectedRevision: ref.revision, name: head.name, instructions: 'PRIVATE_SCRIPT_PROMPT', scriptSource: '\u0001'.repeat(65536) }), status: 413 });
      await raw('GET', '/runs/' + primary.id + '?extra=1', { status: 400 }); await raw('GET', '/not-real', { status: 404 });
      const direct = new URL(f.baseUrl + '/client/script-executions/runs/' + primary.id);
      await new Promise((yes, no) => { const request = httpRequest(direct, { method: 'GET', headers: { cookie: f.cookies[0], 'x-aij-workspace-id': workspace, 'content-type': 'application/json', 'content-length': '2' } }, response => { const data = []; response.on('data', b => data.push(b)); response.on('end', () => { try { assert.equal(response.statusCode, 400); assert.equal(response.headers['cache-control'], 'private, no-store'); assert.equal(response.headers['x-content-type-options'], 'nosniff'); yes(); } catch (e) { no(e); } }); }); request.once('error', no); request.end('{}'); });
      assert.deepEqual(await counts(), before);
    });
    await sub('server-committed POST response loss uses one submit then explicit GET key recovery', async () => {
      client = clientFor(esm); const key = 'lost-' + randomUUID(), before = await counts(), posts = postCount(); control.lose = true;
      await assert.rejects(client.submit(workspace, { scriptVersionId: ref.scriptVersionId, input: { lost: true }, idempotencyKey: key }));
      assert.equal(control.lose, false); assert.equal(postCount(), posts + 1);
      const recovered = await client.recover(workspace, key); assert.equal(postCount(), posts + 1); await execute(recovered);
      const final = await client.read(workspace, recovered.id); assert.equal(final.outcome, 'SUCCESS'); assert.equal(digest((await client.download(workspace, final)).bytes), final.result.checksum);
      const after = await counts(); assert.equal(after.runs, before.runs + 1); assert.equal(after.jobs, before.jobs + 1);
    });
    await sub('concurrent actual HTTP key replay creates one original Job and conflicting input is409', async () => {
      const key = 'parallel-' + randomUUID(), before = await counts(), body = { scriptVersionId: ref.scriptVersionId, input: { same: true }, idempotencyKey: key };
      const [a, b] = await Promise.all([client.submit(workspace, body), client.submit(workspace, body)]); assert.equal(a.id, b.id); assert.equal(a.jobId, b.jobId);
      await raw('POST', '/runs', { body: JSON.stringify({ ...body, input: { same: false } }), status: 409 });
      assert.equal((await counts()).jobs, before.jobs + 1); assert.equal((await counts()).runs, before.runs + 1); await execute(a);
    });
    await sub('source manage/read/execute grants remain distinct and current revocation is enforced', async () => {
      const before = await counts(); await grant('workspace.ai.execute', false);
      try { assert.equal((await client.read(workspace, primary.id)).outcome, 'SUCCESS'); assert.equal((await client.capability(workspace)).reason, 'not_permitted'); await raw('POST', '/runs', { body: JSON.stringify({ scriptVersionId: ref.scriptVersionId, input: null, idempotencyKey: 'denied-' + randomUUID() }), status: 403 }); }
      finally { await grant('workspace.ai.execute', true); }
      await grant('workspace.ai.scripts.manage', false); try { await raw('GET', '/versions/' + ref.scriptVersionId, { status: 403 }); assert.equal((await client.read(workspace, primary.id)).id, primary.id); } finally { await grant('workspace.ai.scripts.manage', true); }
      await grant('workspace.ai.scripts.execute', false); try { await raw('GET', '/runs/' + primary.id + '/content', { status: 403 }); } finally { await grant('workspace.ai.scripts.execute', true); }
      assert.deepEqual(await counts(), before);
    });
    await sub('late storage revocation prevents HTTP binary release and clears actual reader bytes', async () => {
      const content = f.app.get(FileContentService), original = content.read.bind(content); let observed;
      content.read = async (...args) => { const bytes = await original(...args); observed = bytes; await grant('workspace.ai.scripts.execute', false); return bytes; };
      try { await raw('GET', '/runs/' + primary.id + '/content', { status: 403 }); assert.ok(observed?.length); assert.ok(observed.every(n => n === 0)); }
      finally { content.read = original; await grant('workspace.ai.scripts.execute', true); }
    });
    await sub('binary provenance and actual CORS exposure identify the same private script and asset', async () => {
      const { response, bytes } = await raw('GET', '/runs/' + primary.id + '/content', { status: 200 });
      assert.equal(response.headers.get('content-type'), 'application/json'); assert.equal(response.headers.get('content-length'), String(primary.result.size)); assert.equal(response.headers.get('x-aij-script-run-id'), primary.id); assert.equal(response.headers.get('x-aij-script-version-id'), primary.script.scriptVersionId); assert.equal(response.headers.get('x-aij-asset-id'), primary.result.assetId); assert.equal(digest(bytes), response.headers.get('x-aij-checksum-sha256'));
      assert.equal(response.headers.get('access-control-allow-origin'), process.env.WEB_URL); assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
      const exposed = response.headers.get('access-control-expose-headers').toLowerCase().split(','); for (const h of ['content-length', 'content-disposition', 'x-aij-script-run-id', 'x-aij-script-version-id', 'x-aij-asset-id', 'x-aij-checksum-sha256']) assert.ok(exposed.includes(h));
    });
    await sub('real expiry410, head409 and session401 responses never enqueue another task', async () => {
      const id = randomUUID(), jobId = randomUUID(), key = 'expired-' + randomUUID(), profile = f.requireApi('plugins/aij-ai/ai-personal-script-run-profile.js');
      await f.app.get(ScriptRunAccessPort).withCurrent(member, workspace, ['workspace.ai.assets.read', 'workspace.ai.execute', 'workspace.ai.scripts.execute'], async (tx, scope) => {
        await f.app.get(AiPersonalScriptSkillService).resolveInTransaction(tx, scope, ref.scriptVersionId, tx => f.app.get(ClientAuthService).assertSessionInTransaction(tx, claims));
        await jobs.enqueueInTransaction(tx, { id: jobId, type: 'aij-ai.personal-script-execute', version: 1, payload: { runId: id }, scope: { type: 'plugin', id: scope.projectId, pluginCode: 'aij-ai' }, workspaceId: workspace, idempotencyKey: 'script:' + id, maxAttempts: 1, timeoutMs: 120000 });
        await tx.$executeRaw`INSERT INTO public.ai_personal_script_run(id,project_id,workspace_id,member_id,script_version_id,skill_ref,request_key,request_hash,input,session_id,token_version,job_id,created_at,expires_at) SELECT ${id}::uuid,${scope.projectId},${workspace},${member},${ref.scriptVersionId}::uuid,${JSON.stringify(ref)}::jsonb,${key},${profile.requestHash(ref, 'null')},'null'::json,${claims.sessionId},${claims.tokenVersion},${jobId},stamp,stamp+interval '7 days' FROM (SELECT (clock_timestamp()-interval '8 days')::timestamp(3) AS stamp) AS time`;
      });
      const before = await counts(); for (const path of ['/runs/' + id, '/requests/' + key, '/runs/' + id + '/content']) await raw('GET', path, { status: 410 });
      await f.prisma.clientAuthSession.update({ where: { id: claims.sessionId }, data: { status: 'revoked' } }); try { await raw('GET', '/runs/' + primary.id, { status: 401 }); } finally { await f.prisma.clientAuthSession.update({ where: { id: claims.sessionId }, data: { status: 'active' } }); }
      await skills.update(member, workspace, head.id, { expectedRevision: ref.revision, name: head.name, instructions: 'Changed source head' });
      await raw('GET', '/runs/' + primary.id, { status: 409 }); await raw('GET', '/versions/' + ref.scriptVersionId, { status: 409 });
      const after = await counts(); assert.equal(after.runs, before.runs); assert.equal(after.jobs, before.jobs); assert.equal(after.assets, before.assets);
    });
    assert.equal((await counts()).ai, 0); assert.equal((await counts()).traces, 0); assert.equal((await counts()).costs, 0);
    const logs = await f.prisma.auditLog.findMany({ where: { action: { startsWith: 'personal_script' } } });
    for (const privateValue of [source, 'PRIVATE_SCRIPT_PROMPT', claims.sessionId]) assert.ok(!JSON.stringify(logs).includes(privateValue));
    proof.committedLostResponses = traffic.filter(r => r.committedResponseLost).length; assert.equal(proof.committedLostResponses, 1); proof.traffic = traffic;
  } finally {
    globalThis.fetch = originalFetch;
    if (disabled) { disabled.getHttpServer().closeAllConnections(); await disabled.close(); }
    if (proxy?.listening) { proxy.closeAllConnections(); await new Promise((yes, no) => proxy.close(e => e ? no(e) : yes())); }
    proof.closure = await f.close(); assert.equal(proof.closure.status, 'CLOSED'); assert.equal(proof.closure.applicationPools, 0); assert.equal(proof.closure.ownedSockets, 0);
    writeFileSync(join('.artifacts/auto-ai-program-20261105/W19', 'AF-211-live-' + f.lease.id + '.json'), JSON.stringify(proof, null, 2));
  }
});
