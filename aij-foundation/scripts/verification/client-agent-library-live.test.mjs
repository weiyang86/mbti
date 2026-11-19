// ROOT ONLY / WORKER NOT_RUN. AF-162 needs a FRESH task registration in the
// five database/auth/fixture guards, integrated AF-159 API/Schema and AF-154
// Skills, generated Prisma and compiled packages/API. Never reuse another lease.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { createAgentLibrary } from "../../apps/web/app/components/client-agent-library-state.mjs";
import { createClientApi, createPersonalAgentsClient, createPersonalSkillsClient, ClientRequestFailure } from "../../packages/sdk/dist/index.mjs";

const task = "AF-162", rootDirectory = "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation";
const READ = "workspace.ai.assets.read", MANAGE = "workspace.ai.assets.manage";
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function emptyPrivate(store) {
  const s = store.getSnapshot();
  assert.deepEqual(s.items, []); assert.equal(s.detail, null); assert.deepEqual(s.versions, []); assert.equal(s.historical, null);
  assert.equal(s.editor, null); assert.equal(s.confirmation, null); assert.equal(s.draft.name, ""); assert.equal(s.draft.instructions, "");
  assert.deepEqual(s.draft.skillBindings, []); assert.equal(s.models, null); assert.deepEqual(s.skills, []); assert.deepEqual(s.verifiedPins, {});
}
async function fill(store, code, { skill, version, model }) {
  await store.openCreate(); store.setDraft("code", code); store.setDraft("name", "Synthetic AF162 private Agent");
  store.setDraft("instructions", "Synthetic AF162 private configuration; never execute"); store.selectModel(model.code);
  store.setDraft("inputFields", ["question"]); store.setDraft("outputFormat", "json"); store.setDraft("outputFields", ["answer"]);
  await store.selectSkill(skill.id); store.addPin(version.id); assert.equal(store.readyToSave(), true); store.requestSave();
}

