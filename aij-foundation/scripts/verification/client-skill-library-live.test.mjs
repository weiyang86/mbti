// ROOT ONLY / NOT_RUN by worker. Requires fresh AF-158 task registrations in
// root database/auth/fixture gates, AF-154 schema + API integration, generated
// Prisma and built packages/API. Never reuse an AF-154 lease or run in a child.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { createSkillLibrary } from "../../apps/web/app/components/client-skill-library-state.mjs";
import { createClientApi, createPersonalSkillsClient, ClientRequestFailure } from "../../packages/sdk/dist/index.mjs";

const task = "AF-158", rootDirectory = "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation";
const READ = "workspace.ai.assets.read", MANAGE = "workspace.ai.assets.manage";
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const fill = (store, code, name = "Synthetic AF158 prompt", instructions = "Synthetic AF158 instructions; $(never-run)") => {
  store.openCreate(); store.setDraft("code", code); store.setDraft("name", name); store.setDraft("instructions", instructions); store.requestSave();
};
const emptyPrivate = store => {
  const state = store.getSnapshot(); assert.deepEqual(state.items, []); assert.equal(state.detail, null); assert.deepEqual(state.versions, []);
  assert.equal(state.historical, null); assert.equal(state.editor, null); assert.deepEqual(state.draft, { code: "", name: "", instructions: "" }); assert.equal(state.confirmation, null);
};

