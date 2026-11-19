import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { acceptanceRecord } from "../database/connection.mjs";
import { clientEnvironment, prepareClientFixture } from "./client-auth-fixture.mjs";
import { ClientRequestFailure, clientApi } from "../../apps/web/app/components/client-api.mjs";
import {
  createKnowledgeQuestionsApi,
  knowledgeQuestionDisplay,
  knowledgeQuestionPageMode,
  knowledgeQuestionRequestMessage
} from "../../apps/web/app/components/client-knowledge-questions.ts";

const require = createRequire(join(process.cwd(), "apps/api/package.json"));
const SECRET_ENV = "AIJ_SECRET_AIJ_FOUNDATION_TEST_AF114_OFFLINE_KEY";
const SECRET_VALUE = "af114-synthetic-" + randomBytes(32).toString("hex");
const terminal = new Set(["answered", "refused", "failed"]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test("AF-114 customer Workspace Q&A web consumer uses real loopback HTTP, isolated PostgreSQL and test-only offline Provider", { timeout: 600_000 }, async t => {
  const lease = await createAcceptance("test", "AF-114");
  assert.equal((await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id })).exitCode, 0);
  assert.equal((await migrate({ mode: "test", action: "status", acceptanceId: lease.id })).exitCode, 0);
  const fixture = await prepareClientFixture(lease.id, "AF-114");
  const credentialRecord = JSON.parse(await readFile(fixture.accounts[0].initialPasswordFile, "utf8"));
  const accounts = fixture.accounts.map(account => ({
    ...account,
    password: credentialRecord.accounts.find(value => value.id === account.id)?.password
  }));
  assert.ok(accounts.every(account => typeof account.password === "string" && account.password.length > 0));

  const values = {
    ...clientEnvironment(lease.id, "AF-114"),
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
  let baseUrl;
  let memberCookie;
  let otherCookie;
  let alpha;
  let beta;

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
  const createDocument = async (cookie, workspace, code, title, content) => {
    const result = await expect("POST", "client/ai/knowledge/documents", 201, {
      cookie, workspaceId: workspace.id,
      body: { documentCode: code, title, content }
    });
    return result.body.data;
  };
  const pollTerminal = async (api, workspaceId, id) => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const current = await api.get(workspaceId, id);
      if (terminal.has(current.status)) return current;
      await delay(100);
    }
    assert.fail("question did not reach answered/refused/failed within 60 seconds");
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
    process.env.NEXT_PUBLIC_API_URL = `${baseUrl}/api`;
    const prisma = app.get(PrismaService);
    assert.equal(app.get(AiProviderRegistry).get("offline-knowledge")?.providerCode, "offline-knowledge");
    assert.equal(acceptanceRecord("test", lease.id).task, "AF-114");

    memberCookie = await login(accounts[0]);
    otherCookie = await login(accounts[1]);
    alpha = await createWorkspace(memberCookie, "af114-alpha-workspace", "AF-114 Synthetic Alpha");
    beta = await createWorkspace(otherCookie, "af114-beta-workspace", "AF-114 Synthetic Beta");
    const memberContext = await expect("GET", "client/workspaces/context", 200, { cookie: memberCookie, workspaceId: alpha.id });
    assert.ok(memberContext.body.data.permissions.includes("workspace.knowledge.query"));

    await createDocument(memberCookie, alpha, "af114-answer-source", "AF-114 synthetic response policy", "Workspace response window is seven business days. This is synthetic evidence for AF-114.");
    await createDocument(memberCookie, alpha, "af114-failure-source", "AF-114 synthetic provider failure source", "synthetic provider failure should occur only in this offline test fixture.");
    await createDocument(otherCookie, beta, "af114-foreign-source", "AF-114 foreign workspace document", "Workspace response window is ninety business days in this separate synthetic workspace.");

    const project = await prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" }, select: { id: true } });
    const enabledAt = new Date();
    await prisma.pluginInstallation.create({ data: {
      projectId: project.id, pluginCode: "aij-ai", version: "0.1.0", owner: "@aij/api", status: "enabled",
      installedAt: enabledAt, enabledAt
    } });
    await prisma.secretReference.create({ data: { ref: `env://${SECRET_ENV}`, provider: "env", description: "AF-114 synthetic offline test reference" } });
    for (const [configKey, configValue, valueType] of [
      ["ai.providerCode", "offline-knowledge", "string"],
      ["ai.modelCode", "synthetic-qa-v1", "string"],
      ["ai.credentialRef", `env://${SECRET_ENV}`, "secretRef"],
      ["capabilities.ai.text.generate", "true", "boolean"]
    ]) {
      await prisma.scopedConfig.create({ data: {
        scope: "project", scopeId: project.id, pluginCode: "aij-ai", configKey, configValue, valueType,
        name: "AF-114 synthetic offline Q&A", sensitive: valueType === "secretRef", isPublic: false
      } });
    }

    const alphaClient = (path, options = {}) => clientApi(path, {
      ...options,
      headers: { ...options.headers, cookie: memberCookie, origin: values.WEB_URL }
    });
    const betaClient = (path, options = {}) => clientApi(path, {
      ...options,
      headers: { ...options.headers, cookie: otherCookie, origin: values.WEB_URL }
    });
    const betaApi = createKnowledgeQuestionsApi(betaClient);
    const capturedBodies = [];
    const webConsumer = createKnowledgeQuestionsApi((path, options = {}) => {
      if (options.body) capturedBodies.push(JSON.parse(options.body));
      return alphaClient(path, options);
    });

    await t.test("the real web consumer submits and polls an answer with only server-generated citations", async () => {
      const submitted = await webConsumer.submit(alpha.id, "workspace response window", "af114-answer-1");
      assert.equal(submitted.status, "queued");
      assert.deepEqual(capturedBodies, [{ query: "workspace response window", idempotencyKey: "af114-answer-1" }], "consumer body never contains workspaceId");
      const completed = await pollTerminal(webConsumer, alpha.id, submitted.id);
      const view = knowledgeQuestionDisplay(completed);
      assert.equal(completed.status, "answered");
      assert.equal(view.state, "answered");
      assert.match(view.answer ?? "", /seven business days/);
      assert.equal(view.citations.length, 1);
      assert.equal(view.citations[0].documentCode, "af114-answer-source");
      assert.equal(view.citations[0].title, "AF-114 synthetic response policy");
    });

    let answeredId;
    const replay = await webConsumer.submit(alpha.id, "workspace response window", "af114-answer-1");
    answeredId = replay.id;
    assert.equal(replay.idempotentReplay, true);

    await t.test("insufficient evidence is rendered as a refusal without citations or a runtime job", async () => {
      const refused = await webConsumer.submit(alpha.id, "quasar taxonomy", "af114-insufficient-1");
      assert.equal(refused.status, "refused");
      assert.equal(refused.refusalCode, "INSUFFICIENT_EVIDENCE");
      const view = knowledgeQuestionDisplay(refused);
      assert.equal(view.state, "refused");
      assert.deepEqual(view.citations, []);
      assert.match(view.message, /没有足够依据/);
      const refusedRecord = await prisma.aiKnowledgeQuestion.findUniqueOrThrow({ where: { id: refused.id }, select: { runtimeJobId: true } });
      assert.equal(refusedRecord.runtimeJobId, null);
    });

    await t.test("offline provider failure reaches the persisted failed state and renders a safe message", async () => {
      const submitted = await webConsumer.submit(alpha.id, "synthetic provider failure", "af114-provider-failure-1");
      const failed = await pollTerminal(webConsumer, alpha.id, submitted.id);
      const view = knowledgeQuestionDisplay(failed);
      assert.equal(failed.status, "failed");
      assert.equal(view.state, "failed");
      assert.equal(view.answer, null);
      assert.deepEqual(view.citations, []);
      assert.doesNotMatch(view.message, /EXECUTION_FAILED/);
      assert.match(knowledgeQuestionRequestMessage(new ClientRequestFailure(403)), /没有在此 Workspace 查询/);
      assert.equal((await prisma.aiKnowledgeQuestion.findUniqueOrThrow({ where: { id: failed.id } })).failureCode, "EXECUTION_FAILED");
    });

    await t.test("the question page has explicit auth, permission, workspace and progress states", async () => {
      assert.equal(knowledgeQuestionPageMode({ loading: true }), "loading");
      assert.equal(knowledgeQuestionPageMode({ hasWorkspace: false }), "no-workspace");
      assert.equal(knowledgeQuestionPageMode({ error: "unavailable" }), "error");
      assert.equal(knowledgeQuestionPageMode({ canQuery: false }), "forbidden");
      assert.equal(knowledgeQuestionPageMode(), "ready");
      assert.equal(knowledgeQuestionDisplay({ status: "queued" }).state, "queued");
      assert.equal(knowledgeQuestionDisplay({ status: "running" }).state, "running");
    });

    await t.test("anonymous, foreign Workspace, fabricated identity and no-query role reject", async () => {
      await assert.rejects(
        createKnowledgeQuestionsApi((path, options = {}) => clientApi(path, { ...options, headers: { ...options.headers, origin: values.WEB_URL } })).submit(alpha.id, "workspace response window", "af114-anonymous"),
        error => error instanceof ClientRequestFailure && error.status === 401
      );
      await assert.rejects(betaApi.submit(alpha.id, "workspace response window", "af114-cross-workspace-submit"), error => error instanceof ClientRequestFailure && error.status === 403);
      await assert.rejects(betaApi.get(beta.id, answeredId), error => error instanceof ClientRequestFailure && error.status === 404);
      await expect("POST", "client/ai/knowledge/questions", 400, {
        cookie: memberCookie,
        workspaceId: alpha.id,
        body: { query: "workspace response window", idempotencyKey: "af114-fabricated-workspace", workspaceId: beta.id }
      });
      const membership = await prisma.clientWorkspaceMembership.findFirstOrThrow({ where: { workspaceId: beta.id, memberId: accounts[1].id } });
      const restrictedRole = await prisma.clientWorkspaceRole.create({ data: {
        workspaceId: beta.id, code: "af114-no-knowledge-query", name: "AF-114 synthetic role without query"
      } });
      await prisma.clientWorkspaceMembership.update({ where: { id: membership.id }, data: { roleId: restrictedRole.id } });
      await assert.rejects(betaApi.submit(beta.id, "workspace response window", "af114-no-permission"), error => error instanceof ClientRequestFailure && error.status === 403);
    });

    const evidence = {
      task: "AF-114", databaseMode: "test", database: lease.database, apiBase: baseUrl,
      provider: "offline-knowledge", testOnlyProvider: true, liveDeepSeek: false, liveCustomerData: false, paidRequests: false, fileImport: false
    };
    console.log(JSON.stringify(evidence));
  } finally {
    if (app) await app.close();
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, previousEnvironment);
  }
});
