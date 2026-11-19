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
const SECRET_ENV = "AIJ_SECRET_AIJ_FOUNDATION_TEST_AF110_OFFLINE_KEY";
const SECRET_REF = "env://" + SECRET_ENV;
const SECRET_VALUE = "af110-synthetic-" + randomBytes(32).toString("hex");

test("AF-110 executes workspace-bound knowledge questions through AsyncRuntime with a test-only offline provider", { timeout: 300_000 }, async t => {
  const lease = await createAcceptance("test", "AF-110");
  assert.equal((await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id })).exitCode, 0);
  assert.equal((await migrate({ mode: "test", action: "status", acceptanceId: lease.id })).exitCode, 0);
  const fixture = await prepareClientFixture(lease.id, "AF-110", { pluginManagement: true });
  assert.equal(acceptanceRecord("test", lease.id).task, "AF-110");
  const credentialRecord = JSON.parse(await readFile(fixture.accounts[0].initialPasswordFile, "utf8"));
  const accounts = fixture.accounts.map(account => ({
    ...account,
    password: credentialRecord.accounts.find(value => value.id === account.id)?.password
  }));
  assert.ok(accounts.every(account => typeof account.password === "string" && account.password.length > 0));

  const values = {
    ...clientEnvironment(lease.id, "AF-110"),
    ASYNC_RUNTIME_ENABLED: "true",
    ENABLED_PLUGINS: "aij-ai",
    AIJ_TEST_AI_PROVIDER_MODE: "offline-knowledge",
    [SECRET_ENV]: SECRET_VALUE
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
  let alphaQuestionId;

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
    return { response, text, body: text ? JSON.parse(text) : null };
  };
  const expect = async (method, path, status, options) => {
    const result = await request(method, path, options);
    assert.equal(result.response.status, status, `${method} ${path}: ${result.text}`);
    return result;
  };
  const login = async account => {
    const result = await expect("POST", "client/auth/login", 200, { body: { email: account.email, password: account.password } });
    const setCookie = result.response.headers.get("set-cookie");
    assert.ok(setCookie?.includes("HttpOnly") && setCookie.includes("SameSite=Strict"));
    return setCookie.split(";")[0];
  };
  const createWorkspace = async (cookie, idempotencyKey, name) => {
    const result = await expect("POST", "client/workspaces", 201, { cookie, body: { name, idempotencyKey } });
    return result.body.data;
  };
  const createDocument = async (cookie, workspace, documentCode, content) => {
    const result = await expect("POST", "client/ai/knowledge/documents", 201, {
      cookie,
      workspaceId: workspace.id,
      body: { documentCode, title: "Synthetic AF-110 knowledge", content }
    });
    return result.body.data;
  };
  const pollQuestion = async (cookie, workspace, id, expectedStatus) => {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const result = await expect("GET", `client/ai/knowledge/questions/${id}`, 200, { cookie, workspaceId: workspace.id });
      if (result.body.data.status === expectedStatus || result.body.data.status === "failed") return result;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.fail(`question ${id} did not reach ${expectedStatus} before timeout`);
  };
  const submit = (cookie, workspace, query, idempotencyKey) => expect("POST", "client/ai/knowledge/questions", 200, {
    cookie,
    workspaceId: workspace.id,
    body: { query, idempotencyKey }
  });

  try {
    replaceEnvironment(values);
    const { createApplication } = requireApi("bootstrap.js");
    const { PrismaService } = requireApi("prisma/prisma.service.js");
    const { AiProviderRegistry } = requireApi("plugins/aij-ai/ai-provider.js");
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0, "test API binds only an OS-selected loopback port");
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
    assert.equal(acceptanceRecord("test", lease.id).task, "AF-110");
    assert.ok(app.get(AiProviderRegistry).get("offline-knowledge"), "explicit test mode registered the offline adapter");
    const project = await prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
    const { PluginCatalog } = requireApi('plugin-runtime/plugin-catalog.js');
    const { PluginLifecycleService } = requireApi('plugin-runtime/plugin-lifecycle.service.js');
    const admin = await prisma.sysUser.findUniqueOrThrow({ where: { username: 'aij-admin' } });
    const catalog = app.get(PluginCatalog), lifecycle = app.get(PluginLifecycleService);
    await lifecycle.install('aij-ai', catalog.manifest('aij-ai').version, admin.id, 'af110-regression-install');
    await lifecycle.enable('aij-ai', admin.id, 'af110-regression-enable');

    alphaCookie = await login(accounts[0]);
    betaCookie = await login(accounts[1]);
    alpha = await createWorkspace(alphaCookie, "af110-alpha-workspace", "AF-110 Synthetic Alpha");
    beta = await createWorkspace(betaCookie, "af110-beta-workspace", "AF-110 Synthetic Beta");
    const alphaDocument = await createDocument(alphaCookie, alpha, "alpha-refund", "甲工作区合成退款政策：退款期限为30天。提交时使用合成申请编号。");
    const betaDocument = await createDocument(betaCookie, beta, "beta-refund", "乙工作区合成退款政策：退款期限为60天。提交时使用乙区合成编号。");
    await createDocument(alphaCookie, alpha, "alpha-provider-failure", "synthetic provider failure is a synthetic offline failure test fixture.");

    const installation = await prisma.pluginInstallation.findUnique({ where: { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-ai" } } });
    assert.equal(installation?.status, "enabled", "isolated synthetic project enables the already registered AI plugin for this test");
    await prisma.secretReference.create({ data: { ref: SECRET_REF, provider: "env", description: "AF-110 synthetic offline test reference" } });
    const configs = [
      ["ai.providerCode", "offline-knowledge", "string"],
      ["ai.modelCode", "synthetic-qa-v1", "string"],
      ["ai.credentialRef", SECRET_REF, "secretRef"],
      ["capabilities.ai.text.generate", "true", "boolean"]
    ];
    for (const [configKey, configValue, valueType] of configs) {
      await prisma.scopedConfig.create({ data: {
        scope: "project", scopeId: project.id, pluginCode: "aij-ai", configKey, configValue, valueType,
        name: "AF-110 synthetic offline configuration", sensitive: valueType === "secretRef", isPublic: false
      } });
    }

    await t.test("anonymous, cross-workspace and caller-supplied workspace are rejected", async () => {
      await expect("POST", "client/ai/knowledge/questions", 401, { workspaceId: alpha.id, body: { query: "退款期限是多少", idempotencyKey: "anon" } });
      await expect("POST", "client/ai/knowledge/questions", 403, { cookie: betaCookie, workspaceId: alpha.id, body: { query: "退款期限是多少", idempotencyKey: "cross" } });
      await expect("POST", "client/ai/knowledge/questions", 400, { cookie: alphaCookie, workspaceId: alpha.id, body: { query: "退款期限是多少", idempotencyKey: "spoof", workspaceId: beta.id } });
      const own = await submit(alphaCookie, alpha, "退款期限是多少", "af110-spoofed-query");
      assert.equal(own.body.data.status, "queued");
      alphaQuestionId = own.body.data.id;
      await expect("GET", `client/ai/knowledge/questions/${alphaQuestionId}`, 404, { cookie: betaCookie, workspaceId: beta.id });
    });

    await t.test("same workspace receives evidence-backed answer and only server-derived citations", async () => {
      const first = await pollQuestion(alphaCookie, alpha, alphaQuestionId, "answered");
      assert.equal(first.body.data.status, "answered");
      assert.match(first.body.data.answer, /退款期限为30天/);
      assert.deepEqual(first.body.data.citations.map(value => value.documentId), [alphaDocument.id]);
      assert.equal(JSON.stringify(first.body).includes(betaDocument.id), false);
      assert.equal(JSON.stringify(first.body).includes("60天"), false);
      assert.equal(first.response.headers.get("cache-control"), "private, no-store");
      const job = await prisma.runtimeJob.findUniqueOrThrow({ where: { id: (await prisma.aiKnowledgeQuestion.findUniqueOrThrow({ where: { id: alphaQuestionId } })).runtimeJobId } });
      assert.equal(job.status, "completed");
      assert.equal(job.workspaceId, alpha.id);
      assert.deepEqual(job.payload, { questionId: alphaQuestionId }, "Runtime payload stores only the AI-owned question reference");
      const trace = await prisma.aiExecutionTrace.findFirstOrThrow({ where: { jobId: job.id } });
      assert.equal(trace.status, "succeeded");
      assert.equal(trace.providerCode, "offline-knowledge");
      assert.equal(trace.modelCode, "synthetic-qa-v1");
      assert.equal(trace.costSource, "unreported", "offline fixture creates no fabricated cost receipt");
      assert.equal(trace.costAmountNanos, null);
      assert.equal(JSON.stringify(trace.inputShape).includes("退款期限是多少"), false, "Trace stores shape only");
      assert.equal(JSON.stringify(job.resultReference).includes("退款期限为30天"), false, "Runtime stores no answer text");
      const response = await submit(alphaCookie, alpha, "退款期限是多少", "af110-spoofed-query");
      assert.equal(response.body.data.id, alphaQuestionId);
      assert.equal(response.body.data.idempotentReplay, true);
      const conflict = await expect("POST", "client/ai/knowledge/questions", 409, {
        cookie: alphaCookie, workspaceId: alpha.id,
        body: { query: "退款期限是多少 synthetic provider failure", idempotencyKey: "af110-spoofed-query" }
      });
      assert.equal(conflict.text.includes(SECRET_VALUE), false);
    });

    await t.test("unsupported questions are durably refused without enqueue or provider trace", async () => {
      const beforeJobs = await prisma.runtimeJob.count({ where: { jobType: "aij-ai.knowledge-answer" } });
      const beforeTraces = await prisma.aiExecutionTrace.count();
      const result = await submit(alphaCookie, alpha, "量子传送原理是什么", "af110-no-evidence");
      assert.equal(result.body.data.status, "refused");
      assert.equal(result.body.data.refusalCode, "INSUFFICIENT_EVIDENCE");
      assert.deepEqual(result.body.data.citations, []);
      assert.equal(await prisma.runtimeJob.count({ where: { jobType: "aij-ai.knowledge-answer" } }), beforeJobs);
      assert.equal(await prisma.aiExecutionTrace.count(), beforeTraces);
    });

    await t.test("missing SecretRef backing value fails closed before question or job persistence", async () => {
      const beforeQuestions = await prisma.aiKnowledgeQuestion.count({ where: { workspaceId: alpha.id } });
      const beforeJobs = await prisma.runtimeJob.count({ where: { jobType: "aij-ai.knowledge-answer" } });
      delete process.env[SECRET_ENV];
      const unavailable = await expect("POST", "client/ai/knowledge/questions", 503, {
        cookie: alphaCookie, workspaceId: alpha.id,
        body: { query: "退款期限是多少", idempotencyKey: "af110-no-secret" }
      });
      assert.equal(unavailable.text.includes(SECRET_VALUE), false);
      assert.equal(unavailable.text.includes(SECRET_REF), false);
      assert.equal(await prisma.aiKnowledgeQuestion.count({ where: { workspaceId: alpha.id } }), beforeQuestions);
      assert.equal(await prisma.runtimeJob.count({ where: { jobType: "aij-ai.knowledge-answer" } }), beforeJobs);
      process.env[SECRET_ENV] = SECRET_VALUE;
    });

    await t.test("offline provider failures become safe terminal results without leaking exception data", async () => {
      const failed = await submit(alphaCookie, alpha, "synthetic provider failure", "af110-provider-failure");
      const terminal = await pollQuestion(alphaCookie, alpha, failed.body.data.id, "failed");
      const jobDeadline = Date.now() + 5000;
      let job;
      while (Date.now() < jobDeadline) {
        const question = await prisma.aiKnowledgeQuestion.findUniqueOrThrow({ where: { id: failed.body.data.id } });
        job = await prisma.runtimeJob.findUniqueOrThrow({ where: { id: question.runtimeJobId } });
        if (job.status === "dead") break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(terminal.body.data.status, "failed");
      assert.equal(terminal.body.data.failureCode, "EXECUTION_FAILED");
      assert.equal(terminal.body.data.answer, null);
      assert.equal(terminal.text.includes(SECRET_VALUE), false);
      assert.equal(terminal.text.includes("synthetic offline provider failure"), false);
      assert.equal(job.status, "dead");
      assert.equal(job.lastError?.includes(SECRET_VALUE), false);
      const trace = await prisma.aiExecutionTrace.findFirstOrThrow({ where: { jobId: job.id } });
      assert.equal(trace.status, "failed");
      assert.equal(trace.costSource, "unreported");
    });

    await t.test("PostgreSQL enforces workspace idempotency, unique RuntimeJob ownership, and restrict references", async () => {
      const indexes = await prisma.$queryRaw`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'ai_knowledge_question'`;
      assert.ok(indexes.some(row => row.indexname === "ai_knowledge_question_workspace_idempotency_key" && /UNIQUE INDEX/.test(row.indexdef)));
      assert.ok(indexes.some(row => row.indexname === "ai_knowledge_question_runtime_job_id_key" && /UNIQUE INDEX/.test(row.indexdef)));
      const constraints = await prisma.$queryRaw`SELECT c.conname,c.contype,c.confdeltype FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relname='ai_knowledge_question'`;
      const foreignKeys = constraints.filter(row => row.contype === "f");
      assert.equal(foreignKeys.length, 3);
      assert.ok(foreignKeys.every(row => row.confdeltype === "r"), "workspace/member/job references use RESTRICT");
      const duplicate = await prisma.aiKnowledgeQuestion.findUniqueOrThrow({ where: {
        workspaceId_idempotencyKeyHash: {
          workspaceId: alpha.id,
          idempotencyKeyHash: createHash("sha256").update(alpha.id + "\0af110-spoofed-query").digest("hex")
        }
      } });
      assert.equal(duplicate.id, alphaQuestionId);
      assert.equal(duplicate.status, "answered");
    });
  } finally {
    if (app) await app.close();
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, previousEnvironment);
  }
});
