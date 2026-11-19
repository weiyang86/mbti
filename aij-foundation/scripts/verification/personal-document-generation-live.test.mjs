import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkflowRuntimeFixture } from './personal-workflow-runtime-fixture.mjs';
import { w21NativeBrowser } from './w21-native-browser.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
test('AF229 outside installed public ESM/CJS/browser and real private generation HTTP/runtime', { timeout: 480000 }, async () => {
 assert.equal(process.env.AIJ_AF229_ROOT_ACCEPTANCE, 'true');
 const consumer = await realpath(process.env.AIJ_AF229_PACKED_CONSUMER), artifact = process.env.AIJ_AF229_ROOT_ARTIFACT;
 assert.match(consumer, /^\/private\/tmp\/aij-af229-packed-[A-Za-z0-9]+$/); assert.equal(await readFile(join(consumer, '.af229-owned'), 'utf8'), 'AF-229\n');
 assert.equal((await lstat(join(consumer, 'node_modules/@aij/sdk'))).isSymbolicLink(), false);
 const esm = await import(pathToFileURL(join(consumer, 'node_modules/@aij/sdk/dist/index.mjs')).href), cjs = createRequire(join(consumer, 'package.json'))('@aij/sdk');
 const browser = w21NativeBrowser(artifact); let f, host, failure, phase = 'SETUP', dropNextSubmit = false, executeBrowserSubmit = false, fixture, script;
 const proof = [], forwarded = [], statuses = [];
 const prefixes = /^\/api\/client\/ai\/(?:document-generations(?:\/preview)?|document-generation-runs\/[A-Za-z0-9_-]{1,128}|document-generation-requests\/[A-Za-z0-9_-]{8,128})$/;
 try {
  f = await createWorkflowRuntimeFixture('AF-229');
  const { member, workspace, core } = f;
  const { DocumentGenerationRunDriver } = f.requireApi('plugins/aij-ai/ai-personal-document-generation.service.js'); assert.strictEqual(f.app.get(DocumentGenerationRunDriver), core);
  const { PersonalDocumentsService } = f.requireApi('documents/personal-documents.service.js'), documents = f.app.get(PersonalDocumentsService);
  const agent = await f.request('POST', 'client/ai/personal-agents', { status: 201, body: { ...f.content, code: 'document-api-agent', inputFields: ['source', 'instruction'] } });
  const publication = await f.request('GET', `client/ai/personal-agents/${agent.id}/publication`);
  await f.request('POST', `client/ai/personal-agents/${agent.id}/publication/publish`, { body: { expectedAgentRevision: publication.revision, expectedPublicationVersion: publication.publicationVersion } });
  const source = async () => {
   const document = await documents.create(member, workspace, { code: 'api-' + randomUUID(), name: 'Private source', body: '# Source 😀\r\nAPI_SYNTHETIC_SOURCE\r\n' });
   return { document, body: { documentId: document.id, expectedRevision: document.revision, bodySha256: sha(document.body), sectionId: 'section-0', agentId: agent.id, agentRevision: agent.revision, instruction: 'Revise only this section.' } };
  };
  const counts = () => Promise.all([f.prisma.aiAgentRun.count(), f.prisma.runtimeJob.count(), f.prisma.aiEvaluationBudgetReservation.count(), f.prisma.aiPersonalDocumentRunOrigin.count(), f.prisma.aiExecutionTrace.count(), Promise.resolve(f.state.calls)]);
  const privateResponse = response => { assert.match(response.headers.get('cache-control') ?? '', /private/); assert.match(response.headers.get('cache-control') ?? '', /no-store/); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.match(response.headers.get('x-correlation-id') ?? '', /^[A-Za-z0-9._:-]{8,128}$/); };
  const raw = async (path, { method = 'GET', body, cookie = f.cookies[0], wid = workspace, origin = process.env.WEB_URL, type = 'application/json' } = {}) => {
   const response = await fetch(f.baseUrl + path, { method, headers: { connection: 'close', ...(cookie ? { cookie } : {}), ...(wid ? { 'x-aij-workspace-id': wid } : {}), ...(origin ? { origin } : {}), ...(body === undefined ? {} : { 'content-type': type }) }, body, signal: AbortSignal.timeout(20000) });
   privateResponse(response); const text = await response.text(); assert.equal(text.includes('AF229_PRIVATE_RAW_SENTINEL'), false); statuses.push(response.status); return { status: response.status, text, data: text ? JSON.parse(text).data : undefined };
  };
  host = createServer(async (req, res) => {
   try {
    const url = new URL(req.url, 'http://127.0.0.1'); res.setHeader('cache-control', 'private, no-store');
    if (req.method === 'GET' && url.pathname === '/') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>AF229 installed public SDK</title><script type="importmap">' + JSON.stringify({ imports: { '@aij/sdk': '/packages/sdk/index.mjs', '@aij/contracts': '/packages/contracts/index.mjs' } }) + '</script><script type="module" src="/app.mjs"></script><main><h1>Public generation SDK</h1><output id="status">RUNNING</output></main>'); return; }
    if (req.method === 'GET' && url.pathname === '/app.mjs') { res.setHeader('content-type', 'text/javascript; charset=utf-8'); res.end(script); return; }
    if (req.method === 'GET' && url.pathname === '/fixture.json') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(fixture)); return; }
    const file = url.pathname.match(/^\/packages\/(sdk|contracts)\/([a-z0-9-]+\.mjs)$/);
    if (req.method === 'GET' && file) { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(join(consumer, 'node_modules/@aij', file[1], 'dist', file[2]))); return; }
    if (prefixes.test(url.pathname) && !url.search && ['GET', 'POST'].includes(req.method)) {
     assert.equal(req.headers['x-aij-workspace-id'], workspace);
     const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = Buffer.concat(chunks);
     const response = await fetch(f.baseUrl + url.pathname.slice(4), { method: req.method, headers: { cookie: f.cookies[0], origin: process.env.WEB_URL, 'x-aij-workspace-id': workspace, connection: 'close', ...(body.length ? { 'content-type': 'application/json' } : {}) }, body: body.length ? body : undefined, signal: AbortSignal.timeout(20000) });
     privateResponse(response); const bytes = Buffer.from(await response.arrayBuffer()); forwarded.push({ method: req.method, path: url.pathname, status: response.status });
     if (req.method === 'POST' && url.pathname.endsWith('/document-generations') && response.status === 202) {
      if (dropNextSubmit) { dropNextSubmit = false; res.destroy(); return; }
      if (executeBrowserSubmit) { executeBrowserSubmit = false; await f.execute(); }
     }
     res.writeHead(response.status, { 'content-type': 'application/json', 'cache-control': response.headers.get('cache-control'), 'x-content-type-options': response.headers.get('x-content-type-options'), 'x-correlation-id': response.headers.get('x-correlation-id') }); res.end(bytes); return;
    }
    res.writeHead(404).end();
   } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise((yes, no) => { host.once('error', no); host.listen(0, '127.0.0.1', yes); });
  const origin = 'http://127.0.0.1:' + host.address().port, api = esm.createClientApi(() => origin + '/api');
  const clients = [esm.createPersonalDocumentGenerationClient(api), cjs.createPersonalDocumentGenerationClient(api)];
  phase = 'PUBLIC_ESM_CJS';
  for (const [index, client] of clients.entries()) {
   const current = await source(), before = await counts(), start = forwarded.length, controller = new AbortController();
   const preview = await client.preview(workspace, current.body, controller.signal); assert.equal(preview.modelExecutionConfigured, true); assert.deepEqual(await counts(), before);
   const key = 'public-' + index + '-' + randomUUID(), run = await client.submit(workspace, { origin: preview.origin, instruction: current.body.instruction, idempotencyKey: key }, controller.signal);
   assert.equal(run.run.status, 'queued'); const job = await f.execute(); assert.equal(job.id, (await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id: run.run.id } })).jobId);
   const result = await client.read(workspace, run.run.id, controller.signal), metadata = await client.recover(workspace, key, controller.signal);
   assert.equal(result.run.status, 'succeeded'); assert.equal(result.run.output, 'WORKFLOW_SYNTHETIC_OUTPUT'); assert.equal(metadata.request.id, run.run.id); assert.equal(metadata.documentCurrent, true); assert.equal(Object.hasOwn(metadata, 'output'), false);
   assert.equal(forwarded.length, start + 4); assert.equal((await documents.get(member, workspace, current.document.id)).revision, 1);
   proof.push({ case: index ? 'actual_outside_CJS_four_original_API_operations' : 'actual_outside_ESM_four_original_API_operations', actualRequests: 4, oneOriginalTrace: await f.prisma.aiExecutionTrace.count({ where: { jobId: job.id } }) === 1 });
  }
  phase = 'LOST_REPLY';
  const current = await source(), preview = await clients[0].preview(workspace, current.body), key = 'lost-' + randomUUID(), before = await counts(), postCount = forwarded.filter(x => x.method === 'POST' && x.path.endsWith('/document-generations')).length;
  dropNextSubmit = true; await assert.rejects(clients[0].submit(workspace, { origin: preview.origin, instruction: current.body.instruction, idempotencyKey: key }));
  assert.equal(forwarded.filter(x => x.method === 'POST' && x.path.endsWith('/document-generations')).length, postCount + 1);
  const recovered = await clients[0].recover(workspace, key); assert.equal(recovered.request.status, 'queued'); assert.equal(recovered.request.budgetStatus, 'reserved');
  const after = await counts(); assert.deepEqual(after, before.map((v, i) => v + (i < 4 ? 1 : 0))); await f.execute(); assert.equal((await clients[0].read(workspace, recovered.request.id)).run.status, 'succeeded');
  proof.push({ case: 'actual_HTTP_reply_dropped_after_committed_original_admission', posts: 1, explicitMetadataRecovery: true, automaticReplay: false });
  phase = 'PRIVATE_HTTP_PROTOCOL';
  const requestBody = JSON.stringify(current.body);
  for (const [path, options, expected] of [
   ['/client/ai/document-generations/preview', { method: 'POST', body: requestBody, cookie: null }, 401],
   ['/client/ai/document-generations/preview', { method: 'POST', body: requestBody, origin: 'https://foreign.invalid' }, 403],
   ['/client/ai/document-generations/preview', { method: 'POST', body: requestBody, type: 'text/plain' }, 415],
   ['/client/ai/document-generations/preview', { method: 'POST', body: requestBody, type: 'application/json;charset=utf-16' }, 415],
   ['/client/ai/document-generations/preview', { method: 'POST', body: '{"instruction":"AF229_PRIVATE_RAW_SENTINEL","instruction":"duplicate"}' }, 400],
   ['/client/ai/document-generations/preview', { method: 'POST', body: '{"instruction":"AF229_PRIVATE_RAW_SENTINEL","instruc\\u0074ion":"duplicate"}' }, 400],
   ['/client/ai/document-generations/preview', { method: 'POST', body: '{"__proto__":{"value":"AF229_PRIVATE_RAW_SENTINEL"}}' }, 400],
   ['/client/ai/document-generations/preview', { method: 'POST', body: '{"expectedRevision":1e1000}' }, 400],
   ['/client/ai/document-generations/preview', { method: 'POST', body: Buffer.from([123, 34, 192, 175, 34, 58, 49, 125]) }, 400],
   ['/client/ai/document-generations/preview', { method: 'POST', body: '{"instruction":"' + 'x'.repeat(110000) + '"}' }, 413],
   ['/client/ai/document-generations/preview?constructor=bad', { method: 'POST', body: requestBody }, 400],
   ['/client/ai/document-generation-runs/not-found', {}, 404],
   ['/client/ai/document-generation-runs/not-found?__proto__=bad', {}, 400],
   ['/client/ai/document-generations/not-a-route', {}, 404]
  ]) { const result = await raw(path, options); assert.equal(result.status, expected); }
  const getBody = await new Promise((yes, no) => {
   const req = httpRequest(f.baseUrl + '/client/ai/document-generation-runs/' + recovered.request.id, { method: 'GET', headers: { cookie: f.cookies[0], origin: process.env.WEB_URL, 'x-aij-workspace-id': workspace, 'content-type': 'application/json', 'content-length': '2', connection: 'close' } }, response => { response.resume(); response.once('end', () => yes({ status: response.statusCode, cache: response.headers['cache-control'] })); }); req.once('error', no); req.end('{}');
  }); assert.equal(getBody.status, 400); assert.match(getBody.cache, /private.*no-store/);
  const boundaryBefore = await counts();
  for (const body of [{ ...current.body, expectedRevision: 199 }, { ...current.body, bodySha256: 'a'.repeat(64) }]) assert.equal((await raw('/client/ai/document-generations/preview', { method: 'POST', body: JSON.stringify(body) })).status, 409);
  assert.equal((await raw('/client/ai/document-generations', { method: 'POST', body: JSON.stringify({ origin: { ...preview.origin, maximumEstimatedCostNanos: '0' }, instruction: current.body.instruction, idempotencyKey: 'price-' + randomUUID() }) })).status, 409);
  process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'false';
  try { assert.equal((await clients[0].preview(workspace, current.body)).modelExecutionConfigured, false); assert.equal((await raw('/client/ai/document-generations', { method: 'POST', body: JSON.stringify({ origin: preview.origin, instruction: current.body.instruction, idempotencyKey: 'disabled-' + randomUUID() }) })).status, 503); }
  finally { process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'true'; }
  const aborted = AbortSignal.abort(), calls = forwarded.length; await assert.rejects(clients[0].read(workspace, recovered.request.id, aborted)); assert.equal(forwarded.length, calls); assert.deepEqual(await counts(), boundaryBefore);
  proof.push({ case: 'actual_private_HTTP_parser_auth_origin_ref_price_default_deny_and_abort', observedStatuses: [...new Set(statuses)].sort(), GETBody400: true, runtimeUnchanged: true });
  phase = 'READ_SCOPE';
  for (const permission of ['workspace.documents.manage', 'workspace.documents.export', 'workspace.ai.execute']) await f.setGrant(permission, false);
  try { assert.equal((await clients[0].preview(workspace, current.body)).origin.agentId, agent.id); assert.equal((await clients[0].read(workspace, recovered.request.id)).run.status, 'succeeded'); assert.equal((await clients[0].recover(workspace, key)).documentCurrent, true); await assert.rejects(clients[0].submit(workspace, { origin: preview.origin, instruction: current.body.instruction, idempotencyKey: 'readonly-' + randomUUID() }), error => error.status === 403); }
  finally { for (const permission of ['workspace.documents.manage', 'workspace.documents.export', 'workspace.ai.execute']) await f.setGrant(permission, true); }
  await f.setGrant('workspace.documents.read', false);
  try { await assert.rejects(clients[0].read(workspace, recovered.request.id), error => error.status === 403); await assert.rejects(clients[0].recover(workspace, key), error => error.status === 403); }
  finally { await f.setGrant('workspace.documents.read', true); }
  assert.equal((await raw('/client/ai/document-generation-runs/' + recovered.request.id, { cookie: f.cookies[1], wid: f.workspaces[1].id })).status, 404);
  proof.push({ case: 'current_real_read_without_write_permissions_and_cross_owner_refusal' });
  phase = 'ORIGINAL_UNKNOWN';
  const uncertainSource = await source(), uncertainPreview = await clients[0].preview(workspace, uncertainSource.body), uncertainKey = 'unknown-' + randomUUID();
  const uncertain = await clients[0].submit(workspace, { origin: uncertainPreview.origin, instruction: uncertainSource.body.instruction, idempotencyKey: uncertainKey });
  f.state.mode = 'lost'; try { await f.execute(); } finally { f.state.mode = 'success'; }
  const unknown = await clients[0].read(workspace, uncertain.run.id); assert.equal(unknown.run.status, 'unknown'); assert.equal(unknown.run.budgetStatus, 'reserved'); assert.equal(unknown.run.output, null); assert.equal((await clients[0].recover(workspace, uncertainKey)).request.status, 'unknown');
  proof.push({ case: 'real_upstream_disconnect_stays_original_unknown_reserved_no_output_or_replay' });
  phase = 'ACTUAL_BROWSER';
  const browserSource = await source(); fixture = { workspace, body: browserSource.body, key: 'browser-' + randomUUID() }; executeBrowserSubmit = true;
  script = `import {createClientApi,createPersonalDocumentGenerationClient} from '@aij/sdk';try{const f=await(await fetch('/fixture.json')).json();const c=createPersonalDocumentGenerationClient(createClientApi(()=>location.origin+'/api'));const p=await c.preview(f.workspace,f.body);const r=await c.submit(f.workspace,{origin:p.origin,instruction:f.body.instruction,idempotencyKey:f.key});const s=await c.read(f.workspace,r.run.id);const m=await c.recover(f.workspace,f.key);if(s.run.status!=='succeeded'||s.run.output!=='WORKFLOW_SYNTHETIC_OUTPUT'||m.request.id!==r.run.id||!m.documentCurrent)throw Error();document.getElementById('status').textContent='AF229_BROWSER_PASS';}catch{document.getElementById('status').textContent='AF229_BROWSER_FAIL';}`;
  const browserBefore = forwarded.length, callsBefore = f.state.calls;
  await browser.action('create', ['--url', origin + '/']); await browser.action('snapshot', ['--full']); await browser.wait('AF229_BROWSER_PASS'); assert.equal(await browser.read('document.getElementById("status").textContent'), 'AF229_BROWSER_PASS');
  assert.equal(forwarded.length, browserBefore + 4); assert.equal(f.state.calls, callsBefore + 1); assert.equal((await documents.get(member, workspace, browserSource.document.id)).revision, 1); await browser.close();
  proof.push({ case: 'actual_Orca_browser_fresh_installed_ESM_WebCrypto_four_real_API_operations', requests: 4, originalProviderCalls: 1, originalDocumentUnchanged: true });
  phase = 'RETENTION';
  await core.cleanup(new Date(Date.now() + 8 * 86400000));
  const metadata = await clients[0].recover(workspace, key); assert.equal(metadata.request.contentAvailable, false); assert.equal(metadata.documentCurrent, true);
  await assert.rejects(clients[0].read(workspace, recovered.request.id), error => error.status === 410); assert.equal((await raw('/client/ai/document-generation-runs/' + recovered.request.id)).status, 410);
  for (const path of ['/client/ai/runs/' + recovered.request.id, '/client/ai/run-requests/' + key, '/client/ai/runs/' + recovered.request.id + '/image']) {
   const response = await fetch(f.baseUrl + path, { headers: { cookie: f.cookies[0], 'x-aij-workspace-id': workspace, connection: 'close' } }); assert.equal(response.status, 404); await response.body?.cancel();
  }
  await f.request('POST', 'client/auth/logout'); await assert.rejects(clients[0].recover(workspace, key), error => error.status === 401);
  proof.push({ case: 'original_retention_purge_keeps_authorized_metadata_and_fences_full_or_legacy_output_then_session_revocation' });
  await writeFile(join(artifact, 'proof.json'), JSON.stringify({ task: 'AF-229', status: 'PASS', acceptanceId: f.lease.id, proof, actualForwardedRequests: forwarded, strictPrivateStatuses: [...new Set(statuses)].sort(), paidVendorCalls: 0, pageGenerationUi: 'NEXT_WAVE', ownerAcceptance: 'PENDING' }, null, 2), { mode: 0o600 });
 } catch (error) { failure = error; await writeFile(join(artifact, 'live-failure.json'), JSON.stringify({ phase, code: error?.code ?? 'FAILED', status: error?.status, frames: String(error?.stack ?? '').split('\n').filter(line => /^\s+at /.test(line)).slice(0, 8) }, null, 2), { mode: 0o600 }); }
 finally { await browser.close(); if (host) { host.closeAllConnections(); await new Promise((yes, no) => host.close(error => error ? no(error) : yes())); } if (f) { const closed = await f.close(); assert.equal(closed.applicationPools0, true); assert.equal(closed.ownedSockets0, true); assert.equal(closed.providerClosed, true); } }
 if (failure) throw Error('AF229_REAL_PUBLIC_SDK_FAILED_AT_' + phase);
});
