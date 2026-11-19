// Root-only synthetic wire over the unchanged production transport and owners.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const ROOT = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
export const OFFICIAL_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
let occupied = false;
const fail = code => { throw new Error(`AF198_${code}`); };
export function validateRuntimeOptions(options) {
  if (!options || !['AF-198', 'AF-191', 'AF-215'].includes(options.task) ||
      options.transport !== 'AiCenterHttpTransport:owned-loopback' || options.concurrency !== 1 || options.freshLease !== true ||
      Object.keys(options).some(k => !['task', 'transport', 'concurrency', 'freshLease', 'browserOrigin'].includes(k))) fail('OPTIONS_REJECTED');
  if (options.browserOrigin !== undefined) {
    let origin;
    try { origin = new URL(options.browserOrigin); } catch { fail('OPTIONS_REJECTED'); }
    if (options.task !== 'AF-191' || origin.origin !== options.browserOrigin || origin.protocol !== 'http:' ||
        origin.hostname !== '127.0.0.1' || !origin.port || Number(origin.port) < 1024 || origin.username || origin.password) fail('OPTIONS_REJECTED');
  }
  return options.task;
}
export function actorUrl(base, raw) {
  if (typeof raw !== 'string' || !raw.startsWith(base + '/client/') || /[\\#\s]/.test(raw)) fail('ACTOR_URL_REJECTED');
  const url = new URL(raw);
  if (url.href !== raw || url.origin !== new URL(base).origin || !url.pathname.startsWith('/api/client/') || /%2e|%2f|%5c/i.test(raw)) fail('ACTOR_URL_REJECTED');
  return url.href;
}
export function forwardTarget(raw, init, upstreamOrigin, apiBase) {
  if (raw === OFFICIAL_ENDPOINT && init?.method === 'POST' && init?.redirect === 'error') return upstreamOrigin + '/v1/chat/completions';
  if (typeof raw === 'string' && raw.startsWith(apiBase + '/')) {
    const u = new URL(raw);
    if (u.href === raw && u.origin === new URL(apiBase).origin && u.pathname.startsWith('/api/') && !u.hash && !u.username && !u.password) return raw;
  }
  fail('FETCH_DESTINATION_REJECTED');
}
function rootOnly(task) {
  assert.equal(process.env[`AIJ_${task.replace('-', '')}_ROOT_ACCEPTANCE`], 'true', 'AF198_ROOT_OPT_IN_REQUIRED');
  assert.equal(resolve(process.cwd()), ROOT, 'AF198_ROOT_ONLY');
  const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(resolve(ROOT, git(['rev-parse', '--git-dir'])), resolve(ROOT, git(['rev-parse', '--git-common-dir'])), 'AF198_MAIN_WORKTREE_REQUIRED');
  assert.equal(git(['branch', '--show-current']), 'dev', 'AF198_DEV_REQUIRED');
}

export async function startWorkbenchTargetRuntime(options) {
  const task = validateRuntimeOptions(options);
  rootOnly(task);
  if (occupied) fail('RUNTIME_BUSY');
  occupied = true;
  const environment = { ...process.env }, capturedFetch = globalThis.fetch;
  let f, server, transport, originalRequest, prototypeRequest, closePromise, activePump;
  let closed = false, upstream = 0, submits = 0, forwarded = 0, rejected = 0, relayFetch, countSubmit;
  const sockets = new Set();
  const replaceEnvironment = () => { for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, environment); };
  const available = () => { if (closed) fail('RUNTIME_CLOSED'); };
  const transportEvidence = () => ({ unchanged: Boolean(transport) && transport.request === originalRequest && Object.getPrototypeOf(transport)?.request === prototypeRequest,
    ownOverride: transport ? Object.hasOwn(transport, 'request') : false, forwarded, upstream, rejected });
  const close = () => closePromise ??= (async () => {
    closed = true;
    const errors = [];
    let pools;
    try {
      try { await activePump; } catch { errors.push('PUMP'); }
      try { if (f) { if (countSubmit) f.app.getHttpServer().removeListener('request', countSubmit); pools = await f.close(); } } catch { errors.push('APPLICATION'); }
      try {
        if (server?.listening) {
          const done = new Promise((yes, no) => server.close(e => e ? no(e) : yes()));
          for (const socket of sockets) socket.destroy();
          await done;
          await new Promise(yes => setImmediate(yes));
        }
      } catch { errors.push('SERVER'); }
    } finally { globalThis.fetch = capturedFetch; replaceEnvironment(); occupied = false; }
    const environmentRestored = Object.keys(process.env).length === Object.keys(environment).length
      && Object.entries(environment).every(([key, value]) => process.env[key] === value);
    if (!environmentRestored) errors.push('ENVIRONMENT');
    if (f && (pools?.applicationPools0 !== true || pools?.ownedSockets0 !== true)) errors.push('POOL_EVIDENCE');
    if (sockets.size || server?.listening) errors.push('SOCKETS');
    if (errors.length) fail('CLOSE_' + errors.join('_'));
    const evidence = { applicationPools0: pools?.applicationPools0 === true, ownedSockets0: sockets.size === 0 && !server?.listening,
      fetchRestored: globalThis.fetch === capturedFetch, environmentRestored, transport: transportEvidence() };
    if (f) await writeFile(join(f.artifactDirectory, 'af198-close.json'), JSON.stringify(evidence), { mode: 0o600, flag: 'wx' });
    return evidence;
  })();
  try {
    // A root-owned shared fix must guarantee cleanup even before this call returns.
    const shared = await import('./remaining-client-fixture.mjs');
    if (shared.workbenchTargetSafetyVersion !== 1) fail('ROOT_WIRING_REQUIRED');
    f = await shared.createRemainingClientFixture(task, { configuration: true, secrets: true, runtimeManagement: true, realPluginLifecycle: true, workbenchTargetSafety: true,
      ...(options.browserOrigin === undefined ? {} : { testBrowserOrigin: options.browserOrigin }) });
    assert.equal(f.lease.task, task);
    assert.match(f.lease.database, new RegExp(`^aij_foundation_${task.toLowerCase().replace('-', '')}_test_[a-f0-9]{16}$`));
    assert.equal(typeof f.artifactDirectory, 'string', 'AF198_PRIVATE_ARTIFACT_DIRECTORY_REQUIRED');
    await mkdir(f.artifactDirectory, { recursive: true, mode: 0o700 });
    const { prepareAiCenter } = await import('./ai-center-fixture.mjs');
    const ai = await prepareAiCenter(f);
    const { AiCenterHttpTransport } = f.requireApi('plugins/aij-ai/ai-center-provider.js');
    transport = f.app.get(AiCenterHttpTransport);
    originalRequest = transport.request; prototypeRequest = AiCenterHttpTransport.prototype.request;
    assert.equal(originalRequest, prototypeRequest); assert.equal(Object.hasOwn(transport, 'request'), false);
    server = createServer(async (req, res) => {
      try {
        if (req.method !== 'POST' || req.url !== '/v1/chat/completions' || req.headers.authorization !== 'Bearer ' + ai.credential) fail('WIRE_REJECTED');
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 65536) fail('WIRE_SIZE'); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Array.isArray(body.messages) || body.model !== 'synthetic-text-v1' || body.stream !== false) fail('WIRE_BODY');
        upstream++;
        res.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
        res.end(JSON.stringify({ model: body.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic goal completed.' } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }));
      } catch { res.writeHead(503, { 'content-type': 'application/json', connection: 'close' }); res.end('{}'); }
    });
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
    const upstreamOrigin = `http://127.0.0.1:${server.address().port}`;
    relayFetch = (url, init) => {
      let target;
      try { target = forwardTarget(url, init, upstreamOrigin, f.baseUrl); } catch (e) { rejected++; throw e; }
      if (url === OFFICIAL_ENDPOINT) forwarded++;
      return capturedFetch(target, { ...init, redirect: 'error' });
    };
    globalThis.fetch = relayFetch;
    const catalog = structuredClone(ai.catalog);
    catalog.providers = [catalog.providers[0]]; catalog.providers[0].liveEnabled = true;
    catalog.models = [catalog.models[0]]; catalog.skills = [];
    catalog.agents = [{ ...catalog.agents[0], code: 'general-text', name: 'Synthetic goal', skillCodes: [], inputFields: ['goal'], instructions: 'Complete the supplied synthetic goal.' }];
    await ai.save(catalog);
    process.env.AI_CENTER_LIVE_ENABLED = 'true'; process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'true';
    const second = (await f.request('POST', 'client/workspaces', { cookie: f.cookies[0], body: { name: 'Synthetic second space', idempotencyKey: 'af198-second' }, status: 201 })).data;
    const grants = await f.prisma.clientWorkspacePermission.findMany({ where: { code: { in: ['workspace.context.read', 'workspace.ai.read'] } }, select: { id: true } });
    assert.equal(grants.length, 2);
    const role = await f.prisma.clientWorkspaceRole.create({ data: { workspaceId: f.workspaces[0].id, code: 'AF198_READER', name: 'Synthetic reader', rolePermissions: { create: grants.map(g => ({ permissionId: g.id })) } } });
    await f.prisma.clientWorkspaceMembership.create({ data: { workspaceId: f.workspaces[0].id, memberId: f.accounts[1].id, roleId: role.id } });
    const emptyRole = await f.prisma.clientWorkspaceRole.create({ data: { workspaceId: f.workspaces[0].id, code: 'AF198_NO_GRANTS', name: 'Synthetic no grants' } });
    const third = { id: randomUUID(), email: `af198-denied-${f.lease.id}@example.test`, password: 'C9-' + randomBytes(24).toString('hex') };
    const require = createRequire(join(ROOT, 'apps/api/package.json'));
    await f.prisma.memberUser.create({ data: { id: third.id, email: third.email, username: 'af198-denied-' + f.lease.id, nickname: 'Synthetic denied', passwordHash: await require('bcryptjs').hash(third.password, 12) } });
    await f.prisma.clientWorkspaceMembership.create({ data: { workspaceId: f.workspaces[0].id, memberId: third.id, roleId: emptyRole.id } });
    const deniedLogin = await f.request('POST', 'client/auth/login', { body: { email: third.email, password: third.password } });
    const deniedCookie = deniedLogin.response.headers.get('set-cookie').split(';')[0];
    // Count the real HTTP request arriving at the App, including a later
    // browser/proxy caller. Counting only this fixture's fetch wrapper would
    // miss the original workbench's POST.
    countSubmit = req => { if (req.method === 'POST' && /^\/api\/client\/ai\/agents\/[^/?]+\/runs(?:\?|$)/.test(req.url ?? '')) submits++; };
    f.app.getHttpServer().prependListener('request', countSubmit);
    const { JobService } = f.requireApi('async-runtime/job.service.js'), jobs = f.app.get(JobService);
    const fetchAsActor = (actor, url, init = {}, nativeFetch = capturedFetch) => {
      available(); actorUrl(f.baseUrl, url);
      if (![capturedFetch, relayFetch].includes(nativeFetch) || !['owner', 'other', 'other-member', 'no-permission', 'anonymous', null].includes(actor)) fail('ACTOR_REJECTED');
      const headers = new Headers(init.headers);
      headers.delete('authorization'); headers.delete('cookie');
      if (actor === 'no-permission') headers.set('cookie', deniedCookie);
      else if (actor !== null && actor !== 'anonymous') headers.set('cookie', f.cookies[actor === 'owner' ? 0 : 1]);
      headers.set('origin', options.browserOrigin ?? process.env.WEB_URL); headers.set('connection', 'close');
      return nativeFetch(url, { ...init, headers, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(15000) });
    };
    const request = async ({ actor = 'owner', method = 'GET', path, workspaceId = f.workspaces[0].id, body }) => {
      const response = await fetchAsActor(actor, f.baseUrl + '/' + path.replace(/^\//, ''), { method,
        headers: { 'x-aij-workspace-id': workspaceId, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    };
    return {
      task, approvedLeaseTask: f.lease.task, acceptanceId: f.lease.id, projectId: f.project.id,
      workspaceId: f.workspaces[0].id, memberId: f.accounts[0].id, agentCode: 'general-text', apiBaseUrl: f.baseUrl, artifactDirectory: f.artifactDirectory,
      workspaceIds: { primary: f.workspaces[0].id, second: second.id, other: f.workspaces[1].id },
      request, fetchAsActor, transportEvidence, close,
      async loginCredentials(actor) {
        available();
        if (actor === 'no-permission') return { email: third.email, password: third.password };
        if (!['owner', 'other-member'].includes(actor)) fail('ACTOR_REJECTED');
        const account = f.accounts[actor === 'owner' ? 0 : 1];
        const saved = JSON.parse(await readFile(account.initialPasswordFile, 'utf8')).accounts.find(a => a.id === account.id);
        return { email: account.email, password: saved.password }; // RAM only; never evidence/console.
      },
      async withOwnerReadOnly(action) {
        available();
        const membership = await f.prisma.clientWorkspaceMembership.findUniqueOrThrow({ where: { workspaceId_memberId: { workspaceId: f.workspaces[0].id, memberId: f.accounts[0].id } } });
        await f.prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { roleId: role.id } });
        try { return await action(); } finally { await f.prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { roleId: membership.roleId } }); }
      },
      async withOwnerNoRead(action) {
        available(); assert.equal(task, 'AF-191');
        const membership = await f.prisma.clientWorkspaceMembership.findUniqueOrThrow({ where: { workspaceId_memberId: { workspaceId: f.workspaces[0].id, memberId: f.accounts[0].id } } });
        await f.prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { roleId: emptyRole.id } });
        try { return await action(); } finally { await f.prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { roleId: membership.roleId } }); }
      },
      async revokeOwnerSessions() {
        available();
        const result = await f.prisma.clientAuthSession.updateMany({ where: { memberId: f.accounts[0].id, status: 'active' }, data: { status: 'revoked', revokedAt: new Date(), revokeReason: 'AF198_SYNTHETIC_TEST' } });
        assert.ok(result.count >= 1);
      },
      async verifyTransportFence() {
        available(); const before = upstream;
        await assert.rejects(async () => transport.request('https://api.openai.com/v1/not-allowed', { method: 'POST', redirect: 'error' }), /AF198_FETCH_DESTINATION_REJECTED/);
        assert.equal(upstream, before); assert.equal(transportEvidence().unchanged, true);
        return transportEvidence();
      },
      async counters() {
        available(); return { runs: await f.prisma.aiAgentRun.count({ where: { projectId: f.project.id } }),
          jobs: await f.prisma.runtimeJob.count({ where: { scopeId: f.project.id, jobType: 'aij-ai.agent-execute' } }),
          traces: await f.prisma.aiExecutionTrace.count({ where: { projectId: f.project.id } }), upstream, submits };
      },
      async databaseSnapshot(runId) {
        available(); const run = await f.prisma.aiAgentRun.findFirstOrThrow({ where: { id: runId, projectId: f.project.id }, select: { id: true, projectId: true, agentCode: true, estimatedCostNanos: true, jobId: true, status: true, budgetStatus: true, workspaceId: true, memberId: true } });
        const job = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: run.jobId }, select: { id: true, scopeId: true, workspaceId: true, jobType: true, status: true, attempts: true, maxAttempts: true } });
        const traces = await f.prisma.aiExecutionTrace.findMany({ where: { jobId: run.jobId }, select: { id: true, projectId: true, jobId: true, attempt: true, status: true, costSource: true, costAmountNanos: true } });
        const source = await f.prisma.$queryRaw`SELECT COALESCE(snapshot#>>'{source,type}','catalog') AS kind FROM public.ai_agent_run WHERE id=${runId} AND project_id=${f.project.id}`;
        return { run: { ...run, estimatedCostNanos: String(run.estimatedCostNanos), sourceType: source[0].kind }, job, traces, trace: traces[0] ?? null };
      },
      async pumpJobs() {
        available(); if (activePump) fail('PUMP_BUSY');
        activePump = (async () => {
          const claims = await jobs.claim(`${task}:${f.lease.id}`, 1, 60000);
          for (const claim of claims) { assert.equal(claim.scope_id, f.project.id); assert.equal(claim.job_type, 'aij-ai.agent-execute'); await jobs.execute(claim); }
          return claims.map(c => c.id);
        })();
        try { return await activePump; } finally { activePump = undefined; }
      }
    };
  } catch (error) {
    try { await close(); } catch { fail('START_FAILED_CLEANUP_FAILED'); }
    if (/^AF198_[A-Z_]+$/.test(error?.message)) throw error;
    fail('START_FAILED');
  }
}
