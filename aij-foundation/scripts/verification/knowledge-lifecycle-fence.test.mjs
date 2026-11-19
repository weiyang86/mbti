import { loadKnowledgeWebImports } from "./knowledge-legacy-source-imports.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { controlledClock, loadSource, nest } from "./optimization-delta/source-loader.mjs";

// Actual service, retrieval, project/plugin gates and shared workspace owner, with synthetic
// transactional storage and explicit barriers. This does NOT validate PostgreSQL.
const permissions = loadSource("apps/api/src/client-workspaces/client-workspace-permissions.ts").CLIENT_WORKSPACE_PERMISSION;
const prismaModule = { Prisma: { TransactionIsolationLevel: { ReadCommitted: "ReadCommitted", RepeatableRead: "RepeatableRead" } },
  AiKnowledgeQuestionStatus: Object.fromEntries(["queued", "running", "refused", "answered", "failed"].map(x => [x, x])) };
const { PluginRuntimeAccessService } = loadSource("apps/api/src/plugin-runtime/plugin-runtime-access.service.ts", {
  "@nestjs/common": nest, "@prisma/client": prismaModule
});
const { WorkspaceContextService } = loadSource("apps/api/src/client-workspaces/workspace-context.service.ts", { "@nestjs/common": nest });

const MEMBER = "synthetic-member", WORKSPACE = "synthetic-workspace", PROJECT = "synthetic-project";
const DOCUMENT = "c123456789012345678901234";
const PLUGIN_LOCK = `plugin-lifecycle:${PROJECT}:aij-ai`;
const WORKSPACE_LOCK = `aij-client-workspace-membership:${WORKSPACE}`;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const copy = value => structuredClone(value);

test("shared WorkspaceContext owns write authorization; AI delegates after its lifecycle gate", () => {
  const source = readFileSync(new URL("../../apps/api/src/plugins/aij-ai/ai-knowledge.service.ts", import.meta.url), "utf8");
  assert.ok(source.includes("this.workspaceContext.assertWritePermissionInTransaction(tx, memberId, workspaceId, permission)"));
  assert.doesNotMatch(source, /client_workspace_membership|pg_advisory/);
  const delegate = source.slice(source.indexOf("private async assertWriteAccessInTransaction"), source.indexOf("/** Web-only"));
  assert.doesNotMatch(delegate, /FOR SHARE|SELECT/);
  assert.ok(source.includes("this.clientAuth.assertActiveSessionInTransaction(tx, claims)"));
  assert.doesNotMatch(source, /public\.client_auth_session/);
});

test("public workspace write gate validates inputs before acquiring a lock or reading data", async () => {
  const owner = new WorkspaceContextService({});
  for (const args of [
    ["", WORKSPACE, permissions.knowledgeManage], [null, WORKSPACE, permissions.knowledgeManage],
    [42, WORKSPACE, permissions.knowledgeManage], ["bad member", WORKSPACE, permissions.knowledgeManage],
    [MEMBER, "", permissions.knowledgeManage], [MEMBER, undefined, permissions.knowledgeManage],
    [MEMBER, "../foreign", permissions.knowledgeManage], [MEMBER, "x".repeat(129), permissions.knowledgeManage],
    [MEMBER, WORKSPACE, ""], [MEMBER, WORKSPACE, null], [MEMBER, WORKSPACE, "workspace.*"],
    [MEMBER, WORKSPACE, "workspace manage"], [MEMBER, WORKSPACE, "x".repeat(129)]
  ]) await assert.rejects(owner.assertWritePermissionInTransaction({}, ...args), nest.ForbiddenException);
});

