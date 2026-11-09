import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { acceptanceRecord } from "../database/connection.mjs";
import { clientEnvironment, prepareClientFixture } from "./client-auth-fixture.mjs";
import { G19_KNOWLEDGE_EVALUATION, syntheticDocumentContent } from "./g19-knowledge-evaluation.cases.mjs";

const require = createRequire(join(process.cwd(), "apps/api/package.json"));
const SECRET_ENV = "AIJ_SECRET_AIJ_FOUNDATION_TEST_AF111_OFFLINE_KEY";
const SECRET_REF = "env://" + SECRET_ENV;
const SECRET_VALUE = "af111-synthetic-" + randomBytes(32).toString("hex");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test("AF-111 scores 20 synthetic knowledge questions through real loopback HTTP and isolated PostgreSQL", { timeout: 600_000 }, async t => {
  assert.equal(G19_KNOWLEDGE_EVALUATION.cases.length, 20);
  const lease = await createAcceptance("test", "AF-111");
  assert.equal((await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id })).exitCode, 0);
  assert.equal((await migrate({ mode: "test", action: "status", acceptanceId: lease.id })).exitCode, 0);
  const fixture = await prepareClientFixture(lease.id, "AF-111");
  assert.equal(acceptanceRecord("test", lease.id).task, "AF-111");
  const credentialRecord = JSON.parse(await readFile(fixture.accounts[0].initialPasswordFile, "utf8"));
  const accounts = fixture.accounts.map(account => ({
    ...account,
    password: credentialRecord.accounts.find(value => value.id === account.id)?.password
  }));
  assert.ok(accounts.every(account => typeof account.password === "string" && account.password.length > 0));

  const values = {
    ...clientEnvironment(lease.id, "AF-111"),
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
  let alphaWorkspace;
  let betaWorkspace;

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
      signal: AbortSignal.timeout(20_000)
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
  const uploadDocument = async (cookie, workspace, evaluationCase) => {
    const result = await expect("POST", "client/ai/knowledge/documents", 201, {
      cookie,
      workspaceId: workspace.id,
      body: {
        documentCode: evaluationCase.documentCode,
        title: `Synthetic evaluation ${evaluationCase.id}`,
        content: syntheticDocumentContent(evaluationCase)
      }
    });
    return result.body.data;
  };
  const submitQuestion = (cookie, workspace, evaluationCase) => expect("POST", "client/ai/knowledge/questions", 200, {
    cookie,
    workspaceId: workspace.id,
    body: { query: evaluationCase.query, idempotencyKey: `af111-${evaluationCase.id}` }
  });
  const pollUntilTerminal = async (cookie, workspace, questionId) => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const result = await expect("GET", `client/ai/knowledge/questions/${questionId}`, 200, { cookie, workspaceId: workspace.id });
      if (["answered", "refused", "failed"].includes(result.body.data.status)) return result;
      await delay(150);
    }
    assert.fail(`question ${questionId} did not reach a terminal state in 90 seconds`);
  };

  try {
    replaceEnvironment(values);
    const { createApplication } = requireApi("bootstrap.js");
    const { PrismaService } = requireApi("prisma/prisma.service.js");
    const { AiProviderRegistry } = requireApi("plugins/aij-ai/ai-provider.js");
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0, "API binds only an OS-selected loopback port");
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
    assert.equal(app.get(AiProviderRegistry).get("offline-knowledge")?.providerCode, "offline-knowledge");
    assert.equal(acceptanceRecord("test", lease.id).task, "AF-111");

    alphaCookie = await login(accounts[0]);
    betaCookie = await login(accounts[1]);
    alphaWorkspace = await createWorkspace(alphaCookie, "af111-alpha-workspace", "AF-111 Synthetic Alpha");
    betaWorkspace = await createWorkspace(betaCookie, "af111-beta-workspace", "AF-111 Synthetic Beta");

    const workspaces = { alpha: alphaWorkspace, beta: betaWorkspace };
    const cookies = { alpha: alphaCookie, beta: betaCookie };
    const ownedDocuments = new Map();
    await t.test("the authenticated server workspace boundary rejects a foreign workspace", async () => {
      await expect("POST", "client/ai/knowledge/questions", 401, {
        workspaceId: alphaWorkspace.id,
        body: { query: "qg19beta09 ig19beta09 tg19beta09", idempotencyKey: "af111-anonymous" }
      });
      await expect("POST", "client/ai/knowledge/questions", 403, {
        cookie: betaCookie,
        workspaceId: alphaWorkspace.id,
        body: { query: "qg19beta09 ig19beta09 tg19beta09", idempotencyKey: "af111-cross-workspace-write" }
      });
      await expect("POST", "client/ai/knowledge/questions", 400, {
        cookie: alphaCookie,
        workspaceId: alphaWorkspace.id,
        body: { query: "qg19alpha01 ig19alpha01 tg19alpha01", idempotencyKey: "af111-workspace-spoof", workspaceId: betaWorkspace.id }
      });
    });

    for (const item of G19_KNOWLEDGE_EVALUATION.answerableCases) {
      const document = await uploadDocument(cookies[item.workspace], workspaces[item.workspace], item);
      ownedDocuments.set(item.documentCode, { id: document.id, workspace: item.workspace });
    }
    assert.equal(ownedDocuments.size, 18);

    const project = await prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
    const enabledAt = new Date();
    await prisma.pluginInstallation.create({ data: {
      projectId: project.id,
      pluginCode: "aij-ai",
      version: "0.1.0",
      owner: "@aij/api",
      status: "enabled",
      installedAt: enabledAt,
      enabledAt
    } });
    const installation = await prisma.pluginInstallation.findUnique({ where: { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-ai" } } });
    assert.equal(installation?.status, "enabled");
    await prisma.secretReference.create({ data: { ref: SECRET_REF, provider: "env", description: "AF-111 synthetic offline test reference" } });
    for (const [configKey, configValue, valueType] of [
      ["ai.providerCode", "offline-knowledge", "string"],
      ["ai.modelCode", "synthetic-qa-v1", "string"],
      ["ai.credentialRef", SECRET_REF, "secretRef"],
      ["capabilities.ai.text.generate", "true", "boolean"]
    ]) {
      await prisma.scopedConfig.create({ data: {
        scope: "project", scopeId: project.id, pluginCode: "aij-ai", configKey, configValue, valueType,
        name: "AF-111 synthetic offline evaluation", sensitive: valueType === "secretRef", isPublic: false
      } });
    }

    const outcomes = new Map();
    for (const item of G19_KNOWLEDGE_EVALUATION.cases) {
      let result;
      try { result = await submitQuestion(cookies[item.workspace], workspaces[item.workspace], item); }
      catch (error) { throw new Error(`${item.id} HTTP submission failed: ${error.message}`); }
      outcomes.set(item.id, { evaluationCase: item, initial: result, terminal: null });
      if (item.kind === "unsupported-cross-workspace") {
        assert.equal(result.body.data.status, "refused", `${item.id} is refused synchronously`);
        assert.equal(result.body.data.refusalCode, "INSUFFICIENT_EVIDENCE");
        assert.deepEqual(result.body.data.citations, []);
      } else assert.equal(result.body.data.status, "queued", `${item.id} queues with supporting evidence`);
    }
    assert.equal(outcomes.size, 20);

    for (const item of G19_KNOWLEDGE_EVALUATION.answerableCases) {
      const submitted = outcomes.get(item.id);
      assert.ok(submitted?.initial.body.data.id);
      submitted.terminal = await pollUntilTerminal(cookies[item.workspace], workspaces[item.workspace], submitted.initial.body.data.id);
    }

    const passedAnswerCases = [];
    const citationWorkspaceMismatches = [];
    const refusedUnsupportedCases = [];
    for (const item of G19_KNOWLEDGE_EVALUATION.answerableCases) {
      const result = outcomes.get(item.id).terminal.body.data;
      const hasExpectedSource = result.citations.some(citation => citation.documentCode === item.documentCode && citation.documentId === ownedDocuments.get(item.documentCode).id);
      const answerPass = result.status === "answered" && result.answer?.includes(item.answerMarker) && hasExpectedSource;
      if (answerPass) passedAnswerCases.push(item.id);
      for (const citation of result.citations) {
        const owner = ownedDocuments.get(citation.documentCode)?.workspace;
        if (owner !== item.workspace) citationWorkspaceMismatches.push({ caseId: item.id, citation: citation.documentCode, owner });
      }
    }
    for (const item of G19_KNOWLEDGE_EVALUATION.unsupportedCases) {
      const result = outcomes.get(item.id).initial.body.data;
      if (result.status === "refused" && result.refusalCode === "INSUFFICIENT_EVIDENCE" && result.citations.length === 0) refusedUnsupportedCases.push(item.id);
    }

    await t.test("18 supported cases meet the 90 percent answer score with exact source citations", async () => {
      const answerScore = passedAnswerCases.length / G19_KNOWLEDGE_EVALUATION.answerableCases.length;
      assert.equal(passedAnswerCases.length, 18);
      assert.ok(answerScore >= G19_KNOWLEDGE_EVALUATION.answerableThreshold, `actual score ${answerScore}`);
      assert.deepEqual(citationWorkspaceMismatches, []);
    });

    await t.test("both cross-workspace-only questions refuse without citations and foreign records stay unreadable", async () => {
      assert.equal(refusedUnsupportedCases.length, 2);
      assert.deepEqual(citationWorkspaceMismatches, []);
      const alphaAnswer = G19_KNOWLEDGE_EVALUATION.answerableCases[0];
      const alphaQuestionId = outcomes.get(alphaAnswer.id).terminal.body.data.id;
      await expect("GET", `client/ai/knowledge/questions/${alphaQuestionId}`, 404, { cookie: betaCookie, workspaceId: betaWorkspace.id });
    });

    await t.test("PostgreSQL persists exactly 20 questions, 18 offline jobs and 18 unpriced traces", async () => {
      const workspaceIds = [alphaWorkspace.id, betaWorkspace.id];
      const questions = await prisma.aiKnowledgeQuestion.findMany({ where: { workspaceId: { in: workspaceIds } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      assert.equal(questions.length, 20);
      assert.equal(questions.filter(row => row.status === "answered").length, 18);
      assert.equal(questions.filter(row => row.status === "refused").length, 2);
      assert.equal(questions.filter(row => row.runtimeJobId === null).length, 2);
      assert.equal(questions.every(row => workspaceIds.includes(row.workspaceId)), true);
      assert.equal(questions.every(row => row.query.includes("g19")), true);
      assert.equal(await prisma.runtimeJob.count({ where: { jobType: "aij-ai.knowledge-answer", workspaceId: { in: workspaceIds }, status: "completed" } }), 18);
      const traces = await prisma.aiExecutionTrace.findMany({ where: { providerCode: "offline-knowledge" }, select: { status: true, modelCode: true, costSource: true, costAmountNanos: true } });
      assert.equal(traces.length, 18);
      assert.ok(traces.every(trace => trace.status === "succeeded" && trace.modelCode === "synthetic-qa-v1" && trace.costSource === "unreported" && trace.costAmountNanos === null));
    });

    console.log(JSON.stringify({
      event: "AF111_EVALUATION_METRICS",
      cases: outcomes.size,
      httpBaseUrl: baseUrl,
      database: { mode: "test", host: "127.0.0.1", port: 55433, name: lease.database },
      answerable: { passed: passedAnswerCases.length, total: 18, score: passedAnswerCases.length / 18, threshold: 0.9 },
      unsupportedRefusal: { passed: refusedUnsupportedCases.length, total: 2, rate: refusedUnsupportedCases.length / 2 },
      workspaceIsolation: { citationMismatches: citationWorkspaceMismatches.length, casesChecked: 20, foreignOnlyQuestionsRefused: refusedUnsupportedCases.length, authNegativeChecks: 4 },
      persistence: { questions: 20, completedJobs: 18, offlineTraces: 18, fabricatedCostRecords: 0 },
      provider: "offline-knowledge",
      liveDeepSeek: false,
      liveCustomerData: false,
      paidRequests: false
    }));
  } finally {
    if (app) await app.close();
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, previousEnvironment);
  }
});
