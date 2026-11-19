import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { acceptanceRecord } from "../database/connection.mjs";
import { clientEnvironment, prepareClientFixture } from "./client-auth-fixture.mjs";

const require = createRequire(join(process.cwd(), "apps/api/package.json"));
const retentionMs = 7 * 24 * 60 * 60 * 1000;
const expiryJobType = "aij-ai.knowledge-expiry-cleanup";
const synthetic = label => `AF-115 synthetic ${label} PRIVATE_CONTENT_${randomBytes(8).toString("hex")}`;

test("AF-115 enforces seven-day expiry through real HTTP and idempotent AsyncRuntime cleanup", { timeout: 360_000 }, async t => {
  const lease = await createAcceptance("test", "AF-115");
  assert.equal((await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id })).exitCode, 0);
  assert.equal((await migrate({ mode: "test", action: "status", acceptanceId: lease.id })).exitCode, 0);
  t.diagnostic(`AF-115 isolated PostgreSQL database=${acceptanceRecord("test", lease.id).database} host=127.0.0.1 port=55433`);
  const fixture = await prepareClientFixture(lease.id, "AF-115");
  assert.equal(acceptanceRecord("test", lease.id).task, "AF-115");
  const credentialRecord = JSON.parse(await readFile(fixture.accounts[0].initialPasswordFile, "utf8"));
  const accounts = fixture.accounts.map(account => ({
    ...account,
    password: credentialRecord.accounts.find(value => value.id === account.id)?.password
  }));
  assert.ok(accounts.every(account => typeof account.password === "string" && account.password.length > 0));

  const values = {
    ...clientEnvironment(lease.id, "AF-115"),
    ASYNC_RUNTIME_ENABLED: "false",
    ENABLED_PLUGINS: "aij-ai"
  };
  const previousEnvironment = { ...process.env };
  const replaceEnvironment = next => {
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, next);
  };
  const requireApi = file => require(join(process.cwd(), "apps/api/dist", file));
  let app;
  let prisma;
  let baseUrl;
  let alphaCookie;
  let betaCookie;
  let alpha;
  let beta;
  let failedCleanupTarget;
  const request = async (method, path, { cookie, workspaceId, body, origin = values.WEB_URL } = {}) => {
    const response = await fetch(baseUrl + "/api/" + path, {
      method,
      headers: {
        connection: "close",
        ...(cookie ? { cookie } : {}),
        ...(workspaceId ? { "x-aij-workspace-id": workspaceId } : {}),
        ...(origin ? { origin } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000)
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* Assertions inspect raw body on failure. */ }
    return { response, text, data };
  };
  const expect = async (method, path, status, options) => {
    const result = await request(method, path, options);
    assert.equal(result.response.status, status, `${method} ${path}: ${result.text}`);
    return result;
  };
  const login = async account => {
    const result = await expect("POST", "client/auth/login", 200, { body: { email: account.email, password: account.password } });
    const cookie = result.response.headers.get("set-cookie");
    assert.ok(cookie?.includes("HttpOnly") && cookie.includes("SameSite=Strict"));
    return cookie.split(";")[0];
  };
  const createWorkspace = async (cookie, key, name) => {
    const result = await expect("POST", "client/workspaces", 201, { cookie, body: { name, idempotencyKey: key } });
    return result.data.data;
  };
  const makeQuestion = async ({ workspace, memberId, label, createdAt, idempotencyKey = `af115-${label}` }) => {
    const query = synthetic(`${label}-query`);
    const answer = synthetic(`${label}-answer`);
    const citation = synthetic(`${label}-citation`);
    const row = await prisma.aiKnowledgeQuestion.create({ data: {
      workspaceId: workspace.id,
      memberId,
      idempotencyKeyHash: createHash("sha256").update(workspace.id + "\0" + idempotencyKey).digest("hex"),
      requestFingerprint: createHash("sha256").update(query).digest("hex"),
      query,
      status: "answered",
      answer,
      citations: [{ documentId: "synthetic-doc", title: "Synthetic source", excerpt: citation }],
      createdAt,
      updatedAt: createdAt
    } });
    const runtimeJob = await prisma.runtimeJob.create({ data: {
      jobType: "aij-ai.knowledge-answer",
      jobVersion: 1,
      payload: { questionId: row.id },
      scope: "global",
      scopeId: "aij-ai",
      status: "completed",
      attempts: 1,
      maxAttempts: 1,
      timeoutMs: 30_000,
      idempotencyKey: `af115-question:${label}`,
      startedAt: createdAt,
      completedAt: createdAt
    } });
    const linked = await prisma.aiKnowledgeQuestion.update({ where: { id: row.id }, data: { runtimeJobId: runtimeJob.id } });
    return { ...linked, runtimeJobId: runtimeJob.id, query, answer, citation, idempotencyKey };
  };
  const expectExpired = async (question, cookie = alphaCookie, workspace = alpha) => {
    const result = await expect("GET", `client/ai/knowledge/questions/${question.id}`, 410, {
      cookie, workspaceId: workspace.id
    });
    for (const value of [question.query, question.answer, question.citation]) assert.equal(result.text.includes(value), false, "410 response contains no question content");
    assert.equal(result.data?.message, "Resource expired", "expiry error is generic and does not expose internal question state");
    return result;
  };

  try {
    replaceEnvironment(values);
    const { createApplication } = requireApi("bootstrap.js");
    const { PrismaService } = requireApi("prisma/prisma.service.js");
    const { RuntimeRegistry } = requireApi("async-runtime/registry.js");
    const { SchedulerService } = requireApi("async-runtime/scheduler.service.js");
    const { JobService } = requireApi("async-runtime/job.service.js");
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0, "HTTP API binds to a real OS-selected loopback port");
    baseUrl = `http://127.0.0.1:${address.port}`;
    t.diagnostic(`AF-115 real API loopback=${baseUrl}`);
    prisma = app.get(PrismaService);
    // Route reads now require the real persisted installation, not only startup loading.
    const aiProject = await prisma.projectProfile.findFirstOrThrow({where:{code:'aij-foundation-test'}});
    await prisma.pluginInstallation.upsert({where:{projectId_pluginCode:{projectId:aiProject.id,pluginCode:'aij-ai'}},create:{projectId:aiProject.id,pluginCode:'aij-ai',version:'0.1.0',owner:'@aij/api',status:'enabled',installedAt:new Date(),enabledAt:new Date()},update:{status:'enabled'}});
    alphaCookie = await login(accounts[0]);
    betaCookie = await login(accounts[1]);
    alpha = await createWorkspace(alphaCookie, "af115-alpha-workspace", "AF-115 Synthetic Alpha");
    beta = await createWorkspace(betaCookie, "af115-beta-workspace", "AF-115 Synthetic Beta");

    const withinRetention = await makeQuestion({ workspace: alpha, memberId: accounts[0].id, label: "within-retention", createdAt: new Date(Date.now() - retentionMs + 1000) });
    const boundary = await makeQuestion({ workspace: alpha, memberId: accounts[0].id, label: "exact-boundary", createdAt: new Date(Date.now() - retentionMs) });
    const legacy = await makeQuestion({ workspace: alpha, memberId: accounts[0].id, label: "legacy-history", createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });
    const newExpired = await makeQuestion({ workspace: alpha, memberId: accounts[0].id, label: "newly-expired", createdAt: new Date(Date.now() - retentionMs - 1000) });

    await t.test("same workspace can read inside the seven-day window; anonymous and cross-workspace remain rejected", async () => {
      const visible = await expect("GET", `client/ai/knowledge/questions/${withinRetention.id}`, 200, { cookie: alphaCookie, workspaceId: alpha.id });
      assert.equal(visible.data.data.answer, withinRetention.answer);
      assert.equal(visible.text.includes(withinRetention.query), false, "query text is never part of the public question DTO");
      assert.equal((await request("GET", `client/ai/knowledge/questions/${withinRetention.id}`, { workspaceId: alpha.id })).response.status, 401);
      assert.equal((await request("GET", `client/ai/knowledge/questions/${withinRetention.id}`, { cookie: betaCookie, workspaceId: beta.id })).response.status, 404);
    });

    await t.test("at the exact deadline and for old historical rows API returns content-free 410", async () => {
      await expectExpired(boundary);
      await expectExpired(legacy);
      await expectExpired(newExpired);
      const replay = await expect("POST", "client/ai/knowledge/questions", 410, {
        cookie: alphaCookie,
        workspaceId: alpha.id,
        body: { query: boundary.query, idempotencyKey: boundary.idempotencyKey }
      });
      for (const value of [boundary.query, boundary.answer, boundary.citation]) assert.equal(replay.text.includes(value), false);
    });

    await t.test("a failed cleanup job cannot make expired content readable", async () => {
      failedCleanupTarget = await makeQuestion({ workspace: alpha, memberId: accounts[0].id, label: "failed-cleanup", createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) });
      const registry = app.get(RuntimeRegistry);
      assert.ok(registry.scheduleDefinitions().some(item => item.code === "aij-ai.knowledge-expiry-cleanup"));
      const badJob = await prisma.runtimeJob.create({ data: {
        jobType: expiryJobType, jobVersion: 1, payload: { scheduledAt: "invalid" }, scope: "global", scopeId: "aij-ai",
        status: "pending", attempts: 0, maxAttempts: 1, timeoutMs: 30_000, idempotencyKey: "af115-failed-cleanup-job"
      } });
      const jobs = app.get(JobService);
      const claimed = await jobs.claim("af115-cleanup-failure", 5, 60_000);
      const failed = claimed.find(item => item.id === badJob.id);
      assert.ok(failed, "real AsyncRuntime claims the invalid cleanup job");
      await jobs.execute(failed);
      const failedState = await prisma.runtimeJob.findUniqueOrThrow({ where: { id: badJob.id }, select: { status: true, lastError: true } });
      assert.equal(failedState.status, "dead");
      assert.ok(failedState.lastError);
      await expectExpired(failedCleanupTarget);
      const stillStored = await prisma.aiKnowledgeQuestion.findUniqueOrThrow({ where: { id: failedCleanupTarget.id } });
      assert.equal(stillStored.answer, failedCleanupTarget.answer, "failed cleanup leaves original data for later retry but HTTP remains fail-closed");
    });

    await t.test("AsyncRuntime schedules cleanup; old and newly expired content is scrubbed once while state and job links remain", async () => {
      const registry = app.get(RuntimeRegistry);
      const schedule = registry.scheduleDefinitions().find(item => item.code === "aij-ai.knowledge-expiry-cleanup");
      assert.ok(schedule);
      assert.equal(schedule.intervalMs, 60 * 60 * 1000);
      const scheduler = app.get(SchedulerService);
      await scheduler.tick("af115-retention-scheduler", new Date());
      const cleanupJob = await prisma.runtimeJob.findFirstOrThrow({ where: { jobType: expiryJobType, idempotencyKey: { startsWith: "knowledge-expiry:" } } });
      assert.equal(cleanupJob.scope, "global");
      assert.deepEqual(cleanupJob.payload && Object.keys(cleanupJob.payload), ["scheduledAt"]);
      const jobs = app.get(JobService);
      const claimed = await jobs.claim("af115-retention-worker", 5, 60_000);
      const scheduled = claimed.find(item => item.id === cleanupJob.id);
      assert.ok(scheduled, "scheduled cleanup is executed through the real AsyncRuntime job owner");
      await jobs.execute(scheduled);
      const completed = await prisma.runtimeJob.findUniqueOrThrow({ where: { id: cleanupJob.id }, select: { status: true, resultReference: true } });
      assert.equal(completed.status, "completed");
      assert.ok((completed.resultReference?.cleanedCount ?? 0) >= 4);

      for (const question of [boundary, legacy, newExpired]) {
        const stored = await prisma.aiKnowledgeQuestion.findUniqueOrThrow({ where: { id: question.id }, include: { runtimeJob: true } });
        assert.equal(stored.query, "");
        assert.equal(stored.answer, null);
        assert.equal(stored.citations, null);
        assert.ok(stored.contentPurgedAt instanceof Date);
        assert.equal(stored.status, "answered", "business status remains intact");
        assert.equal(stored.runtimeJobId, question.runtimeJobId);
        assert.equal(stored.runtimeJob?.id, question.runtimeJobId, "runtime association remains resolvable");
        await expectExpired(question);
      }
      const failedCleanupStored = await prisma.aiKnowledgeQuestion.findUniqueOrThrow({ where: { id: (await prisma.aiKnowledgeQuestion.findFirstOrThrow({ where: { requestFingerprint: createHash("sha256").update(failedCleanupTarget.query).digest("hex") } })).id } });
      assert.equal(failedCleanupStored.query, "", "later scheduled cleanup retries the row left by the failed run");
      assert.ok(failedCleanupStored.contentPurgedAt);

      const repeatJob = await jobs.enqueue({
        type: expiryJobType,
        version: 1,
        payload: { scheduledAt: new Date().toISOString() },
        scope: { type: "global", id: "aij-ai" },
        idempotencyKey: `af115-repeat:${new Date().toISOString()}`,
        maxAttempts: 1,
        timeoutMs: 30_000
      });
      const repeated = (await jobs.claim("af115-repeat-worker", 1, 60_000)).find(item => item.id === repeatJob.id);
      assert.ok(repeated);
      await jobs.execute(repeated);
      const repeatedState = await prisma.runtimeJob.findUniqueOrThrow({ where: { id: repeatJob.id }, select: { status: true, resultReference: true } });
      assert.equal(repeatedState.status, "completed");
      assert.equal(repeatedState.resultReference?.cleanedCount, 0, "a repeated cleanup job has no side effects");
      const activeStored = await prisma.aiKnowledgeQuestion.findUniqueOrThrow({ where: { id: withinRetention.id } });
      assert.equal(activeStored.query, withinRetention.query);
      assert.equal(activeStored.answer, withinRetention.answer);
      assert.equal(activeStored.contentPurgedAt, null);
    });

    await t.test("PostgreSQL has the cleanup marker and expiry index", async () => {
      const columns = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_knowledge_question' AND column_name = 'content_purged_at'`;
      const indexes = await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE tablename = 'ai_knowledge_question'`;
      assert.equal(columns.length, 1);
      assert.ok(indexes.some(row => row.indexname === "ai_knowledge_question_created_at_idx"));
    });
  } finally {
    if (app) await app.close();
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, previousEnvironment);
  }
});