test("public workspace write gate uses caller transaction, returns void, and sanitizes storage failure", async () => {
  const owner = new WorkspaceContextService({}); const calls = [];
  const tx = { $executeRaw: async (_sql, key) => { calls.push(key); }, $queryRaw: async () => [{ id: "membership" }] };
  assert.equal(await owner.assertWritePermissionInTransaction(tx, MEMBER, WORKSPACE, permissions.knowledgeManage), undefined);
  assert.deepEqual(calls, [WORKSPACE_LOCK]);
  tx.$queryRaw = async () => [];
  await assert.rejects(owner.assertWritePermissionInTransaction(tx, MEMBER, WORKSPACE, permissions.knowledgeManage), nest.ForbiddenException);
  tx.$queryRaw = async () => { throw new Error("SYNTHETIC_STORAGE_DETAIL"); };
  await assert.rejects(owner.assertWritePermissionInTransaction(tx, MEMBER, WORKSPACE, permissions.knowledgeManage), error =>
    error instanceof nest.ServiceUnavailableException && error.message === "Workspace context unavailable");
});

function fixture({ evidence = false, beforeWrite = async () => {} } = {}) {
  const clock = controlledClock();
  const { AiKnowledgeService } = loadSource("apps/api/src/plugins/aij-ai/ai-knowledge.service.ts", {
    ...loadKnowledgeWebImports(),
    "@nestjs/common": nest, "@prisma/client": prismaModule, "node:crypto": { createHash },
    "../../client-workspaces/client-workspace-permissions": { CLIENT_WORKSPACE_PERMISSION: permissions },
    "./ai-knowledge-retrieval": loadSource("apps/api/src/plugins/aij-ai/ai-knowledge-retrieval.ts"),
    "./knowledge-csv-parser": loadSource("apps/api/src/plugins/aij-ai/knowledge-csv-parser.ts"),
    "./ai-provider": { AI_PLUGIN_CODE: "aij-ai" }
  }, { Date: clock.Date });
  const active = () => ({ status: "active", deletedAt: null });
  const state = {
    project: { ...active(), id: PROJECT, code: "synthetic-test", organization: active() },
    installation: { status: "enabled" },
    member: active(), workspace: active(), role: { ...active(), workspaceId: WORKSPACE },
    membership: { ...active(), memberId: MEMBER, workspaceId: WORKSPACE, disabledAt: null, removedAt: null },
    grant: { deletedAt: null }, permission: active(), granted: true
  };
  let stored = {
    document: { id: DOCUMENT, workspaceId: WORKSPACE, documentCode: "synthetic", title: "Before", content: "Synthetic aurora guide",
      ...active(), createdAt: new clock.Date(), updatedAt: new clock.Date() },
    questions: [], audits: [], jobs: []
  };
  const events = [], locks = new Map(), waiters = new Map();
  const stats = { writeAttempts: 0, jobCalls: 0, providerCalls: 0, availabilityChecks: 0 };
  let auditFails = false, forceVersionConflict = false;
  const event = value => { events.push(value); waiters.get(value)?.resolve(); };
  const waitFor = value => {
    if (events.includes(value)) return Promise.resolve();
    if (!waiters.has(value)) waiters.set(value, deferred());
    return waiters.get(value).promise;
  };
  async function acquire(owner, key) {
    while (locks.has(key) && locks.get(key).owner !== owner) {
      const occupied = locks.get(key);
      event(`waiting:${owner.kind}:${key}`);
      await occupied.released.promise;
    }
    if (!locks.has(key)) locks.set(key, { owner, released: deferred() });
    event(`locked:${owner.kind}:${key}`);
  }
  function release(owner) {
    for (const [key, held] of locks) if (held.owner === owner) {
      locks.delete(key); held.released.resolve();
    }
  }
  function allowed(memberId, workspaceId, includeMember = true) {
    return memberId === state.membership.memberId && workspaceId === state.membership.workspaceId &&
      state.membership.status === "active" && !state.membership.deletedAt && !state.membership.disabledAt && !state.membership.removedAt &&
      state.workspace.status === "active" && !state.workspace.deletedAt && state.role.workspaceId === workspaceId &&
      state.role.status === "active" && !state.role.deletedAt && state.granted && !state.grant.deletedAt &&
      state.permission.status === "active" && !state.permission.deletedAt &&
      (!includeMember || (state.member.status === "active" && !state.member.deletedAt));
  }
  const findQuestion = (data, args) => {
    const key = args.where.workspaceId_idempotencyKeyHash;
    return copy(data.questions.find(q => q.workspaceId === key.workspaceId && q.idempotencyKeyHash === key.idempotencyKeyHash) || null);
  };
  const prisma = {
    readiness: async () => ({ ready: true }),
    clientWorkspaceMembership: { findFirst: async ({ where }) => {
      if (!allowed(where.memberId, where.workspaceId, false)) return null;
      return { workspace: { id: WORKSPACE, code: "synthetic", name: "Synthetic" }, role: { id: "role", code: "OWNER",
        rolePermissions: [permissions.knowledgeManage, permissions.knowledgeQuery].map(code => ({ permission: { code } })) } };
    } },
    aiKnowledgeQuestion: { findUnique: async args => findQuestion(stored, args) },
    aiKnowledgeDocument: { findMany: async () => evidence ? [copy(stored.document)] : [] },
    $transaction: async (callback, options) => {
      const owner = { kind: options.isolationLevel === "ReadCommitted" ? "write" : "entry" };
      if (owner.kind === "write") { event("write-entered"); await beforeWrite(state, stored); }
      let staged;
      const data = () => staged ??= copy(stored);
      const tx = {
        projectProfile: { findFirst: async ({ where }) => {
          event(`project:${owner.kind}`);
          const p = state.project;
          return p.code === where.code && p.status === "active" && !p.deletedAt && p.organization.status === "active" && !p.organization.deletedAt
            ? { id: p.id } : null;
        } },
        pluginInstallation: { findUnique: async ({ where }) => {
          assert.equal(where.projectId_pluginCode.projectId, PROJECT);
          assert.equal(where.projectId_pluginCode.pluginCode, "aij-ai");
          event(`plugin-read:${owner.kind}`); return copy(state.installation);
        } },
        $executeRaw: async (strings, key) => {
          const sql = strings.join("?");
          if (key.startsWith("plugin-lifecycle:")) assert.match(sql, /pg_advisory_xact_lock\(hashtext\(/);
          else { assert.equal(key, WORKSPACE_LOCK); assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(/); }
          await acquire(owner, key); return 1;
        },
        $queryRaw: async (strings, memberId, workspaceId, permission) => {
          assert.equal(owner.kind, "write");
          assert.equal(locks.get(PLUGIN_LOCK)?.owner, owner);
          assert.equal(locks.get(WORKSPACE_LOCK)?.owner, owner);
          const sql = strings.join("?").replace(/\s+/g, " ");
          // Ensure the synthetic authorization evaluator below cannot conceal a
          // missing predicate/row lock in the real SQL sent to PostgreSQL.
          for (const token of ["m.member_id = ?", "m.workspace_id = ?", "r.workspace_id = m.workspace_id",
            "m.disabled_at IS NULL", "m.removed_at IS NULL", "g.deleted_at IS NULL", "p.code = ?", "FOR SHARE OF u, w, m, r, g, p"])
            assert.ok(sql.includes(token), token);
          for (const alias of ["m", "u", "w", "r", "p"]) {
            assert.ok(sql.includes(`${alias}.status = 'active'`));
            assert.ok(sql.includes(`${alias}.deleted_at IS NULL`));
          }
          assert.ok([permissions.knowledgeManage, permissions.knowledgeQuery].includes(permission));
          event(`authorized:${permission}`);
          return allowed(memberId, workspaceId) ? [{ id: "membership" }] : [];
        },
        aiKnowledgeDocument: {
          findFirst: async ({ where }) => data().document.id === where.id && data().document.workspaceId === where.workspaceId && !data().document.deletedAt ? copy(data().document) : null,
          findFirstOrThrow: async () => copy(data().document),
          updateMany: async ({ where, data: changes }) => {
            stats.writeAttempts++;
            if (forceVersionConflict || data().document.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
            data().document = { ...data().document, ...changes, updatedAt: new clock.Date(clock.Date.now() + 1) };
            return { count: 1 };
          },
          create: async ({ data: changes }) => {
            stats.writeAttempts++; data().document = { ...data().document, ...changes }; return copy(data().document);
          }
        },
        aiKnowledgeQuestion: {
          findUnique: async args => findQuestion(data(), args),
          create: async ({ data: changes }) => {
            stats.writeAttempts++;
            const row = { id: "cquestion1234567890123456", createdAt: new clock.Date(), updatedAt: new clock.Date(),
              answer: null, failureCode: null, runtimeJobId: null, citations: [], ...changes };
            data().questions.push(row); return copy(row);
          },
          update: async ({ where, data: changes }) => {
            const row = data().questions.find(q => q.id === where.id); Object.assign(row, changes); return copy(row);
          }
        },
        auditLog: { create: async ({ data: audit }) => {
          if (auditFails) throw new Error("SYNTHETIC_AUDIT_FAILURE");
          data().audits.push(copy(audit)); return { id: "audit" };
        } },
        addJob: input => { data().jobs.push(copy(input)); }
      };
      try {
        const result = await callback(tx);
        if (staged) stored = staged;
        event(`committed:${owner.kind}`); return result;
      } finally { release(owner); }
    }
  };
  const plugins = new PluginRuntimeAccessService(prisma, { getOrThrow: key => ({ projectId: "synthetic", environment: "test" })[key] });
  const jobs = { enqueueIdempotentInTransaction: async (tx, input) => {
    stats.jobCalls++;
    // Match the existing JobService plugin gate; no new queue or provider.
    const projectId = await plugins.projectId(tx);
    await plugins.assertEnabledInTransaction(tx, projectId, input.scope.pluginCode);
    assert.equal(input.scope.id, projectId); tx.addJob(input); return { id: "synthetic-job" };
  } };
  const service = new AiKnowledgeService(prisma, new WorkspaceContextService(prisma), jobs, {}, plugins, {
    assertAvailable: async () => { stats.availabilityChecks++; },
    execute: async () => { stats.providerCalls++; throw new Error("PROVIDER_MUST_NOT_RUN"); }
  });
  return {
    service, state, stats, events, waitFor, snapshot: () => copy(stored),
    failAudit: (value = true) => { auditFails = value; }, conflictAtWrite: () => { forceVersionConflict = true; },
    hold: async key => { const owner = { kind: "competitor" }; await acquire(owner, key); return () => release(owner); }
  };
}

const create = f => f.service.createDocument(MEMBER, WORKSPACE, { documentCode: "created", title: "Created", content: "Synthetic guide" }, "synthetic-correlation");
const update = f => f.service.updateDocument(MEMBER, WORKSPACE, DOCUMENT,
  { title: "After", expectedUpdatedAt: f.snapshot().document.updatedAt.toISOString() }, "synthetic-correlation");
const question = (f, key = "synthetic-key", query = "aurora guide") => f.service.submitQuestion(MEMBER, WORKSPACE, { query, idempotencyKey: key });
const writes = { create, update, refused: question };
function noSideEffects(f, before) {
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.stats.writeAttempts, 0); assert.equal(f.stats.jobCalls, 0); assert.equal(f.stats.providerCalls, 0);
}

for (const [name, write] of Object.entries(writes)) {
  test(`${name}: disable commits after entry while actual lifecycle gate waits; zero writes/jobs/provider`, { timeout: 3000 }, async () => {
    const entered = deferred(), proceed = deferred();
    // Acquire only after the entry gate completed, at the write transaction.
    const g = fixture({ beforeWrite: async () => { entered.resolve(); await proceed.promise; } });
    const before = g.snapshot(), pending = write(g); await entered.promise;
    const unlock = await g.hold(PLUGIN_LOCK); proceed.resolve();
    try {
      await g.waitFor(`waiting:write:${PLUGIN_LOCK}`);
      g.state.installation.status = "disabled"; unlock();
      await assert.rejects(pending, nest.NotFoundException);
      noSideEffects(g, before);
      assert.equal(g.events.some(e => e.startsWith("authorized:")), false);
    } finally { unlock(); proceed.resolve(); }
  });

  for (const [change, mutate] of [
    ["membership suspended", s => { s.membership.status = "suspended"; s.membership.disabledAt = new Date(); }],
    ["role changed without knowledge permission", s => { s.granted = false; }]
  ]) test(`${name}: ${change} commits behind workspace lock after entry; zero writes/jobs/provider`, { timeout: 3000 }, async () => {
    const f = fixture(), before = f.snapshot(), unlock = await f.hold(WORKSPACE_LOCK);
    const pending = write(f);
    try {
      await f.waitFor(`waiting:write:${WORKSPACE_LOCK}`); mutate(f.state); unlock();
      await assert.rejects(pending, nest.ForbiddenException); noSideEffects(f, before);
      assert.ok(f.events.indexOf(`locked:write:${PLUGIN_LOCK}`) < f.events.indexOf(`locked:write:${WORKSPACE_LOCK}`));
    } finally { unlock(); }
  });
}

for (const [name, mutate, error] of [
  ["wrong runtime project", s => { s.project.code = "foreign-test"; }, nest.ServiceUnavailableException],
  ["inactive project", s => { s.project.status = "inactive"; }, nest.ServiceUnavailableException],
  ["deleted project", s => { s.project.deletedAt = new Date(); }, nest.ServiceUnavailableException],
  ["inactive project organization", s => { s.project.organization.status = "inactive"; }, nest.ServiceUnavailableException],
  ["missing installation", s => { s.installation = null; }, nest.NotFoundException],
  ["inactive member identity", s => { s.member.status = "inactive"; }, nest.ForbiddenException],
  ["deleted member identity", s => { s.member.deletedAt = new Date(); }, nest.ForbiddenException],
  ["inactive workspace", s => { s.workspace.status = "inactive"; }, nest.ForbiddenException],
  ["deleted workspace", s => { s.workspace.deletedAt = new Date(); }, nest.ForbiddenException],
  ["removed membership", s => { s.membership.removedAt = new Date(); }, nest.ForbiddenException],
  ["disabled membership", s => { s.membership.disabledAt = new Date(); }, nest.ForbiddenException],
  ["deleted membership", s => { s.membership.deletedAt = new Date(); }, nest.ForbiddenException],
  ["foreign member", s => { s.membership.memberId = "foreign"; }, nest.ForbiddenException],
  ["foreign workspace", s => { s.membership.workspaceId = "foreign"; }, nest.ForbiddenException],
  ["role belongs to another workspace", s => { s.role.workspaceId = "foreign"; }, nest.ForbiddenException],
  ["inactive role", s => { s.role.status = "inactive"; }, nest.ForbiddenException],
  ["deleted role", s => { s.role.deletedAt = new Date(); }, nest.ForbiddenException],
  ["revoked grant", s => { s.grant.deletedAt = new Date(); }, nest.ForbiddenException],
  ["inactive permission", s => { s.permission.status = "inactive"; }, nest.ForbiddenException],
  ["deleted permission", s => { s.permission.deletedAt = new Date(); }, nest.ForbiddenException]
]) test(`update and refused: ${name} after entry rejects transactionally`, async () => {
  for (const write of [update, question]) {
    const f = fixture({ beforeWrite: mutate }), before = f.snapshot();
    await assert.rejects(write(f), error); noSideEffects(f, before);
  }
});

test("create/update use manage, refused/queued use query, with one lock order and correct job project", async () => {
  for (const [write, evidence, permission] of [[create, false, permissions.knowledgeManage], [update, false, permissions.knowledgeManage],
    [question, false, permissions.knowledgeQuery], [question, true, permissions.knowledgeQuery]]) {
    const f = fixture({ evidence }); const result = await write(f);
    assert.ok(f.events.indexOf(`locked:write:${PLUGIN_LOCK}`) < f.events.indexOf(`locked:write:${WORKSPACE_LOCK}`));
    assert.ok(f.events.includes(`authorized:${permission}`));
    assert.equal(f.stats.providerCalls, 0);
    if (write === question) {
      assert.equal(result.status, evidence ? "queued" : "refused"); assert.equal(f.snapshot().questions.length, 1);
      assert.equal(f.stats.jobCalls, evidence ? 1 : 0);
      if (evidence) {
        assert.equal(f.snapshot().jobs[0].scope.id, PROJECT); assert.equal(f.snapshot().jobs[0].workspaceId, WORKSPACE);
        assert.equal(f.snapshot().questions[0].runtimeJobId, "synthetic-job");
      } else assert.equal(result.refusalCode, "INSUFFICIENT_EVIDENCE");
    } else {
      assert.equal(result.title, write === create ? "Created" : "After");
      assert.equal(f.snapshot().audits.length, 1);
      assert.equal(f.snapshot().audits[0].requestSummary.correlationId, "synthetic-correlation");
      assert.equal(JSON.stringify(f.snapshot().audits).includes("Synthetic guide"), false);
    }
  }
});

test("queued path revoked after retrieval produces zero question/job/provider writes", async () => {
  const f = fixture({ evidence: true, beforeWrite: s => { s.granted = false; } }), before = f.snapshot();
  await assert.rejects(question(f), nest.ForbiddenException); noSideEffects(f, before);
  assert.equal(f.stats.availabilityChecks, 1, "read-only model availability precedes write transaction");
});

for (const evidence of [false, true]) test(`${evidence ? "queued" : "refused"} replay is idempotent and conflicting query is 409`, async () => {
  const f = fixture({ evidence }); const first = await question(f), before = f.snapshot();
  const attempts = f.stats.writeAttempts, jobs = f.stats.jobCalls;
  const replay = await question(f); assert.equal(replay.id, first.id); assert.equal(replay.idempotentReplay, true);
  await assert.rejects(question(f, "synthetic-key", "different request"), nest.ConflictException);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.stats.writeAttempts, attempts); assert.equal(f.stats.jobCalls, jobs);
  f.state.granted = false; await assert.rejects(question(f), nest.ForbiddenException);
});

for (const evidence of [false, true]) test(`${evidence ? "queued" : "refused"} concurrent actual submissions commit one question and at most one job`, async () => {
  const f = fixture({ evidence });
  const results = await Promise.all([question(f), question(f)]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(results.filter(r => r.idempotentReplay).length, 1);
  assert.equal(f.snapshot().questions.length, 1); assert.equal(f.stats.writeAttempts, 1);
  assert.equal(f.snapshot().jobs.length, evidence ? 1 : 0); assert.equal(f.stats.providerCalls, 0);
});

test("concurrent arrival becomes transaction replay only after fresh authorization", async () => {
  const winner = fixture(); await question(winner); const winning = winner.snapshot().questions[0];
  for (const revoked of [false, true]) {
    const f = fixture({ beforeWrite: (s, data) => { data.questions.push(copy(winning)); if (revoked) s.granted = false; } });
    if (revoked) await assert.rejects(question(f), nest.ForbiddenException);
    else { const replay = await question(f); assert.equal(replay.idempotentReplay, true); }
    assert.equal(f.stats.writeAttempts, 0); assert.equal(f.stats.jobCalls, 0);
  }
});

test("stale expected version and lost conditional update stay conflicts without audit/job/provider", async () => {
  for (const conditionalConflict of [false, true]) {
    const f = fixture(), before = f.snapshot();
    if (conditionalConflict) f.conflictAtWrite();
    await assert.rejects(f.service.updateDocument(MEMBER, WORKSPACE, DOCUMENT, {
      title: "After", expectedUpdatedAt: conditionalConflict ? before.document.updatedAt.toISOString() : "2020-01-01T00:00:00.000Z"
    }), nest.ConflictException);
    assert.deepEqual(f.snapshot(), before); assert.equal(f.stats.jobCalls, 0); assert.equal(f.stats.providerCalls, 0);
  }
});

test("transaction audit failure rolls create/update back and a subsequent authorized write recovers", async () => {
  for (const write of [create, update]) {
    const f = fixture(), before = f.snapshot(); f.failAudit();
    await assert.rejects(write(f), nest.ServiceUnavailableException);
    assert.equal(f.stats.writeAttempts, 1); assert.deepEqual(f.snapshot(), before);
    assert.equal(f.stats.jobCalls, 0); assert.equal(f.stats.providerCalls, 0);
    f.failAudit(false); await write(f);
    assert.equal(f.snapshot().audits.length, 1, "failed transaction released locks and next attempt committed");
  }
});
