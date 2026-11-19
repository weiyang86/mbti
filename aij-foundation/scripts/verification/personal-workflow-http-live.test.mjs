import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createWorkflowRuntimeFixture, workflowDeferred as deferred, waitForWorkflowGate as waitGate } from './personal-workflow-runtime-fixture.mjs';

test('AF207 actual HTTP/private parsers and outside installed ESM/CJS SDK original transport', { timeout: 690000 }, async t => {
  assert.equal(process.env.AIJ_AF207_ROOT_ACCEPTANCE, 'true');
  const consumer = realpathSync(process.env.AIJ_AF207_PACKED_CONSUMER); assert.match(consumer, /^\/private\/tmp\/aij-af207-packed-[A-Za-z0-9]+$/);
  const require = createRequire(join(consumer, 'package.json')), cjs = require('@aij/sdk'), esm = await import(pathToFileURL(join(consumer, 'entry.mjs')).href);
  const f = await createWorkflowRuntimeFixture('AF-207'); const proof = { task: 'AF-207', acceptanceId: f.lease.id, database: f.lease.database, checks: [] };
  const traffic = [], observed = [], control = { cookie: f.cookies[0], loseSubmit: false }; let proxy, base, completed, completedKey;
  const originalFetch = globalThis.fetch;
  const sub = async (name, fn) => { let failure; await t.test(name, async () => { try { await fn(); proof.checks.push(name); } catch (e) { failure = e; throw e; } }); if (failure) throw failure; };
  const privateHeaders = r => { assert.equal(r.headers.get('cache-control'), 'private, no-store'); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); };
  const apiFor = sdk => { const api = sdk.createClientApi(() => base); return sdk.createPersonalWorkflowExecutionClient((path, options) => api(path, { ...options, headers: { cookie: control.cookie, origin: process.env.WEB_URL } })); };
  const raw = async (method, path, options = {}) => {
    const response = await originalFetch(base + '/client/workflow-executions' + path, { method, headers: { connection: 'close', cookie: control.cookie,
      origin: process.env.WEB_URL, 'x-aij-workspace-id': f.workspace, ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...options.headers }, body: options.body });
    const text = await response.text(); privateHeaders(response); return { response, text, data: text ? JSON.parse(text).data : null };
  };
  const legacy = async (path, status = 404) => {
    const response = await originalFetch(base + '/client/ai/' + path, { headers: { connection: 'close', cookie: control.cookie,
      origin: process.env.WEB_URL, 'x-aij-workspace-id': f.workspace } });
    const text = await response.text(); assert.equal(response.status, status); assert.match(response.headers.get('cache-control'), /(?:^|,\s*)no-store(?:,|$)/);
    assert.ok(!text.includes('WORKFLOW_SYNTHETIC_OUTPUT')); return text;
  };
  const denyLegacyWorkflow = async (status = 404) => {
    await legacy('runs/' + completed, status); await legacy('run-requests/' + completedKey, status); await legacy('runs/' + completed + '/image', status);
  };
  const counts = async () => ({ ...await f.counts(), publications: await f.prisma.aiPersonalWorkflowPublication.count(), audits: await f.prisma.auditLog.count() });
  const postCount = () => traffic.filter(x => x.method === 'POST' && x.path === '/api/client/workflow-executions/runs').length;
  try {
    proxy = createServer(async (req, res) => {
      const entry = { method: req.method, path: new URL(req.url, 'http://owned.invalid').pathname, status: null }; traffic.push(entry);
      try {
        const chunks = []; let bytes = 0; for await (const chunk of req) { bytes += chunk.length; assert.ok(bytes <= 600000); chunks.push(chunk); }
        const body = Buffer.concat(chunks), headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value !== undefined && !['host', 'connection', 'transfer-encoding', 'content-length'].includes(key)) headers.set(key, Array.isArray(value) ? value.join(',') : value);
        const upstream = await originalFetch(f.baseUrl + req.url.replace(/^\/api/, ''), { method: req.method, headers, ...(body.length ? { body } : {}), signal: AbortSignal.timeout(20000) });
        entry.status = upstream.status; const bytesOut = Buffer.from(await upstream.arrayBuffer());
        if (control.loseSubmit && entry.method === 'POST' && entry.path === '/api/client/workflow-executions/runs') {
          control.loseSubmit = false; assert.equal(upstream.status, 201); entry.committedResponseLost = true; res.destroy(); return;
        }
        res.writeHead(upstream.status, Object.fromEntries(upstream.headers)); res.end(bytesOut);
      } catch { if (!res.destroyed) { res.writeHead(502, { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }); res.end('{}'); } }
    });
    await new Promise((yes, no) => { proxy.once('error', no); proxy.listen(0, '127.0.0.1', yes); }); base = `http://127.0.0.1:${proxy.address().port}/api`;
    globalThis.fetch = (url, options) => { if (String(url).startsWith(base + '/')) observed.push({ method: options?.method, credentials: options?.credentials, cache: options?.cache, workspace: new Headers(options?.headers).get('x-aij-workspace-id') }); return originalFetch(url, options); };
    let client = apiFor(esm);
    await sub('all seven installed ESM/CJS SDK methods use actual original JSON transport and original runtime', async () => {
      for (const sdk of [esm, cjs]) {
        client = apiFor(sdk); let p = await client.publication(f.workspace, f.workflow.id);
        p = await client.unpublish(f.workspace, f.workflow.id, { expectedRevision: p.revision, expectedPublicationEpoch: p.publicationEpoch }); assert.equal(p.publication, null);
        p = await client.publish(f.workspace, { workflowId: f.workflow.id, expectedRevision: p.revision, expectedPublicationEpoch: p.publicationEpoch }); assert.equal(p.dependencyReadiness.ready, true);
        const noop = await client.publish(f.workspace, { workflowId: f.workflow.id, expectedRevision: p.revision, expectedPublicationEpoch: p.publicationEpoch }); assert.equal(noop.publication.id, p.publication.id);
        assert.equal((await client.preview(f.workspace, p.publication.id)).modelExecutionConfigured, true);
        completedKey = 'http-' + randomUUID(); const before = await f.counts(), requests = postCount();
        const queued = await client.submit(f.workspace, { publicationId: p.publication.id, input: { text: 'WORKFLOW_SYNTHETIC_INPUT' }, idempotencyKey: completedKey }); completed = queued.run.id;
        assert.equal(queued.run.status, 'queued'); assert.equal(postCount(), requests + 1); assert.equal((await client.recover(f.workspace, completedKey)).request.id, completed);
        await f.execute(); const result = await client.read(f.workspace, completed); assert.equal(result.run.status, 'succeeded'); assert.equal(result.run.output, 'WORKFLOW_SYNTHETIC_OUTPUT'); assert.equal(result.run.estimatedCostNanos, '40000');
        const after = await f.counts(); for (const key of ['runs', 'jobs', 'origins', 'reservations', 'traces', 'calls', 'credentials']) assert.equal(after[key], before[key] + 1, key);
        assert.equal(result.origin.id, p.publication.id); assert.ok(!JSON.stringify(result).includes(f.claims[0].sessionId));
      }
      // Seven methods plus one explicit publish no-op, once for each module format.
      assert.equal(observed.length, 16); for (const request of observed) { assert.equal(request.credentials, 'include'); assert.equal(request.cache, 'no-store'); assert.equal(request.workspace, f.workspace); }
      for (const r of traffic.filter(r => r.method === 'POST' && /\/publications(?:\/|$)/.test(r.path))) assert.equal(r.status, r.path.endsWith('/unpublish') ? 200 : 201);
    });
    await sub('anonymous/cross-product/cross-site and scope refusals retain private headers and no durable side effects', async () => {
      const p = await client.publication(f.workspace, f.workflow.id), before = await counts();
      assert.equal((await raw('GET', '/runs/' + completed, { headers: { cookie: '' } })).response.status, 401);
      const { CLIENT_JWT_SERVICE } = f.requireApi('client-auth/client-auth.security.js'), jwt = f.app.get(CLIENT_JWT_SERVICE), payload = jwt.decode(f.cookies[0].slice(f.cookies[0].indexOf('=') + 1));
      const signed = await jwt.signAsync({ ...Object.fromEntries(Object.entries(payload).filter(([k]) => !['iat', 'exp', 'iss', 'aud'].includes(k))), projectId: 'foreign-product' });
      assert.equal((await raw('GET', '/runs/' + completed, { headers: { cookie: f.cookies[0].split('=')[0] + '=' + signed } })).response.status, 401);
      for (const origin of ['', 'https://foreign.invalid']) assert.equal((await raw('POST', '/publications', { headers: { origin }, body: JSON.stringify({ workflowId: f.workflow.id, expectedRevision: p.revision, expectedPublicationEpoch: p.publicationEpoch }) })).response.status, 403);
      assert.equal((await raw('POST', '/runs', { headers: { 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ publicationId: p.publication.id, input: { text: 'synthetic' }, idempotencyKey: 'http-' + randomUUID() }) })).response.status, 403);
      assert.equal((await raw('GET', '/runs/' + completed, { headers: { 'x-aij-workspace-id': f.workspaces[1].id } })).response.status, 403);
      assert.equal((await raw('GET', '/unknown-route')).response.status, 404); assert.deepEqual(await counts(), before);
    });
    await sub('actual strict JSON/UTF8/duplicates/query/body/media bounds reject before changes and never echo private input', async () => {
      const p = await client.publication(f.workspace, f.workflow.id), before = await counts();
      const body = { publicationId: p.publication.id, input: { text: 'WORKFLOW_SYNTHETIC_INPUT' }, idempotencyKey: 'http-' + randomUUID() };
      const malformed = [Buffer.from([0xff, 0xfe]), '{"SECRET_C_SENTINEL":', '{"publicationId":"x","publicationId":"y"}', '{"publicationId":"x","publication\\u0049d":"y"}', '{"__proto__":{}}', '{"expectedRevision":1e999}', ' '.repeat(110000)];
      for (const value of malformed) { const r = await raw('POST', '/runs', { body: value }); assert.ok([400, 413].includes(r.response.status)); assert.ok(!r.text.includes('SECRET_C_SENTINEL')); }
      for (const field of ['memberId', 'workspaceId', 'claims', 'sessionId', 'tokenVersion', 'source', 'snapshot', 'script']) assert.equal((await raw('POST', '/runs', { body: JSON.stringify({ ...body, [field]: 'SECRET_C_SENTINEL' }) })).response.status, 400);
      for (const path of ['/runs/' + completed + '?workspaceId=forged', '/capability?publicationId=' + p.publication.id + '&publicationId=' + p.publication.id, '/requests/' + completedKey + '?mode=read']) assert.equal((await raw('GET', path)).response.status, 400);
      const form = new URLSearchParams({ publicationId: p.publication.id, 'input[text]': 'SECRET_C_SENTINEL', idempotencyKey: 'http-' + randomUUID() }).toString();
      for (const type of ['application/x-www-form-urlencoded', 'text/plain', 'application/json; charset=iso-8859-1']) assert.equal((await raw('POST', '/runs', { headers: { 'content-type': type }, body: form })).response.status, 415);
      // Node fetch forbids GET bodies. Send actual bytes over HTTP to the original API.
      const r = await new Promise((yes, no) => { const q = httpRequest(f.baseUrl + '/client/workflow-executions/runs/' + completed, { method: 'GET', headers: { cookie: f.cookies[0], origin: process.env.WEB_URL, 'x-aij-workspace-id': f.workspace, 'content-type': 'application/json', 'content-length': '2' } }, response => { let text = ''; response.on('data', b => { text += b; }); response.on('end', () => yes({ status: response.statusCode, headers: response.headers, text })); }); q.on('error', no); q.end('{}'); });
      assert.equal(r.status, 400); assert.equal(r.headers['cache-control'], 'private, no-store'); assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.deepEqual(await counts(), before);
    });
    await sub('read-only current grant matrix and configured=false do not admit or reserve execution', async () => {
      const before = await counts(), p = await client.publication(f.workspace, f.workflow.id); await f.setGrant('workspace.ai.execute', false);
      try { assert.equal((await client.read(f.workspace, completed)).run.id, completed); assert.equal((await client.recover(f.workspace, completedKey)).request.id, completed); await assert.rejects(client.preview(f.workspace, p.publication.id), e => e.status === 403); await assert.rejects(client.submit(f.workspace, { publicationId: p.publication.id, input: { text: 'synthetic' }, idempotencyKey: 'http-' + randomUUID() }), e => e.status === 403); }
      finally { await f.setGrant('workspace.ai.execute', true); }
      await denyLegacyWorkflow();
      for (const permission of ['workspace.ai.assets.read', 'workspace.ai.read', 'workspace.ai.workflows.execute']) { await f.setGrant(permission, false); try { await assert.rejects(client.read(f.workspace, completed), e => e.status === 403); await assert.rejects(client.recover(f.workspace, completedKey), e => e.status === 403); await denyLegacyWorkflow(permission === 'workspace.ai.read' ? 403 : 404); } finally { await f.setGrant(permission, true); } }
      process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'false';
      try { assert.equal((await client.preview(f.workspace, p.publication.id)).modelExecutionConfigured, false); await assert.rejects(client.submit(f.workspace, { publicationId: p.publication.id, input: { text: 'synthetic' }, idempotencyKey: 'http-' + randomUUID() }), e => e.status === 503); }
      finally { process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'true'; }
      assert.deepEqual(await counts(), before);
    });
    await sub('actual committed HTTP response loss performs one POST; explicit installed SDK GET recovers original task', async () => {
      const p = await client.publication(f.workspace, f.workflow.id), key = 'lost-' + randomUUID(), before = await f.counts(), requests = postCount(); control.loseSubmit = true;
      await assert.rejects(client.submit(f.workspace, { publicationId: p.publication.id, input: { text: 'WORKFLOW_SYNTHETIC_INPUT' }, idempotencyKey: key }));
      assert.equal(postCount(), requests + 1); assert.equal(traffic.filter(t => t.committedResponseLost).length, 1);
      const recovered = await client.recover(f.workspace, key); assert.equal(recovered.request.status, 'queued'); assert.equal(postCount(), requests + 1);
      await f.execute(); assert.equal((await client.read(f.workspace, recovered.request.id)).run.status, 'succeeded');
      const after = await f.counts(); for (const field of ['runs', 'jobs', 'origins', 'reservations', 'traces', 'calls', 'credentials']) assert.equal(after[field], before[field] + 1);
      proof.committedLostResponsePosts = 1;
    });
    await sub('concurrent installed ESM/CJS HTTP requests share one original task and conflict on changed input', async () => {
      const p = await client.publication(f.workspace, f.workflow.id), key = 'race-' + randomUUID(), before = await f.counts(), body = { publicationId: p.publication.id, input: { text: 'WORKFLOW_SYNTHETIC_INPUT' }, idempotencyKey: key };
      const results = await Promise.all([apiFor(esm).submit(f.workspace, body), apiFor(cjs).submit(f.workspace, body)]); assert.equal(results[0].run.id, results[1].run.id);
      await assert.rejects(client.submit(f.workspace, { ...body, input: { text: 'changed' } }), e => e.status === 409);
      await f.execute(); assert.equal((await client.read(f.workspace, results[0].run.id)).run.status, 'succeeded');
      const after = await f.counts(); for (const field of ['runs', 'jobs', 'origins', 'reservations', 'traces', 'calls', 'credentials']) assert.equal(after[field], before[field] + 1);
    });
    await sub('new real login session reads old result while revoked original session cannot dispatch', async () => {
      const p = await client.publication(f.workspace, f.workflow.id), queued = await client.submit(f.workspace, { publicationId: p.publication.id, input: { text: 'WORKFLOW_SYNTHETIC_INPUT' }, idempotencyKey: 'session-' + randomUUID() }), next = await f.loginAgain(), before = await f.counts();
      await f.prisma.clientAuthSession.update({ where: { id: f.claims[0].sessionId }, data: { status: 'revoked' } });
      try { await assert.rejects(client.read(f.workspace, completed), e => e.status === 401); await denyLegacyWorkflow(401); control.cookie = next.cookie; await denyLegacyWorkflow(); assert.equal((await client.read(f.workspace, completed)).run.status, 'succeeded'); await f.execute(); assert.equal((await client.read(f.workspace, queued.run.id)).run.status, 'failed'); assert.equal(f.state.calls, before.calls); }
      finally { await f.prisma.clientAuthSession.update({ where: { id: f.claims[0].sessionId }, data: { status: 'active' } }); control.cookie = f.cookies[0]; }
    });
    await sub('HTTP result is withheld after real original owner read and late grant revocation', async () => {
      const original = f.core.read.bind(f.core), entered = deferred(), release = deferred(), before = await counts();
      f.core.read = async (...a) => { const value = await original(...a); entered.resolve(); await release.promise; return value; };
      const pending = client.read(f.workspace, completed); pending.catch(() => {});
      try { await waitGate(entered.promise); await f.setGrant('workspace.ai.read', false); release.resolve(); await assert.rejects(pending, e => e.status === 403); }
      finally { release.resolve(); await pending.catch(() => {}); f.core.read = original; await f.setGrant('workspace.ai.read', true); }
      assert.deepEqual(await counts(), before);
      const controller = new AbortController(); controller.abort(); const beforeRequests = traffic.length;
      await assert.rejects(client.read(f.workspace, completed, { signal: controller.signal })); assert.equal(traffic.length, beforeRequests);
    });
    await sub('late session revocation withholds workflow output after the original read completes', async () => {
      const original = f.core.read.bind(f.core), entered = deferred(), release = deferred(), before = await counts();
      f.core.read = async (...a) => { const value = await original(...a); entered.resolve(); await release.promise; return value; };
      const pending = client.read(f.workspace, completed); pending.catch(() => {});
      try {
        await waitGate(entered.promise); await f.prisma.clientAuthSession.update({ where: { id: f.claims[0].sessionId }, data: { status: 'revoked' } });
        release.resolve(); await assert.rejects(pending, e => e.status === 401);
      } finally {
        release.resolve(); await pending.catch(() => {}); f.core.read = original;
        await f.prisma.clientAuthSession.update({ where: { id: f.claims[0].sessionId }, data: { status: 'active' } });
      }
      assert.deepEqual(await counts(), before);
    });
    await sub('other same-workspace OWNER remains private and unsupported graphs retain draft without publication', async () => {
      const role = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: f.workspace, code: 'OWNER' } } });
      await f.prisma.clientWorkspaceMembership.create({ data: { workspaceId: f.workspace, memberId: f.accounts[1].id, roleId: role.id } });
      control.cookie = f.cookies[1]; try { await assert.rejects(client.publication(f.workspace, f.workflow.id), e => e.status === 404); await assert.rejects(client.read(f.workspace, completed), e => e.status === 404); } finally { control.cookie = f.cookies[0]; }
      const graph = { ...f.graph, nodes: [...f.graph.nodes, { id: 'review', type: 'human-approval', label: 'Review' }], edges: [{ from: 's', port: 'next', to: 'review', input: 'in' }, { from: 'review', port: 'next', to: 'a', input: 'in' }, { from: 'a', port: 'next', to: 'e', input: 'in' }] };
      const saved = await f.request('POST', 'client/ai/personal-workflows', { status: 201, body: { code: 'complex-' + randomUUID(), name: 'Retained complex draft', graph } });
      await assert.rejects(client.publish(f.workspace, { workflowId: saved.id, expectedRevision: 1, expectedPublicationEpoch: 0 }), e => e.status === 400);
      const retained = await f.request('GET', 'client/ai/personal-workflows/' + saved.id); assert.equal(retained.graph.nodes.length, 4); assert.equal((await client.publication(f.workspace, saved.id)).publication, null);
    });
    await sub('actual revision/epoch conflicts keep history and require explicit publish; no source substitution', async () => {
      const old = await client.publication(f.workspace, f.workflow.id), before = await f.counts();
      await f.request('PATCH', 'client/ai/personal-workflows/' + f.workflow.id, { body: { name: 'New current revision', graph: f.graph, expectedRevision: 1 } });
      const stale = await client.publication(f.workspace, f.workflow.id); assert.equal(stale.dependencyReadiness.reason, 'revision_changed');
      await assert.rejects(client.submit(f.workspace, { publicationId: old.publication.id, input: { text: 'synthetic' }, idempotencyKey: 'stale-' + randomUUID() }), e => e.status === 409);
      const next = await client.publish(f.workspace, { workflowId: f.workflow.id, expectedRevision: stale.revision, expectedPublicationEpoch: stale.publicationEpoch }); assert.notEqual(next.publication.workflowVersionId, old.publication.workflowVersionId);
      await assert.rejects(client.publish(f.workspace, { workflowId: f.workflow.id, expectedRevision: old.revision, expectedPublicationEpoch: old.publicationEpoch }), e => e.status === 409);
      const revoked = await client.unpublish(f.workspace, f.workflow.id, { expectedRevision: next.revision, expectedPublicationEpoch: next.publicationEpoch }); assert.equal(revoked.publication, null);
      await denyLegacyWorkflow();
      await assert.rejects(client.preview(f.workspace, next.publication.id), e => e.status === 409);
      const again = await client.publish(f.workspace, { workflowId: f.workflow.id, expectedRevision: revoked.revision, expectedPublicationEpoch: revoked.publicationEpoch }); assert.notEqual(again.publication.id, next.publication.id);
      const after = await f.counts(); for (const field of ['runs', 'jobs', 'origins', 'reservations', 'traces', 'calls', 'credentials']) assert.equal(after[field], before[field]);
      proof.originalTransportObservations = observed.length; proof.actualProviderCalls = f.state.calls;
    });
    await sub('durable origin excludes purged workflow rows from legacy read, recovery and image routes', async () => {
      const before = await counts();
      await f.prisma.aiAgentRun.update({ where: { id: completed }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await f.core.cleanup();
      const purged = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: completed } });
      assert.equal(purged.snapshot, null); assert.ok(purged.contentPurgedAt);
      assert.ok(await f.prisma.aiPersonalWorkflowRunOrigin.findUnique({ where: { runId: completed } }));
      await denyLegacyWorkflow(); assert.deepEqual(await counts(), before);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (proxy) { proxy.closeAllConnections(); await new Promise(r => proxy.close(r)); }
    proof.proxyClosed = !proxy?.listening; proof.closure = await f.close(); assert.equal(proof.closure.status, 'CLOSED');
    writeFileSync(join('.artifacts/auto-ai-program-20261105/W18', 'AF-207-live-' + f.lease.id + '.json'), JSON.stringify(proof, null, 2) + '\n', { mode: 0o600 });
  }
});