test("AF-162 fresh real HTTP/PostgreSQL private Agent page-state acceptance (root only)", { timeout: 360000 }, async t => {
  assert.equal(process.env.AIJ_AF162_ROOT_LIVE, "1", "ROOT_EXPLICIT_LIVE_GATE_REQUIRED");
  assert.equal(resolve(process.cwd()), rootDirectory, "ROOT_WORKTREE_REQUIRED");
  const git = flag => resolve(rootDirectory, execFileSync("git", ["rev-parse", flag], { encoding: "utf8" }).trim());
  assert.equal(git("--git-dir"), git("--git-common-dir"));
  assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
  // Dynamic imports intentionally occur AFTER all worker/root gates above.
  const { createAcceptance, migrate } = await import("../database/migration.mjs");
  const { seedDatabase } = await import("../database/seed.mjs");
  const { clientEnvironment } = await import("./client-auth-fixture.mjs");
  const { syntheticAiCatalog } = await import("./ai-center-fixture.mjs");
  const { repositoryRoot, checkDatabase, withDatabase, readDatabaseEnvironment } = await import("../database/connection.mjs");
  assert.equal(repositoryRoot, rootDirectory); await checkDatabase("test");
  const lease = await createAcceptance("test", task); assert.equal(lease.task, task); assert.match(lease.database, /af162/i);
  assert.equal((await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id })).exitCode, 0);
  assert.equal((await migrate({ mode: "test", action: "status", acceptanceId: lease.id })).exitCode, 0);
  await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, runtimeManagement: true, pluginManagement: true, configuration: true, secrets: true, aiCenter: true });
  const require = createRequire(join(repositoryRoot, "apps/api/package.json")), previous = { ...process.env };
  const stores = [], checks = [], proof = { task, acceptanceId: lease.id, database: lease.database, status: "INCOMPLETE" }; let app;
  try {
    const env = clientEnvironment(lease.id, task);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env, { ASYNC_RUNTIME_ENABLED: "false", ENABLED_PLUGINS: "aij-ai", AI_CENTER_LIVE_ENABLED: "false" });
    const { createApplication } = require("../../apps/api/dist/bootstrap.js"), { PrismaService } = require("../../apps/api/dist/prisma/prisma.service.js");
    app = await createApplication(); await app.listen(0, "127.0.0.1");
    const prisma = app.get(PrismaService), base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    const db = op => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), op, { acceptanceId: lease.id });
    const { PluginCatalog } = require("../../apps/api/dist/plugin-runtime/plugin-catalog.js"), { PluginLifecycleService } = require("../../apps/api/dist/plugin-runtime/plugin-lifecycle.service.js");
    const admin = await prisma.sysUser.findUniqueOrThrow({ where: { username: "aij-admin" } }), lifecycle = app.get(PluginLifecycleService), catalog = app.get(PluginCatalog);
    await lifecycle.install("aij-ai", catalog.manifest("aij-ai").version, admin.id, "af162-install"); await lifecycle.enable("aij-ai", admin.id, "af162-enable");
    const { AiCenterConfigurationService } = require("../../apps/api/dist/plugins/aij-ai/ai-center-configuration.service.js");
    const configuration = app.get(AiCenterConfigurationService), secretKey = "AIJ_SECRET_AIJ_FOUNDATION_TEST_AF162";
    process.env[secretKey] = "synthetic-" + randomBytes(24).toString("hex"); const ref = "env://" + secretKey;
    await prisma.secretReference.create({ data: { ref, provider: "env" } });
    const savedCatalog = await configuration.save({ catalog: syntheticAiCatalog(ref), expectedVersion: 0 }, admin.id, "af162-catalog");
    const { AiCenterHttpTransport } = require("../../apps/api/dist/plugins/aij-ai/ai-center-provider.js");
    let upstream = 0; app.get(AiCenterHttpTransport).request = async () => { upstream++; throw new Error("AF162 configuration must never execute AI"); };
    const tableHashes = () => db(async client => {
      const tables = (await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename")).rows, hashes = {};
      for (const { tablename } of tables) {
        assert.match(tablename, /^[A-Za-z_][A-Za-z0-9_]*$/);
        const projection = tablename === "client_auth_session" ? "(to_jsonb(t)-'last_seen_at'-'updated_at')::text" : "row_to_json(t)::text";
        const rows = (await client.query('SELECT ' + projection + ' AS row FROM public."' + tablename + '" t')).rows.map(r => r.row).sort();
        hashes[tablename] = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
      }
      return hashes;
    });
    const accounts = [], cookies = [], bcrypt = require("bcryptjs");
    for (let i = 0; i < 2; i++) {
      const password = "Af162-" + randomBytes(24).toString("hex");
      const account = await prisma.memberUser.create({ data: { email: `af162-${randomUUID()}@example.test`, nickname: "Synthetic AF162 member", passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: new Date() } }); accounts.push(account);
      const login = await fetch(base + "/client/auth/login", { method: "POST", headers: { origin: env.WEB_URL, "content-type": "application/json" }, body: JSON.stringify({ email: account.email, password }), signal: AbortSignal.timeout(15000) });
      assert.equal(login.status, 200); assert.match(login.headers.get("set-cookie"), /HttpOnly/); cookies.push(login.headers.get("set-cookie").split(";")[0]); await login.arrayBuffer();
    }
    const transport = actor => {
      const api = createClientApi(() => base);
      return (path, options = {}) => api(path, { ...options, headers: { ...options.headers, cookie: cookies[actor], origin: env.WEB_URL } });
    };
    const ownerRequest = transport(0), otherRequest = transport(1), ownerSdk = createPersonalAgentsClient(ownerRequest), otherSdk = createPersonalAgentsClient(otherRequest);
    const skillsSdk = createPersonalSkillsClient(ownerRequest), readerSkills = createPersonalSkillsClient(otherRequest), spaces = [];
    for (let i = 0; i < 2; i++) spaces.push(await ownerRequest("/client/workspaces", { method: "POST", body: JSON.stringify({ name: "AF162 synthetic space " + i, idempotencyKey: "af162-" + randomUUID() }) }));
    const permissions = await prisma.clientWorkspacePermission.findMany({ where: { code: { in: ["workspace.context.read", READ, MANAGE] }, deletedAt: null, status: "active" } }); assert.equal(permissions.length, 3);
    const readerRole = await prisma.clientWorkspaceRole.create({ data: { workspaceId: spaces[0].id, code: "AF162_SYNTHETIC_READER", name: "AF162 synthetic reader" } });
    await prisma.clientWorkspaceRolePermission.createMany({ data: permissions.map(p => ({ roleId: readerRole.id, permissionId: p.id })) });
    await prisma.clientWorkspaceMembership.create({ data: { workspaceId: spaces[0].id, memberId: accounts[1].id, roleId: readerRole.id } });
    const skill = await skillsSdk.create(spaces[0].id, { code: "owner-skill", name: "Synthetic AF162 Skill", instructions: "Synthetic immutable original" });
    const version = (await skillsSdk.versions(spaces[0].id, skill.id)).items[0];
    await skillsSdk.update(spaces[0].id, skill.id, { name: skill.name, instructions: "Synthetic current Skill v2", expectedRevision: 1 });
    const modelOptions = await ownerSdk.modelOptions(spaces[0].id), model = modelOptions.items.find(m => m.code === "advice-text");
    assert.ok(model); assert.equal(modelOptions.catalogVersion, savedCatalog.version); assert.equal(JSON.stringify(modelOptions).includes(ref), false);
    const content = { name: "Synthetic AF162 Agent", instructions: "Synthetic AF162 instructions", enabled: false, modelCode: model.code, modelRevision: model.revision, catalogVersion: modelOptions.catalogVersion, inputFields: ["question"], outputFormat: "json", outputFields: ["answer"], skillBindings: [{ skillId: skill.id, revision: 1 }] };
    const readerSkill = await readerSkills.create(spaces[0].id, { code: "reader-skill", name: "Synthetic reader Skill", instructions: "Synthetic private reader Skill" });
    const readerAsset = await otherSdk.create(spaces[0].id, { ...content, code: "reader-agent", skillBindings: [{ skillId: readerSkill.id, revision: 1 }] });
    await prisma.clientWorkspaceRolePermission.updateMany({ where: { roleId: readerRole.id, permissionId: permissions.find(p => p.code === MANAGE).id }, data: { deletedAt: new Date() } });
    const executionBefore = await tableHashes();
    const makeStore = request => { const store = createAgentLibrary({ request, agentsClientFactory: createPersonalAgentsClient, skillsClientFactory: createPersonalSkillsClient }); stores.push(store); return store; };
    const owner = makeStore(ownerRequest), reader = makeStore(otherRequest), choice = { skill, version, model }; let asset;
    await t.test("real session/context + explicit model and immutable Skill pin; confirmed create/replay", async () => {
      await owner.start(spaces[0].id); assert.equal(owner.getSnapshot().principal.id, accounts[0].id); assert.equal(owner.getSnapshot().workspaceId, spaces[0].id);
      await fill(owner, "private-agent", choice); assert.equal(owner.getSnapshot().confirmation, "create"); assert.equal(owner.getSnapshot().draft.enabled, false);
      await owner.confirmMutation(); assert.equal(owner.getSnapshot().issue, null); asset = owner.getSnapshot().items.find(a => a.code === "private-agent"); assert.ok(asset);
      await owner.openDetail(asset.id); assert.equal(owner.getSnapshot().detail.skillBindings[0].revision, 1); assert.equal(owner.getSnapshot().detail.skillBindings[0].skillVersionId, version.id);
      assert.equal(owner.getSnapshot().verifiedPins[`${skill.id}:1`].available, true);
      const counts = async () => [await prisma.aiPersonalAgent.count(), await prisma.aiPersonalAgentVersion.count(), await prisma.aiPersonalAgentSkillBinding.count(), await prisma.auditLog.count({ where: { resourceType: "ai_personal_agent" } })];
      const before = await counts(); await fill(owner, "private-agent", choice); await owner.confirmMutation(); assert.equal(owner.getSnapshot().issue, null); assert.deepEqual(await counts(), before);
      checks.push("REAL_CREATE_MODEL_PIN_REPLAY");
    });
    await t.test("confirmed update, CAS409, current reload and immutable history with cursor", async () => {
      await owner.openDetail(asset.id); await owner.openEdit(); owner.setDraft("instructions", "Local stale draft");
      await ownerSdk.update(spaces[0].id, asset.id, { ...content, name: "Remote current", expectedRevision: 1 });
      owner.requestSave(); await owner.confirmMutation(); assert.equal(owner.getSnapshot().issue.kind, "revision-conflict"); assert.equal(owner.getSnapshot().detail.revision, 1);
      await owner.openDetail(asset.id); assert.equal(owner.getSnapshot().detail.revision, 2); await owner.openEdit(); owner.setDraft("instructions", "Confirmed current configuration"); owner.requestSave(); await owner.confirmMutation(); assert.equal(owner.getSnapshot().issue, null);
      for (let r = 3; r <= 11; r++) await ownerSdk.update(spaces[0].id, asset.id, { ...content, name: "Synthetic history " + r, expectedRevision: r });
      await owner.openDetail(asset.id); assert.equal(owner.getSnapshot().detail.revision, 12); await owner.loadVersions(); assert.equal(owner.getSnapshot().versionCursor, 3);
      owner.previewVersion(owner.getSnapshot().versions.at(-1).id); assert.equal(owner.getSnapshot().historical.revision, 3); assert.equal(owner.getSnapshot().editor, null);
      await owner.loadVersions(true); assert.deepEqual(owner.getSnapshot().versions.map(v => v.revision), [2, 1]);
      assert.equal(owner.getSnapshot().versions.at(-1).skillBindings[0].skillVersionId, version.id);
      checks.push("REAL_UPDATE_CAS409_HISTORY_CURSOR");
    });
    await t.test("real readonly own list/history; all server writes 403 with no durable changes; foreign404", async () => {
      await reader.start(spaces[0].id); assert.ok(!reader.getSnapshot().context.permissions.includes(MANAGE)); assert.deepEqual(reader.getSnapshot().items.map(a => a.id), [readerAsset.id]);
      await reader.openDetail(readerAsset.id); await reader.loadVersions(); assert.equal(reader.getSnapshot().versions.length, 1);
      await reader.openCreate(); await reader.openEdit(); reader.requestDelete(); await reader.confirmMutation(); assert.equal(reader.getSnapshot().confirmation, null);
      const before = await tableHashes(), forbidden = e => e instanceof ClientRequestFailure && e.status === 403;
      await assert.rejects(otherSdk.create(spaces[0].id, { ...content, code: "forbidden-create", skillBindings: [] }), forbidden);
      await assert.rejects(otherSdk.update(spaces[0].id, readerAsset.id, { ...content, skillBindings: [], expectedRevision: 1 }), forbidden);
      await assert.rejects(otherSdk.delete(spaces[0].id, readerAsset.id, 1), forbidden); assert.deepEqual(await tableHashes(), before);
      await assert.rejects(otherSdk.get(spaces[0].id, asset.id), e => e.status === 404); await assert.rejects(ownerSdk.get(spaces[1].id, asset.id), e => e.status === 404);
      checks.push("REAL_READONLY403_NO_DURABLE_CHANGE_FOREIGN404");
    });
    await t.test("genuine HTTP response held at old-space barrier cannot repaint current principal/space", async () => {
      const second = await ownerSdk.create(spaces[1].id, { ...content, code: "second-space", skillBindings: [] });
      const entered = deferred(), release = deferred(); let block = false, capturedSignal;
      const delayed = makeStore(async (path, opts = {}) => {
        if (block && path.startsWith("/client/ai/personal-agents?") && opts.workspaceId === spaces[0].id) {
          capturedSignal = opts.signal; const result = await ownerRequest(path, opts); entered.resolve(); await release.promise; return result;
        }
        return ownerRequest(path, opts);
      });
      await delayed.start(spaces[0].id); block = true; const old = delayed.refresh();
      try {
        await Promise.race([entered.promise, old.then(() => { throw new Error("REAL_HTTP_RESPONSE_BARRIER_NOT_REACHED"); })]);
        await delayed.selectWorkspace(spaces[1].id); await delayed.openDetail(second.id); await delayed.openEdit(); delayed.setDraft("name", "Current space unsaved");
        const snapshot = delayed.getSnapshot(); assert.equal(capturedSignal.aborted, true); release.resolve(); await old; assert.deepEqual(delayed.getSnapshot(), snapshot);
      } finally { release.resolve(); await old; delayed.dispose(); }
      checks.push("REAL_HTTP_OLD_SCOPE_RESPONSE_BARRIER");
    });
    await t.test("real model catalog change blocks stale save until explicit selection; confirmed deletion", async () => {
      await owner.openDetail(asset.id); await owner.openEdit(); const before = owner.getSnapshot().draft.catalogVersion;
      await configuration.save({ catalog: { ...savedCatalog.catalog, monthlyBudgetNanos: "10000000001" }, expectedVersion: savedCatalog.version }, admin.id, "af162-new-catalog");
      await owner.refreshModels(); assert.equal(owner.getSnapshot().draft.catalogVersion, before); assert.equal(owner.readyToSave(), false);
      owner.selectModel(model.code); assert.ok(owner.getSnapshot().draft.catalogVersion > before); assert.equal(owner.readyToSave(), true);
      owner.requestSave(); await owner.confirmMutation(); assert.equal(owner.getSnapshot().issue, null);
      await owner.openDetail(asset.id); owner.requestDelete(); assert.equal(owner.getSnapshot().confirmation, "delete"); await owner.confirmMutation(); assert.equal(owner.getSnapshot().issue, null); assert.match(owner.getSnapshot().notice, /确认删除/);
      await assert.rejects(ownerSdk.get(spaces[0].id, asset.id), e => e.status === 404); await assert.rejects(ownerSdk.versions(spaces[0].id, asset.id), e => e.status === 404);
      owner.dispose(); reader.dispose(); emptyPrivate(owner); emptyPrivate(reader); checks.push("REAL_STALE_CATALOG_EXPLICIT_SELECTION_DELETE");
    });
    const executionAfter = await tableHashes();
    for (const name of Object.keys(executionBefore).filter(n => /^(runtime_job|runtime_outbox|ai_agent_run|ai_execution_trace|ai_.*budget.*|ai_.*usage.*|ai_evaluation_record)$/.test(n))) assert.equal(executionAfter[name], executionBefore[name], name + " configuration must not execute tasks");
    assert.equal(upstream, 0); assert.equal(checks.length, 5); Object.assign(proof, { checks, upstreamCalls: upstream, executionLedgersUnchanged: true, status: "EVIDENCE_RECORDED_FORMAL_REPORT_IS_AUTHORITY" });
  } finally {
    stores.forEach(s => s.dispose());
    try {
      await app?.close(); proof.appClosed = true;
      proof.applicationPools = await withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), async c => (await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows[0].n, { acceptanceId: lease.id });
      assert.equal(proof.applicationPools, 0);
      const folder = join(repositoryRoot, ".artifacts/AF-162"); mkdirSync(folder, { recursive: true, mode: 0o700 }); writeFileSync(join(folder, "live-" + lease.id + ".json"), JSON.stringify(proof, null, 2) + "\n", { mode: 0o600 });
    } finally { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, previous); }
  }
});
