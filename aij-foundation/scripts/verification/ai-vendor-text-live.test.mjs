// ROOT ONLY: a fresh AF-150 lease, protected isolated PostgreSQL, real API/Job/Trace.
// Run after root registers AF-150 in the shared acceptance/auth/seed allowlists.
// AIJ_AF150_ROOT_ACCEPTANCE=true node --test --test-concurrency=1 scripts/verification/ai-vendor-text-live.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {readDatabaseEnvironment,withDatabase} from '../database/connection.mjs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { createRemainingClientFixture } from './remaining-client-fixture.mjs';
import { prepareAiCenter } from './ai-center-fixture.mjs';

const ROOT = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
function rootOnly() {
  assert.equal(process.env.AIJ_AF150_ROOT_ACCEPTANCE, 'true', 'AF150 root acceptance opt-in required');
  assert.equal(resolve(process.cwd()), ROOT, 'AF150 may run only in the coordinator main worktree');
  const git = flag => resolve(ROOT, execFileSync('git', ['rev-parse', flag], { encoding: 'utf8', cwd: ROOT }).trim());
  assert.equal(git('--git-dir'), git('--git-common-dir'), 'AF150 child worktree cannot run database acceptance');
  assert.equal(execFileSync('git',['branch','--show-current'],{cwd:ROOT,encoding:'utf8'}).trim(),'dev');
}
const OFFICIAL = new Map([
  ['https://api.deepseek.com/v1/chat/completions', 'deepseek-flash'],
  ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen3.8-max']
]);

