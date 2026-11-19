// ROOT ONLY / Worker NOT_RUN. Fresh AF-169 registration in database/auth/fixture guards,
// integrated AF161/165/167 schema/module, generated Prisma and fresh compiled API/SDK required.
// This runs actual authorization/admission/JobService/PG/Trace/budget; only upstream HTTP is synthetic.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { publishPersonalAgentFixture } from './personal-agent-publication-fixture.mjs';
import { createPersonalAgentRun, personalJournalKey, parsePersonalJournal } from "../../apps/web/app/components/client-personal-agent-run-state.mjs";
import { createClientApi, createAiClient, createAiRunRecoveryClient, createPersonalAgentRunPreviewsClient, createPersonalAgentRunsClient, createPersonalAgentsClient } from "../../packages/sdk/dist/index.mjs";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function storage() { const data = new Map(); return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) }; }
function locks() { const pending = new Map(); return (key, fn) => { const next = (pending.get(key) ?? Promise.resolve()).then(fn); pending.set(key, next.catch(() => {})); return next; }; }

test("AF-169 fresh actual HTTP/PG/JobService/compiled SDK+state with explicit Memory, lost response, original-key recovery and scope fences", { timeout: 360000 }, async () => {
  assert.equal(process.env.AIJ_AF169_ROOT_LIVE, "1", "ROOT_EXPLICIT_LIVE_GATE_REQUIRED");
  const root = "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation";
  assert.equal(resolve(process.cwd()), root, "ROOT_WORKTREE_REQUIRED");
  const git = flag => resolve(root, execFileSync("git", ["rev-parse", flag], { encoding: "utf8" }).trim());
  assert.equal(git("--git-dir"), git("--git-common-dir"));
  assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
  // Imports that can reach databases occur only AFTER the root fences.
  const { createRemainingClientFixture } = await import("./remaining-client-fixture.mjs");
  const { prepareAiCenter } = await import("./ai-center-fixture.mjs");
  const { readDatabaseEnvironment, withDatabase } = await import("../database/connection.mjs");
  const f = await createRemainingClientFixture("AF-169", { configuration: true, secrets: true, runtimeManagement: true, pluginManagement: true, storageEnabled: true, realPluginLifecycle: true });
  assert.equal(f.lease.task, "AF-169"); assert.match(f.lease.database, /af169/i);
  const database = readDatabaseEnvironment("test", process.env, f.lease.id);
  const db = op => withDatabase("test", database, op, { acceptanceId: f.lease.id });
  const proof = { task: "AF-169", acceptanceId: f.lease.id, database: f.lease.database, status: "INCOMPLETE", checks: [] };
  const stores = [], lock = locks(); let upstream, lastBody, upstreamCalls = 0, mode = "text", originalTransport, transport;
  const { JobService } = f.requireApi("async-runtime/job.service.js");
  const { AiCenterHttpTransport } = f.requireApi("plugins/aij-ai/ai-center-provider.js");
  const { AiCenterRunService } = f.requireApi("plugins/aij-ai/ai-center-run.service.js");
  const jobs = f.app.get(JobService);
  assert.equal(Object.getPrototypeOf(jobs), JobService.prototype);
  const api = actor => {
    const client = createClientApi(() => f.baseUrl);
    return (path, options = {}) => client(path, { ...options, headers: { ...options.headers, connection: "close", cookie: f.cookies[actor], origin: process.env.WEB_URL } });
  };
  const owner = api(0), foreign = api(1), workspaceId = f.workspaces[0].id;
  const createAgent = async (request = owner, workspace = workspaceId, format = "text") => {
    const sdk = createPersonalAgentsClient(request), models = await sdk.modelOptions(workspace), model = models.items.find(m => m.code === "advice-text"); assert.ok(model);
    const created = await sdk.create(workspace, { code: "af169-" + randomUUID(), name: "Synthetic AF169 Agent", instructions: "AF169_PRIVATE_INSTRUCTIONS", enabled: true,
      modelCode: model.code, modelRevision: model.revision, catalogVersion: models.catalogVersion, inputFields: ["text"], outputFormat: format, outputFields: format === "json" ? ["answer"] : [], skillBindings: [] });
    return publishPersonalAgentFixture(async (method, path, options) => request('/' + path, { method, workspaceId: workspace,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }), created);
  };
  const makeStore = (agent, request = owner, journalStorage = storage(), extra = {}) => {
    const store = createPersonalAgentRun({ agentId: agent.id, request, journalStorage: () => journalStorage, withRecoveryLock: lock,
      previewsClientFactory: createPersonalAgentRunPreviewsClient, runsClientFactory: createPersonalAgentRunsClient, aiClientFactory: createAiClient,
      recoveryClientFactory: createAiRunRecoveryClient, agentsClientFactory: createPersonalAgentsClient, ...extra });
    stores.push(store); return { store, storage: journalStorage };
  };
  const fill = async store => { await store.start(workspaceId); assert.ok(store.getSnapshot().preview?.modelExecutionConfigured); store.setInput("text", "AF169_SYNTHETIC_INPUT"); store.requestConfirmation(); assert.equal(store.getSnapshot().confirmation, true); };
  const counts = async () => [await f.prisma.aiAgentRun.count(), await f.prisma.runtimeJob.count({ where: { jobType: "aij-ai.agent-execute" } }), await f.prisma.aiEvaluationBudgetReservation.count(), await f.prisma.aiExecutionTrace.count(), upstreamCalls];
  const execute = async () => { const claimed = await jobs.claim("af169-owned-worker", 1, 60000); assert.equal(claimed.length, 1); await jobs.execute(claimed[0]); return claimed[0]; };
  const row = id => f.prisma.aiAgentRun.findUniqueOrThrow({ where: { id } });
  const noWriteHashes = () => db(async c => {
    const result = {};
    // Excludes session last_seen_at. All admission/execution/accounting owners are checked.
    for (const table of ["ai_agent_run", "runtime_job", "ai_evaluation_budget_reservation", "ai_execution_trace"]) {
      const rows = (await c.query('SELECT row_to_json(t)::text AS value FROM public."' + table + '" t')).rows.map(r => r.value).sort();
      result[table] = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    }
    return result;
  });
  try {
    const ai = await prepareAiCenter(f), catalog = structuredClone(ai.catalog); catalog.providers.forEach(p => { p.liveEnabled = true; }); await ai.save(catalog);
    process.env.AI_CENTER_LIVE_ENABLED = "true"; process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = "true";
    upstream = createServer(async (req, res) => {
      upstreamCalls++; let body = ""; for await (const chunk of req) body += chunk; lastBody = JSON.parse(body);
      assert.equal(req.headers.authorization, "Bearer " + ai.credential);
      if (mode === "lost") { req.socket.destroy(); return; }
      res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ model: lastBody.model, choices: [{ finish_reason: "stop", message: { content: mode === "json" ? '{"answer":"AF169_CONSTANT_OUTPUT"}' : "AF169_CONSTANT_OUTPUT" } }], usage: { prompt_tokens: 20, completion_tokens: 10 } }));
    });
    await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
    transport = f.app.get(AiCenterHttpTransport); originalTransport = transport.request;
    transport.request = (url, init) => { assert.equal(url, "https://api.openai.com/v1/chat/completions"); assert.equal(init.redirect, "error"); return fetch(`http://127.0.0.1:${upstream.address().port}/v1/chat/completions`, init); };
    const agent = await createAgent();
    const memory = await owner("/client/ai/personal-memories", { method: "POST", workspaceId, body: JSON.stringify({ code: "af169-" + randomUUID(), title: "AF169_PRIVATE_MEMORY_TITLE", content: "AF169_EXPLICIT_CURRENT_MEMORY", kind: "confirmed_fact", enabled: true, agentIds: [agent.id] }) });
    const disabled = await owner("/client/ai/personal-memories", { method: "POST", workspaceId, body: JSON.stringify({ code: "af169-" + randomUUID(), title: "AF169_DISABLED_MEMORY", content: "AF169_EXCLUDED_MEMORY", kind: "confirmed_fact", enabled: false, agentIds: [agent.id] }) });
    const lostReply = async (path, options) => { const response = await owner(path, options); if (options?.method === "POST" && path.endsWith("/runs")) throw new Error("Synthetic response lost AFTER actual API admission"); return response; };
    const first = makeStore(agent, lostReply); await fill(first.store); const before = await counts();
    await Promise.all([first.store.confirmSubmit(), first.store.confirmSubmit()]);
    assert.deepEqual((await counts()).map((v, i) => v - before[i]), [1, 1, 1, 0, 0]);
    const entry = first.store.getSnapshot().journal; assert.equal(entry.status, "unconfirmed"); assert.equal(first.store.getSnapshot().confirmation, false);
    const admitted = await f.prisma.aiAgentRun.findUniqueOrThrow({ where: { projectId_workspaceId_memberId_idempotencyKey: { projectId: f.project.id, workspaceId, memberId: f.accounts[0].id, idempotencyKey: entry.key } } });
    assert.equal(admitted.snapshot.source.agentId, agent.id); assert.equal(admitted.snapshot.source.revision, agent.revision);
    assert.deepEqual(admitted.snapshot.source.memoryRefs, [{ memoryId: memory.id, revision: memory.revision }]);
    first.store.dispose(); await execute(); const completed = await row(admitted.id); assert.equal(completed.status, "succeeded"); assert.equal(completed.budgetStatus, "settled");
    assert.ok(lastBody.messages.some(m => m.role === "user" && m.content.includes(memory.content))); assert.ok(!JSON.stringify(lastBody).includes(disabled.content));
    assert.equal(await f.prisma.aiExecutionTrace.count({ where: { jobId: completed.jobId, status: "succeeded" } }), 1);
    const reservation = await f.prisma.aiEvaluationBudgetReservation.findUniqueOrThrow({ where: { id: completed.id } }); assert.equal(reservation.status, "settled"); assert.ok(reservation.chargedNanos > 0n);
    const recovered = makeStore(agent, owner, first.storage); const frozen = await noWriteHashes(); await recovered.store.start(workspaceId);
    assert.equal(recovered.store.getSnapshot().run.id, admitted.id); assert.equal(recovered.store.getSnapshot().run.output, "AF169_CONSTANT_OUTPUT"); assert.deepEqual(await noWriteHashes(), frozen);
    assert.equal(upstreamCalls, 1); assert.equal(parsePersonalJournal(first.storage.getItem(personalJournalKey(f.accounts[0].id)), f.accounts[0].id)[0].key, entry.key);
    const raw = first.storage.getItem(personalJournalKey(f.accounts[0].id));
    for (const privateText of ["AF169_SYNTHETIC_INPUT", "AF169_CONSTANT_OUTPUT", agent.name, agent.instructions, memory.title, memory.content, ai.credential]) assert.equal(raw.includes(privateText), false);
    proof.checks.push("one admitted Run/Job/reservation/Trace/call; explicit current Memory only; lost reply -> original GET recovery; journal has no plaintext");

    process.env.AI_CENTER_LIVE_ENABLED = "false"; process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = "false";
    recovered.store.dispose(); const off = makeStore(agent, owner, first.storage); await off.store.start(workspaceId);
    assert.equal(off.store.getSnapshot().run.id, admitted.id); assert.equal(off.store.getSnapshot().preview.modelExecutionConfigured, false); assert.equal(off.store.ready(), false); assert.deepEqual(await noWriteHashes(), frozen);
    proof.checks.push("existing authorized result GET remains no-write with both execution flags off");
    process.env.AI_CENTER_LIVE_ENABLED = "true"; process.env.AI_CENTER_CLIENT_EXECUTION_ENABLED = "true";

    const stableCounts = await counts();
    await assert.rejects(() => createPersonalAgentRunPreviewsClient(owner).preview(workspaceId, agent.id, agent.revision + 1), e => e.status === 409);
    await assert.rejects(() => createPersonalAgentRunsClient(owner).submit(workspaceId, agent.id, { input: { text: "synthetic" }, idempotencyKey: "af169-stale-" + randomUUID(), expectedRevision: agent.revision + 1 }), e => e.status === 409);
    await assert.rejects(() => createAiRunRecoveryClient(foreign).recoverRequest(workspaceId, entry.key), e => [403, 404].includes(e.status));
    await assert.rejects(() => createPersonalAgentRunsClient(foreign).submit(workspaceId, agent.id, { input: { text: "synthetic" }, idempotencyKey: "af169-foreign-" + randomUUID(), expectedRevision: agent.revision }), e => [403, 404].includes(e.status));
    assert.deepEqual(await counts(), stableCounts); assert.deepEqual(await noWriteHashes(), frozen);
    const role = await f.prisma.clientWorkspaceRole.create({ data: { workspaceId, code: "AF169_READONLY", name: "AF169 synthetic readonly" } });
    const permissions = await f.prisma.clientWorkspacePermission.findMany({ where: { code: { in: ["workspace.context.read", "workspace.ai.read", "workspace.ai.assets.read"] }, status: "active", deletedAt: null } }); assert.equal(permissions.length, 3);
    await f.prisma.clientWorkspaceRolePermission.createMany({ data: permissions.map(p => ({ roleId: role.id, permissionId: p.id })) });
    await f.prisma.clientWorkspaceMembership.create({ data: { memberId: f.accounts[1].id, workspaceId, roleId: role.id } });
    const readOnly = makeStore(agent, foreign); await readOnly.store.start(workspaceId); assert.equal(readOnly.store.ready(), false); readOnly.store.requestConfirmation(); await readOnly.store.confirmSubmit(); assert.equal(readOnly.store.getSnapshot().confirmation, false);
    await assert.rejects(() => createAiClient(foreign).read(workspaceId, admitted.id), e => e.status === 404);
    assert.deepEqual(await counts(), stableCounts); assert.deepEqual(await noWriteHashes(), frozen);
    proof.checks.push("stale revision/foreign/readonly refusal creates no Run/Job/reservation/Trace/call or owner writes");

    // A real HTTP admission response is held in the transport AFTER the API committed.
    // Changing the page scope must fence its old success/finally without cancelling the server Run.
    const otherWorkspace = f.workspaces[1].id, otherOwnerRole = await f.prisma.clientWorkspaceRole.findUniqueOrThrow({ where: { workspaceId_code: { workspaceId: otherWorkspace, code: "OWNER" } } });
    await f.prisma.clientWorkspaceMembership.create({ data: { memberId: f.accounts[0].id, workspaceId: otherWorkspace, roleId: otherOwnerRole.id } });
    const barrierAgent = await createAgent(), entered = deferred(), release = deferred();
    const barrierRequest = async (path, options) => { const response = await owner(path, options); if (options?.method === "POST" && path.endsWith("/runs")) { entered.resolve(); await release.promise; } return response; };
    const scoped = makeStore(barrierAgent, barrierRequest); await fill(scoped.store); const pending = scoped.store.confirmSubmit(); await entered.promise;
    const original = scoped.storage.getItem(personalJournalKey(f.accounts[0].id)); await scoped.store.selectWorkspace(f.workspaces[1].id); release.resolve(); await pending;
    assert.equal(scoped.store.getSnapshot().workspaceId, f.workspaces[1].id); assert.equal(scoped.store.getSnapshot().run, null); assert.equal(scoped.storage.getItem(personalJournalKey(f.accounts[0].id)), original);
    await execute(); await scoped.store.selectWorkspace(workspaceId); assert.equal(scoped.store.getSnapshot().run.status, "succeeded");
    proof.checks.push("actual old-scope HTTP response barrier fences state/journal writes; original result remains recoverable");

    // Explicit JSON output and real uncertain upstream outcome use the same owners.
    const jsonAgent = await createAgent(owner, workspaceId, "json"), json = makeStore(jsonAgent); mode = "json"; await fill(json.store); await json.store.confirmSubmit(); await execute(); await json.store.recover();
    assert.deepEqual(json.store.getSnapshot().run.output, { answer: "AF169_CONSTANT_OUTPUT" }); mode = "text";
    const uncertainAgent = await createAgent(), uncertain = makeStore(uncertainAgent); await fill(uncertain.store); await uncertain.store.confirmSubmit(); mode = "lost"; const uncertainJob = await execute(); mode = "text"; await uncertain.store.recover();
    assert.equal(uncertain.store.getSnapshot().run.status, "unknown"); assert.equal(uncertain.store.getSnapshot().run.budgetStatus, "reserved"); const unknownCounts = await counts();
    await uncertain.store.newTask(); await uncertain.store.confirmSubmit(); await jobs.execute(uncertainJob); await uncertain.store.recover(); assert.deepEqual(await counts(), unknownCounts);
    proof.checks.push("JSON output is preserved; actual lost upstream remains unknown/reserved and never resends");

    await f.prisma.aiAgentRun.update({ where: { id: admitted.id }, data: { contentPurgedAt: new Date(), output: null } }); await off.store.recover(); assert.equal(off.store.getSnapshot().contentState, "purged"); assert.equal(off.store.getSnapshot().run, null);
    await f.prisma.aiAgentRun.update({ where: { id: admitted.id }, data: { expiresAt: new Date(Date.now() - 1) } }); await f.app.get(AiCenterRunService).cleanup(); await off.store.recover(); assert.equal(off.store.getSnapshot().contentState, "expired");
    const expiredCounts = await counts(); await off.store.recover(); assert.deepEqual(await counts(), expiredCounts);
    proof.checks.push("purged and expired are distinct and never materialize cached output or POST");
    proof.upstreamCalls = upstreamCalls; proof.finalCounts = await counts(); proof.status = "EVIDENCE_ONLY_FORMAL_REPORT_IS_AUTHORITY";
  } finally {
    stores.forEach(s => s.dispose()); lastBody = undefined;
    if (transport && originalTransport) transport.request = originalTransport;
    if (upstream) { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
    await f.close();
    const sessions = await db(async c => (await c.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows);
    assert.deepEqual(sessions, [], "owned application pools must close"); proof.applicationPools = 0; proof.ownedServicesClosed = true;
    const folder = join(root, ".artifacts/auto-ai-program-20261105/AF-169"); mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "live-" + f.lease.id + ".json"), JSON.stringify(proof, null, 2) + "\n");
  }
});