test("AF-158 fresh real HTTP/PostgreSQL Skill page-state acceptance (root only)", { timeout: 360000 }, async t => {
  assert.equal(process.env.AIJ_AF158_ROOT_LIVE, "1", "ROOT_EXPLICIT_LIVE_GATE_REQUIRED");
  assert.equal(resolve(process.cwd()), rootDirectory, "ROOT_WORKTREE_REQUIRED");
  const git = flag => resolve(rootDirectory, execFileSync("git", ["rev-parse", flag], { encoding: "utf8" }).trim());
  assert.equal(git("--git-dir"), git("--git-common-dir"));
  assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(), "dev");
  const { createAcceptance, migrate } = await import("../database/migration.mjs");
  const { seedDatabase } = await import("../database/seed.mjs");
  const { clientEnvironment } = await import("./client-auth-fixture.mjs");
  const { repositoryRoot, checkDatabase, withDatabase, readDatabaseEnvironment } = await import("../database/connection.mjs");
  assert.equal(repositoryRoot, rootDirectory); await checkDatabase("test");
  const lease = await createAcceptance("test", task);
  assert.equal(lease.task, task); assert.match(lease.database, /af158/i);
  assert.equal((await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id })).exitCode, 0);
  assert.equal((await migrate({ mode: "test", action: "status", acceptanceId: lease.id })).exitCode, 0);
  await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, runtimeManagement: true, pluginManagement: true });
  const require = createRequire(join(repositoryRoot, "apps/api/package.json")), previous = { ...process.env };
  const stores = [], checks = [], proof = { task, acceptanceId: lease.id, database: lease.database };
  let app;
  try {
    const env = clientEnvironment(lease.id, task);
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env, { ASYNC_RUNTIME_ENABLED: "false", ENABLED_PLUGINS: "aij-ai" });
    const { createApplication } = require("../../apps/api/dist/bootstrap.js");
    const { PrismaService } = require("../../apps/api/dist/prisma/prisma.service.js");
    app = await createApplication(); await app.listen(0, "127.0.0.1");
    const prisma = app.get(PrismaService), base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    const { PluginCatalog } = require("../../apps/api/dist/plugin-runtime/plugin-catalog.js");
    const { PluginLifecycleService } = require("../../apps/api/dist/plugin-runtime/plugin-lifecycle.service.js");
    const admin = await prisma.sysUser.findUniqueOrThrow({ where: { username: "aij-admin" } });
    const catalog = app.get(PluginCatalog), lifecycle = app.get(PluginLifecycleService);
    await lifecycle.install("aij-ai", catalog.manifest("aij-ai").version, admin.id, "af158-install"); await lifecycle.enable("aij-ai", admin.id, "af158-enable");
    const bcrypt = require("bcryptjs"), accounts = [], cookies = [];
    for (let i = 0; i < 2; i++) {
      const password = "Af158-" + randomBytes(24).toString("hex");
      const account = await prisma.memberUser.create({ data: { email: `af158-${randomUUID()}@example.test`, nickname: "Synthetic AF158 member", passwordHash: await bcrypt.hash(password, 12), emailVerifiedAt: new Date() } });
      accounts.push(account);
      const login = await fetch(base + "/client/auth/login", { method: "POST", headers: { origin: env.WEB_URL, "content-type": "application/json" }, body: JSON.stringify({ email: account.email, password }), signal: AbortSignal.timeout(15000) });
      assert.equal(login.status, 200); const cookie = login.headers.get("set-cookie"); assert.match(cookie, /HttpOnly/); cookies.push(cookie.split(";")[0]); await login.arrayBuffer();
    }
    const transport = actor => {
      const api = createClientApi(() => base);
      return (path, options = {}) => api(path, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), headers: { ...options.headers, cookie: cookies[actor], origin: env.WEB_URL } });
    };
    const ownerRequest = transport(0), otherRequest = transport(1), ownerSdk = createPersonalSkillsClient(ownerRequest), otherSdk = createPersonalSkillsClient(otherRequest);
    const spaces = [];
    for (let i = 0; i < 2; i++) spaces.push(await ownerRequest("/client/workspaces", { method: "POST", body: JSON.stringify({ name: "AF158 synthetic space " + i, idempotencyKey: "af158-" + randomUUID() }) }));
    const permissions = await prisma.clientWorkspacePermission.findMany({ where: { code: { in: ["workspace.context.read", READ, MANAGE] }, deletedAt: null, status: "active" } }); assert.equal(permissions.length, 3);
    const role = await prisma.clientWorkspaceRole.create({ data: { workspaceId: spaces[0].id, code: "AF158_SYNTHETIC_READER", name: "AF158 synthetic reader" } });
    await prisma.clientWorkspaceRolePermission.createMany({ data: permissions.map(p => ({ roleId: role.id, permissionId: p.id })) });
    await prisma.clientWorkspaceMembership.create({ data: { workspaceId: spaces[0].id, memberId: accounts[1].id, roleId: role.id } });
    const readerAsset = await otherSdk.create(spaces[0].id, { code: "reader-owned", name: "Reader private name", instructions: "Reader private instructions" });
    await prisma.clientWorkspaceRolePermission.updateMany({ where: { roleId: role.id, permissionId: permissions.find(p => p.code === MANAGE).id }, data: { deletedAt: new Date() } });
    const makeStore = request => { const store = createSkillLibrary({ request, skillsClientFactory: createPersonalSkillsClient }); stores.push(store); return store; };
    const owner = makeStore(ownerRequest), reader = makeStore(otherRequest); let asset;

    await t.test("real page state session/context, confirmed create, idempotent replay, refresh without new rows", async () => {
      await owner.start(spaces[0].id); assert.equal(owner.getSnapshot().principal.id, accounts[0].id); assert.equal(owner.getSnapshot().workspaceId, spaces[0].id);
      assert.ok(owner.getSnapshot().context.permissions.includes(MANAGE));
      fill(owner, "private-synthetic"); await owner.confirmMutation(); assert.equal(owner.getSnapshot().issue, null); assert.match(owner.getSnapshot().notice, /服务端已确认保存/);
      asset = owner.getSnapshot().items.find(item => item.code === "private-synthetic"); assert.ok(asset);
      const counts = async () => [await prisma.aiPersonalSkill.count(), await prisma.aiPersonalSkillVersion.count(), await prisma.auditLog.count({ where: { resourceType: "ai_personal_skill" } })];
      const before = await counts(); fill(owner, "private-synthetic"); await owner.confirmMutation(); assert.deepEqual(await counts(), before);
      await owner.refresh(); await owner.refresh(); assert.deepEqual(await counts(), before);
      fill(owner, "private-synthetic", "Changed conflicting initial content"); await owner.confirmMutation(); assert.equal(owner.getSnapshot().issue.kind, "code-conflict"); assert.deepEqual(await counts(), before);
      checks.push("REAL_CREATE_REPLAY_REFRESH_409");
    });
    await t.test("actual server revision CAS409 reload and readonly immutable historical preview with cursor", async () => {
      await owner.openDetail(asset.id); owner.openEdit(); owner.setDraft("instructions", "Local stale draft");
      await ownerSdk.update(spaces[0].id, asset.id, { name: "Remote edit", instructions: "Remote instructions", expectedRevision: 1 });
      owner.requestSave(); await owner.confirmMutation(); assert.equal(owner.getSnapshot().issue.kind, "revision-conflict"); assert.equal(owner.getSnapshot().detail.revision, 1);
      await owner.openDetail(asset.id); assert.equal(owner.getSnapshot().detail.revision, 2); assert.equal(owner.getSnapshot().draft.instructions, "");
      owner.openEdit(); owner.setDraft("instructions", "Current instructions"); owner.requestSave(); await owner.confirmMutation(); assert.equal(owner.getSnapshot().issue, null);
      for (let expectedRevision = 3; expectedRevision <= 11; expectedRevision++) await ownerSdk.update(spaces[0].id, asset.id, { name: "History synthetic", instructions: "Synthetic history " + expectedRevision, expectedRevision });
      await owner.openDetail(asset.id); assert.equal(owner.getSnapshot().detail.revision, 12); await owner.loadVersions(); assert.equal(owner.getSnapshot().versions.length, 10); assert.equal(owner.getSnapshot().versionCursor, 3);
      owner.previewVersion(owner.getSnapshot().versions[9].id); assert.equal(owner.getSnapshot().historical.revision, 3); assert.equal(owner.getSnapshot().editor, null);
      await owner.loadVersions(true); assert.deepEqual(owner.getSnapshot().versions.map(v => v.revision), [2, 1]); assert.equal(owner.getSnapshot().versionCursor, null);
      checks.push("REAL_EDIT_CAS_HISTORY_CURSOR");
    });
    await t.test("blocked genuine old-scope response cannot overwrite or clear current-scope private state", async () => {
      const secondAsset = await ownerSdk.create(spaces[1].id, { code: "second-space", name: "Current scope name", instructions: "Current scope prompt" });
      const entered = deferred(), release = deferred(); let block = false, capturedSignal;
      const delayed = makeStore(async (path, options = {}) => {
        if (block && path.startsWith("/client/ai/skills?") && options.workspaceId === spaces[0].id) {
          // Genuine HTTP response is received first, then delivery is held. This
          // deliberately ignores late cancellation to exercise the epoch guard.
          capturedSignal = options.signal; const result = await ownerRequest(path, options); entered.resolve(); await release.promise; return result;
        }
        return ownerRequest(path, options);
      });
      await delayed.start(spaces[0].id); block = true; const old = delayed.refresh();
      try {
        await Promise.race([entered.promise, old.then(() => { throw new Error("OLD_RESPONSE_BARRIER_NOT_REACHED"); })]);
        const current = delayed.selectWorkspace(spaces[1].id); emptyPrivate(delayed); await current;
        await delayed.openDetail(secondAsset.id); delayed.openEdit(); delayed.setDraft("name", "Current scope unsaved name");
        const snapshot = delayed.getSnapshot(); assert.equal(capturedSignal.aborted, true);
        release.resolve(); await old; assert.deepEqual(delayed.getSnapshot(), snapshot);
      } finally { release.resolve(); await old; delayed.dispose(); }
      checks.push("REAL_HTTP_OLD_SCOPE_RESPONSE_BLOCKED");
    });
    await t.test("real readonly role can read its own content/history and server rejects all writes with no new rows", async () => {
      await reader.start(spaces[0].id); assert.ok(reader.getSnapshot().context.permissions.includes(READ)); assert.ok(!reader.getSnapshot().context.permissions.includes(MANAGE));
      assert.deepEqual(reader.getSnapshot().items.map(item => item.id), [readerAsset.id]); await reader.openDetail(readerAsset.id); await reader.loadVersions(); assert.equal(reader.getSnapshot().versions.length, 1);
      fill(reader, "forbidden-create"); reader.openEdit(); reader.requestDelete(); await reader.confirmMutation(); assert.equal(reader.getSnapshot().confirmation, null);
      const before = [await prisma.aiPersonalSkill.count(), await prisma.aiPersonalSkillVersion.count(), await prisma.auditLog.count({ where: { resourceType: "ai_personal_skill" } })];
      const forbidden = error => error instanceof ClientRequestFailure && error.status === 403;
      await assert.rejects(otherSdk.create(spaces[0].id, { code: "forbidden-create", name: "Denied", instructions: "Denied" }), forbidden);
      await assert.rejects(otherSdk.update(spaces[0].id, readerAsset.id, { name: "Denied", instructions: "Denied", expectedRevision: 1 }), forbidden);
      await assert.rejects(otherSdk.delete(spaces[0].id, readerAsset.id, 1), forbidden);
      assert.deepEqual([await prisma.aiPersonalSkill.count(), await prisma.aiPersonalSkillVersion.count(), await prisma.auditLog.count({ where: { resourceType: "ai_personal_skill" } })], before);
      await assert.rejects(otherSdk.get(spaces[0].id, asset.id), e => e.status === 404); await assert.rejects(ownerSdk.get(spaces[1].id, asset.id), e => e.status === 404);
      checks.push("REAL_READONLY_OWNER_SCOPE_DENIAL");
    });
    await t.test("real bounded next-page list; confirmed delete tombstone hides current/history and rejects code reuse", async () => {
      for (let i = 0; i < 21; i++) await ownerSdk.create(spaces[0].id, { code: "page-" + i, name: "Synthetic cursor item", instructions: "Synthetic cursor text" });
      await owner.refresh(); assert.equal(owner.getSnapshot().items.length, 20); assert.ok(owner.getSnapshot().nextCursor);
      const firstIds = owner.getSnapshot().items.map(item => item.id); await owner.nextPage(); assert.ok(owner.getSnapshot().items.length > 0); assert.ok(owner.getSnapshot().items.every(item => !firstIds.includes(item.id))); assert.equal(owner.getSnapshot().nextCursor, null);
      await owner.openDetail(asset.id); const expectedRevision = owner.getSnapshot().detail.revision; owner.requestDelete(); await owner.confirmMutation(); assert.equal(owner.getSnapshot().detail, null); assert.match(owner.getSnapshot().notice, /确认删除/);
      assert.equal((await ownerSdk.delete(spaces[0].id, asset.id, expectedRevision)).deleted, true);
      await assert.rejects(ownerSdk.get(spaces[0].id, asset.id), e => e.status === 404); await assert.rejects(ownerSdk.versions(spaces[0].id, asset.id), e => e.status === 404);
      fill(owner, "private-synthetic"); await owner.confirmMutation(); assert.equal(owner.getSnapshot().issue.kind, "code-conflict");
      assert.equal(await prisma.aiPersonalSkillVersion.count({ where: { skillId: asset.id } }), 12);
      owner.dispose(); reader.dispose(); emptyPrivate(owner); emptyPrivate(reader);
      checks.push("REAL_LIST_CURSOR_DELETE_TOMBSTONE_CLEANUP");
    });
    assert.equal(checks.length, 5); proof.checks = checks;
  } finally {
    stores.forEach(store => store.dispose());
    try {
      await app?.close(); proof.appClosed = true;
      const connections = await withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), async client => (await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows[0].n, { acceptanceId: lease.id });
      assert.equal(connections, 0); proof.applicationPools = connections;
      const directory = join(repositoryRoot, ".artifacts/AF-158"); mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(join(directory, "live-" + lease.id + ".json"), JSON.stringify({ ...proof, status: checks.length === 5 ? "EVIDENCE_RECORDED_FORMAL_REPORT_IS_AUTHORITY" : "INCOMPLETE" }, null, 2) + "\n", { mode: 0o600 });
    } finally { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, previous); }
  }
});