test('AF150 first-party text/JSON uses existing Run/Job/Trace/budget over synthetic HTTP and fresh isolated DB', { timeout: 360000 }, async t => {
  rootOnly();
  const f = await createRemainingClientFixture('AF-150', { configuration: true, secrets: true, runtimeManagement: true });
  let server, transport, transportDescriptor, version = 0, calls = 0, mode = 'success', deniedTransports = 0, ai;
  const http = globalThis.fetch; // Never patch global fetch, URL policy, service prototypes or the provider executor.
  const opt = { cookie: f.cookies[0], workspaceId: f.workspaces[0].id };
  const input = { selfType: 'AF150 synthetic@example.test sk-syntheticPrompt', buddyType: 'Synthetic buddy' };
  const submit = (key, agent = 'aliyun-text', status = 202, extra = {}) => f.request('POST', `client/ai/agents/${agent}/runs`, { ...opt, ...extra, body: { idempotencyKey: key, input }, status });
  const read = id => f.request('GET', `client/ai/runs/${id}`, opt).then(r => r.data);
  const { JobService } = f.requireApi('async-runtime/job.service.js'), jobs = f.app.get(JobService);
  const execute = async () => { const rows = await jobs.claim('af150:' + f.lease.id, 1, 60000); assert.equal(rows.length, 1); await jobs.execute(rows[0]); return rows[0]; };
  let c;
  let traceCount=0,runCount=0;
  const save = async (next = c, status = 200) => { const result = await ai.save(next, version, status); if (status === 200) { version = result.data.version; c = result.data.catalog; } return result; };
  try {
    assert.equal(f.lease.task, 'AF-150'); assert.match(f.lease.database, /^aij_foundation_af150_test_[a-f0-9]{16}$/);
    ai = await prepareAiCenter(f);
    const model = ai.catalog.models[0], provider = ai.catalog.providers[0], agent = ai.catalog.agents[0];
    c = { ...ai.catalog, providers: ['deepseek', 'aliyun'].map(vendor => ({ ...provider, code: vendor, name: `AF150 ${vendor}`, vendor,
      baseUrl: vendor === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://dashscope.aliyuncs.com/compatible-mode/v1', enabled: false, liveEnabled: false })),
      models: ['deepseek', 'aliyun'].map(vendor => ({ ...model, code: vendor + '-model', providerCode: vendor, upstreamModel: vendor === 'deepseek' ? 'deepseek-flash' : 'qwen3.8-max', tokenParameter: vendor === 'deepseek' ? 'max_tokens' : 'max_completion_tokens' })), skills: [],
      agents: ['deepseek', 'aliyun'].flatMap(vendor => ['text', 'json'].map(format => ({ ...agent, code: `${vendor}-${format}`, name: `AF150 ${vendor} ${format}`, modelCode: vendor + '-model', skillCodes: [], instructions: 'Give only the final synthetic answer. Do not use tools.', outputFormat: format, outputFields: format === 'json' ? ['answer'] : [], enabled: false, published: false }))) };
    await save();
    server = createServer(async (req, res) => {
      try {
        calls += 1;
        assert.equal(req.method, 'POST'); assert.equal(req.headers.authorization, 'Bearer ' + ai.credential);
        const official = [...OFFICIAL].find(([url]) => new URL(url).pathname === req.url); assert.ok(official);
        let raw = ''; for await (const chunk of req) { raw += chunk; assert.ok(Buffer.byteLength(raw) <= 65536); }
        const body = JSON.parse(raw), aliyun = official[1] === 'qwen3.8-max';
        assert.equal(body.model, official[1]); assert.equal(body.stream, false);
        assert.equal(body[aliyun ? 'max_completion_tokens' : 'max_tokens'], 1024);
        assert.deepEqual(Object.keys(body).sort(), ['model', 'messages', aliyun ? 'max_completion_tokens' : 'max_tokens', 'stream', aliyun ? 'enable_thinking' : 'thinking', ...(body.response_format ? ['response_format'] : [])].sort());
        if (aliyun) assert.equal(body.enable_thinking, false); else assert.deepEqual(body.thinking, { type: 'disabled' });
        assert.equal(JSON.stringify(body).includes('synthetic@example.test'), false); assert.equal(JSON.stringify(body).includes('sk-syntheticPrompt'), false);
        res.setHeader('content-type', 'application/json');
        if (mode === 'http-error') { res.statusCode = 503; res.end('{"error":{"message":"sensitive upstream detail"}}'); return; }
        if (mode === 'redirect') { res.statusCode = 302; res.setHeader('location', 'http://127.0.0.1:1/forbidden'); res.end('{}'); return; }
        if (mode === 'malformed') { res.end('{invalid'); return; }
        if (mode === 'oversized') { res.end('x'.repeat(256 * 1024 + 1)); return; }
        const p = { model: body.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: body.response_format ? '{"answer":"Final synthetic answer"}' : 'Final synthetic answer', reasoning_content: 'AF150_PRIVATE_REASONING_NEVER_PERSIST' } }],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, ...(aliyun ? { prompt_tokens_details: { cached_tokens: 2 } } : { prompt_cache_hit_tokens: 2, prompt_cache_miss_tokens: 18 }) } };
        if (mode === 'length') p.choices[0].finish_reason = 'length';
        if (mode === 'tools') p.choices[0].message.tool_calls = [{ function: { name: 'forbidden' } }];
        if (mode === 'unknown-model') p.model = 'unknown-upstream';
        if (mode === 'missing-usage') delete p.usage;
        if (mode === 'bad-cache') p.usage.prompt_tokens_details = { cached_tokens: 21 };
        if (mode === 'bad-json') p.choices[0].message.content = '{"answer":1}';
        res.end(JSON.stringify(p));
      } catch { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{}'); }
    });
    await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
    const { AiCenterHttpTransport } = f.requireApi('plugins/aij-ai/ai-center-provider.js'); transport = f.app.get(AiCenterHttpTransport);
    transportDescriptor = Object.getOwnPropertyDescriptor(transport, 'request');
    // This application instance ONLY. No passthrough path exists to the real vendor.
    transport.request = async (url, init) => {
      if (!OFFICIAL.has(url) || init.method !== 'POST' || init.redirect !== 'error') { deniedTransports += 1; throw new Error('AF150_TRANSPORT_DENIED'); }
      return http(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, { ...init, redirect: 'error' });
    };
    await t.test('fresh disabled catalog, HTTP auth, owned SecretRef, strict vendor/base/model and client input', async () => {
      await f.request('GET', 'admin/ai/center/configuration', { status: 401 });
      const admin = await f.prisma.sysUser.findFirstOrThrow({ where: { isSuperAdmin: true } });
      await f.prisma.sysUser.update({ where: { id: admin.id }, data: { isSuperAdmin: false } });
      try { await f.request('GET', 'admin/ai/center/configuration', { token: ai.token, status: 403 }); }
      finally { await f.prisma.sysUser.update({ where: { id: admin.id }, data: { isSuperAdmin: true } }); }
      await f.request('GET', 'client/ai/agents', { workspaceId: opt.workspaceId, status: 401 });
      await submit('af150-client-off', 'aliyun-text', 503);
      process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = 'true';
      await submit('af150-disabled', 'aliyun-text', 404);
      for (const mutate of [x => x.providers[1].vendor = 'unknown', x => x.providers[1].baseUrl = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', x => x.models[1].tokenParameter = 'max_tokens', x => x.models[1].capability = 'image', x => x.models[1].upstreamModel = 'unverified-stream-only', x => x.providers[1].credentialRef = 'env://AIJ_SECRET_OTHER_PROJECT_TEST_PROVIDER']) {
        const bad = structuredClone(c); mutate(bad); await save(bad, bad.providers[1].credentialRef !== ai.ref ? 403 : 400);
      }
      assert.equal(calls, 0); assert.equal(await f.prisma.aiAgentRun.count(), 0);
      for (const p of c.providers) p.enabled = true;
      for (const a of c.agents) { a.enabled = true; a.published = true; }
      await save(); await submit('af150-root-off', 'aliyun-text', 503);
      process.env.AI_CENTER_LIVE_ENABLED = 'true'; await submit('af150-provider-off', 'aliyun-text', 503);
      for (const p of c.providers) p.liveEnabled = true; await save();
      await f.request('POST', 'client/ai/agents/aliyun-text/runs', { ...opt, body: { idempotencyKey: 'af150-extra-input', input: { ...input, model: 'forged' } }, status: 400 });
      await submit('af150-origin-off', 'aliyun-text', 403, { origin: 'https://foreign.invalid' });
      await submit('af150-cross-workspace', 'aliyun-text', 403, { workspaceId: f.workspaces[1].id });
    });
    await t.test('DeepSeek triple confirmation remains mandatory through compatible aliases', async () => {
      const next = structuredClone(c); next.providers[0].vendor = 'compatible'; await save(next);
      for (const key of ['AI_DEEPSEEK_LIVE_ENABLED', 'AI_DEEPSEEK_UPSTREAM_CONFIRMED', 'AI_DEEPSEEK_DATA_CLASS']) {
        Object.assign(process.env, { AI_DEEPSEEK_LIVE_ENABLED: 'true', AI_DEEPSEEK_UPSTREAM_CONFIRMED: 'true', AI_DEEPSEEK_DATA_CLASS: 'synthetic-or-deidentified' });
        delete process.env[key]; await submit('af150-denied-' + key, 'deepseek-text', 503);
      }
      Object.assign(process.env, { AI_DEEPSEEK_LIVE_ENABLED: 'true', AI_DEEPSEEK_UPSTREAM_CONFIRMED: 'true', AI_DEEPSEEK_DATA_CLASS: 'synthetic-or-deidentified' });
      c.providers[0].vendor = 'deepseek'; await save(); assert.equal(calls, 0);
    });
    await t.test('each vendor text and JSON has one durable Job/Trace, usage, reservation and idempotent call', async () => {
      for (const vendor of ['deepseek', 'aliyun']) for (const format of ['text', 'json']) {
        const before = calls, code = `${vendor}-${format}`;
        const [first, replay] = await Promise.all([submit('af150-success-' + code, code), submit('af150-success-' + code, code)]); assert.equal(first.data.id, replay.data.id);
        const claim = await execute(); await jobs.execute(claim); const result = await read(first.data.id);
        assert.equal(calls, before + 1); assert.equal(result.status, 'succeeded'); assert.equal(result.budgetStatus, 'settled'); assert.equal(result.estimatedCostNanos, '40000');
        assert.deepEqual(result.output, format === 'json' ? { answer: 'Final synthetic answer' } : 'Final synthetic answer');
        const trace = await f.prisma.aiExecutionTrace.findUniqueOrThrow({ where: { jobId_attempt: { jobId: claim.id, attempt: 1 } } });
        assert.equal(trace.providerCode, vendor); assert.equal(trace.modelCode, vendor + '-model'); assert.equal(trace.promptTokens, 20); assert.equal(trace.completionTokens, 10); assert.equal(trace.cachedTokens, 2);
        assert.equal(trace.costSource, 'unreported'); assert.equal(trace.costAmountNanos, null);
        const reservation = await f.prisma.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: first.data.id } }); assert.equal(reservation.status, 'settled'); assert.equal(reservation.chargedNanos, 40000n);
        await f.request('GET', `client/ai/runs/${first.data.id}`, { cookie: f.cookies[1], workspaceId: f.workspaces[1].id, status: 404 });
      }
    });
    await t.test('a queued provider disable prevents transport and releases unused reservation', async () => {
      const queued = (await submit('af150-disable-before-start')).data, before = calls;
      c.providers[1].liveEnabled = false; await save(); await execute();
      const result = await read(queued.id); assert.equal(result.status, 'failed'); assert.equal(result.budgetStatus, 'released'); assert.equal(calls, before);
      c.providers[1].liveEnabled = true; await save();
    });
    await t.test('invalid/ambiguous vendor results retain reservation and cannot retry or fallback', async () => {
      for (const vendor of ['deepseek', 'aliyun']) for (const next of ['http-error', 'redirect', 'malformed', 'oversized', 'length', 'tools', 'unknown-model', 'missing-usage', 'bad-cache', 'bad-json']) {
        mode = next; const before = calls, run = (await submit(`af150-invalid-${vendor}-${next}`, vendor + '-json')).data;
        const claim = await execute(); const result = await read(run.id);
        assert.equal(result.status, 'unknown'); assert.equal(result.budgetStatus, 'reserved'); assert.ok(BigInt(result.estimatedCostNanos) > 0n); assert.equal(result.output, null);
        await jobs.execute(claim); await jobs.retry(claim.id).catch(() => undefined);
        const retry = await jobs.claim('af150:' + f.lease.id, 1, 60000); for (const job of retry) await jobs.execute(job);
        assert.equal(calls, before + 1);
      }
      mode = 'success';
    });
    await t.test('workspace budget admission denies before Job/transport and audit/Trace never persist reasoning or credentials', async () => {
      c.workspaceMonthlyBudgetNanos = '1'; await save(); const before = calls; await submit('af150-budget-denied', 'aliyun-text', 429); assert.equal(calls, before);
      const traces = await f.prisma.aiExecutionTrace.findMany(), audits = await f.prisma.auditLog.findMany(), runs = await f.prisma.aiAgentRun.findMany();
      const operational = JSON.stringify({ traces, audits, runs }, (_, value) => typeof value === 'bigint' ? value.toString() : value);
      for (const secret of [ai.credential, 'AF150_PRIVATE_REASONING_NEVER_PERSIST', 'synthetic@example.test', 'sk-syntheticPrompt']) assert.equal(operational.includes(secret), false);
      assert.equal(deniedTransports, 0); assert.equal(globalThis.fetch, http);
      traceCount=traces.length;runCount=runs.length;
    });
  } finally {
    try {
      if (transport) { if (transportDescriptor) Object.defineProperty(transport, 'request', transportDescriptor); else delete transport.request; }
      if (server) { server.closeAllConnections(); if (server.listening) await new Promise((yes, no) => server.close(error => error ? no(error) : yes())); }
    } finally { await f.close(); }
    const pools=await withDatabase('test',readDatabaseEnvironment('test',process.env,f.lease.id),async db=>(await db.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows[0].count,{acceptanceId:f.lease.id});
    assert.equal(pools,0);
    const folder=join(ROOT,'.artifacts/auto-ai-program-20261105/AF-150');mkdirSync(folder,{recursive:true,mode:0o700});
    writeFileSync(join(folder,'live-'+f.lease.id+'.json'),JSON.stringify({task:'AF-150',acceptanceId:f.lease.id,database:f.lease.database,applicationPools:pools,upstreamCalls:calls,deniedTransports,traceCount,runCount,transportRestored:true,fixtureClosed:true},null,2)+'\n',{mode:0o600});
  }
});
