// Root acceptance only. Original API/auth/provider/runtime owners and owned synthetic HTTP upstream.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { prepareAiCenter } from './ai-center-fixture.mjs';
import { readDatabaseEnvironment, withDatabase } from '../database/connection.mjs';

export const waitForWorkflowGate = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned workflow gate not reached')), 15000); })]); }
  finally { clearTimeout(timer); }
};
export const workflowDeferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

export async function createWorkflowRuntimeFixture(task, options = {}) {
  assert.ok(['AF-206', 'AF-207', 'AF-217', 'AF-228', 'AF-229', 'AF-232'].includes(task));
  assert.ok(Object.keys(options).every(k => k === 'testBrowserOrigin'));
  if (options.testBrowserOrigin !== undefined) assert.equal(task, 'AF-217');
  assert.equal(process.env['AIJ_' + task.replace('-', '') + '_ROOT_ACCEPTANCE'], 'true');
  const f = await createRemainingClientFixture(task, { workbenchTargetSafety: true, configuration: true, secrets: true, runtimeManagement: true, pluginManagement: true, realPluginLifecycle: true, ...options });
  let server, peer, closePromise;
  const state = { calls: 0, credentials: 0, mode: 'success', providerGate: null, credentialGate: null };
  const db = operation => withDatabase('test', readDatabaseEnvironment('test', process.env, f.lease.id), operation, { acceptanceId: f.lease.id });
  const sqlRefused = async (sql, values, expected) => {
    const code = await db(async c => { try { await c.query(sql, values); return null; } catch (e) { return /^[0-9A-Z]{5}$/.test(e.code) ? e.code : 'UNKNOWN'; } }); assert.equal(code, expected);
  };
  const close = () => closePromise ??= (async () => {
    state.providerGate?.release.resolve(); state.credentialGate?.release.resolve();
    if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
    if (peer) await peer.close();
    const closure = await f.close(); assert.equal(closure.applicationPools, 0); assert.equal(closure.ownedSockets, 0);
    return { ...closure, providerClosed: !server?.listening, peerClosed: true };
  })();
  try {
    const module = f.requireApi;
    const { AiPersonalWorkflowPublicationService } = module('plugins/aij-ai/ai-personal-workflow-publication.service.js');
    const { AiPersonalWorkflowRunsService, WorkflowRunDriver } = module('plugins/aij-ai/ai-personal-workflow-runs.service.js');
    const { AiPersonalWorkflowRunOriginService } = module('plugins/aij-ai/ai-personal-workflow-run-origin.service.js');
    const { AiCenterRunService } = module('plugins/aij-ai/ai-center-run.service.js');
    const { JobService } = module('async-runtime/job.service.js');
    const { ClientAuthGuard } = module('client-auth/client-auth.guard.js');
    const { ClientAuthService } = module('client-auth/client-auth.service.js');
    const { SecretRefPort } = module('secret-center/secret-ref.js');
    const { AiCenterHttpTransport } = module('plugins/aij-ai/ai-center-provider.js');
    const pub = f.app.get(AiPersonalWorkflowPublicationService), runs = f.app.get(AiPersonalWorkflowRunsService), origins = f.app.get(AiPersonalWorkflowRunOriginService), core = f.app.get(AiCenterRunService), jobs = f.app.get(JobService);
    assert.equal(f.app.get(WorkflowRunDriver), core);
    const auth = f.app.get(ClientAuthService), guard = f.app.get(ClientAuthGuard), claims = [];
    const authenticate = async cookie => { const r = { headers: { cookie } }; await guard.canActivate({ switchToHttp: () => ({ getRequest: () => r }) }); return r.clientClaims; };
    for (const cookie of f.cookies) claims.push(await authenticate(cookie));
    const member = f.accounts[0].id, workspace = f.workspaces[0].id, scope = { memberId: member, workspaceId: workspace };
    const gate = tx => auth.assertSessionInTransaction(tx, claims[0]);
    const request = async (method, path, options = {}) => (await f.request(method, path, { cookie: f.cookies[0], workspaceId: workspace, ...options })).data;
    const config = await prepareAiCenter(f), catalog = structuredClone(config.catalog); catalog.providers.forEach(p => { p.liveEnabled = true; });
    await config.save(catalog); process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'true'; process.env.AI_CENTER_LIVE_ENABLED = 'true';
    const skill = await request('POST', 'client/ai/skills', { status: 201, body: { code: 'workflow-skill', name: 'Synthetic Skill', instructions: 'WORKFLOW_PRIVATE_SKILL' } });
    const options = await request('GET', 'client/ai/personal-agents/model-options');
    const content = { name: 'Synthetic Agent', instructions: 'WORKFLOW_PRIVATE_AGENT', enabled: true, modelCode: 'advice-text', modelRevision: options.items.find(m => m.code === 'advice-text').revision,
      catalogVersion: options.catalogVersion, inputFields: ['text'], outputFormat: 'text', outputFields: [], skillBindings: [{ skillId: skill.id, revision: 1 }] };
    const agent = await request('POST', 'client/ai/personal-agents', { status: 201, body: { ...content, code: 'workflow-agent' } });
    const agentMetadata = () => request('GET', `client/ai/personal-agents/${agent.id}/publication`);
    const mutateAgent = async action => { const p = await agentMetadata(); return request('POST', `client/ai/personal-agents/${agent.id}/publication/${action}`, { body: { expectedAgentRevision: p.revision, expectedPublicationVersion: p.publicationVersion } }); };
    await mutateAgent('publish');
    const graph = { schemaVersion: 1, inputKeys: ['text'], nodes: [{ id: 's', type: 'start' }, { id: 'a', type: 'agent', agentId: agent.id, revision: agent.revision }, { id: 'e', type: 'end' }], edges: [{ from: 's', port: 'next', to: 'a', input: 'in' }, { from: 'a', port: 'next', to: 'e', input: 'in' }] };
    const makeWorkflow = async () => {
      const workflow = await request('POST', 'client/ai/personal-workflows', { status: 201, body: { code: 'wf-' + randomUUID(), name: 'WORKFLOW_PRIVATE_NAME', graph } });
      const p = await pub.publish(member, workspace, { workflowId: workflow.id, expectedRevision: 1, expectedPublicationEpoch: 0 }, gate);
      return { workflow, publication: p.publication };
    };
    const initial = await makeWorkflow();
    const metadata = () => pub.read(member, workspace, initial.workflow.id, gate);
    const republish = async () => { const p = await metadata(); return pub.publish(member, workspace, { workflowId: initial.workflow.id, expectedRevision: p.revision, expectedPublicationEpoch: p.publicationEpoch }, gate); };
    const unpublish = async () => { const p = await metadata(); return pub.unpublish(member, workspace, initial.workflow.id, { expectedRevision: p.revision, expectedPublicationEpoch: p.publicationEpoch }, gate); };
    server = createServer(async (req, res) => {
      state.calls++; assert.equal(req.url, '/v1/chat/completions'); assert.equal(req.headers.authorization, 'Bearer ' + config.credential);
      let body = ''; for await (const chunk of req) body += chunk;
      assert.ok(body.includes('WORKFLOW_PRIVATE_AGENT')); assert.ok(body.includes('WORKFLOW_PRIVATE_SKILL'));
      if (state.providerGate) { state.providerGate.entered.resolve(); await state.providerGate.release.promise; }
      if (state.mode === 'lost') { res.destroy(); return; }
      res.setHeader('content-type', 'application/json');
      if (state.mode === 'error') { res.statusCode = 503; res.end('{}'); return; }
      res.end(JSON.stringify({ model: 'synthetic-text-v1', choices: [{ finish_reason: 'stop', message: { content: 'WORKFLOW_SYNTHETIC_OUTPUT' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }));
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    f.app.get(AiCenterHttpTransport).request = async (url, init) => { assert.equal(new URL(url).origin, 'https://api.openai.com'); assert.equal(init.redirect, 'error'); return fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, init); };
    const secrets = f.app.get(SecretRefPort), originalResolve = secrets.resolveTrusted.bind(secrets);
    secrets.resolveTrusted = async (...args) => { state.credentials++; const value = await originalResolve(...args); if (state.credentialGate) { state.credentialGate.entered.resolve(); await state.credentialGate.release.promise; } return value; };
    const counts = async () => ({ runs: await f.prisma.aiAgentRun.count(), jobs: await f.prisma.runtimeJob.count(), origins: await f.prisma.aiPersonalWorkflowRunOrigin.count(), reservations: await f.prisma.aiEvaluationBudgetReservation.count(), traces: await f.prisma.aiExecutionTrace.count(), calls: state.calls, credentials: state.credentials });
    const submit = async (extra = {}, identity = claims[0]) => runs.submit(member, workspace, { publicationId: (await metadata()).publication.id, input: { text: 'WORKFLOW_SYNTHETIC_INPUT' }, idempotencyKey: 'wf-' + randomUUID(), ...extra }, identity);
    const claim = async () => { const rows = await jobs.claim('workflow-owned-worker', 1, 60000); assert.equal(rows.length, 1); return rows[0]; };
    const execute = async () => { const job = await claim(); await jobs.execute(job); return job; };
    const ownerRole = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: workspace, code: 'OWNER' } } });
    const grant = code => f.prisma.clientWorkspaceRolePermission.findFirstOrThrow({ where: { roleId: ownerRole.id, permission: { code } } });
    const setGrant = async (code, enabled) => { const g = await grant(code); await f.prisma.clientWorkspaceRolePermission.update({ where: { id: g.id }, data: { deletedAt: enabled ? null : new Date() } }); };
    const loginAgain = async () => {
      const stored = JSON.parse(readFileSync(f.accounts[0].initialPasswordFile, 'utf8')).accounts.find(a => a.id === member);
      const login = await f.request('POST', 'client/auth/login', { body: { email: f.accounts[0].email, password: stored.password } });
      const cookie = login.response.headers.get('set-cookie').split(';')[0]; return { cookie, claims: await authenticate(cookie) };
    };
    const peerCore = async () => { if (!peer) { const { createApplication } = module('bootstrap.js'); peer = await createApplication(); await peer.init(); } return peer.get(AiCenterRunService); };
    return { ...f, close, db, sqlRefused, state, claims, auth, core, jobs, runs, origins, pub, member, workspace, scope, gate, request,
      agent, skill, content, graph, workflow: initial.workflow, makeWorkflow, metadata, republish, unpublish, mutateAgent, counts, submit, claim, execute, setGrant, loginAgain, peerCore };
  } catch (e) { await close(); throw e; }
}
