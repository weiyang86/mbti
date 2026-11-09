import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function createFixture({ transport, transportToken, task = "AF-179" }) {
  assert.ok(["AF-179", "AF-181", "AF-182"].includes(task));
  const root = "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation";
  assert.equal(resolve(process.cwd()), root);
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  assert.equal(git("branch", "--show-current"), "dev");
  assert.equal(git("remote", "get-url", "origin"), "git@github.com:weiyang86/aij-foundation.git");
  assert.equal(resolve(git("rev-parse", "--git-dir")), resolve(git("rev-parse", "--git-common-dir")));
  const { checkDatabase, readDatabaseEnvironment, withDatabase } = await import("../database/connection.mjs");
  await checkDatabase("test");
  const { createRemainingClientFixture } = await import("./remaining-client-fixture.mjs");
  const f = await createRemainingClientFixture(task, { aiCenter: true, pluginManagement: true, realPluginLifecycle: true, testKnowledgeWebImportTransport: transport });
  let closed = false;
  const values = readDatabaseEnvironment("test", process.env, f.lease.id);
  const database = action => withDatabase("test", values, action, { acceptanceId: f.lease.id });
  const directory = resolve(".artifacts/verification/" + task);
  mkdirSync(directory, { recursive: true });
  const proof = { task, acceptanceId: f.lease.id, database: f.lease.database, status: "INCOMPLETE" };
  const save = () => writeFileSync(resolve(directory, "live-" + f.lease.id + ".json"), JSON.stringify(proof, null, 2) + "\n");
  const sockets = new Set(), server = f.app.getHttpServer();
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  const hashes = () => database(async client => {
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r => r.tablename).filter(name => /runtime_|job|ai_.*run|ai_execution|trace|budget|usage|reservation|memory|notification|payment/.test(name));
    const result = {};
    for (const table of tables) {
      assert.match(table, /^[a-z_]+$/);
      const rows = (await client.query('SELECT row_to_json(t)::text AS row FROM public."' + table + '" t')).rows.map(r => r.row).sort();
      result[table] = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    }
    return result;
  });
  try {
    assert.equal(f.app.get(transportToken), transport);
    proof.runtimeBaseline = await hashes();
    const operator = await f.prisma.sysUser.findUniqueOrThrow({ where: { username: "aij-admin" }, select: { id: true } });
    save();
    return {
      ...f, operatorId: operator.id,
      async withAuditFailure(action) {
        await database(async client => {
          await client.query("CREATE FUNCTION public.af179_deny_knowledge_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.module='aij-ai' AND NEW.resource_type='ai_knowledge_document' AND NEW.action='ai_knowledge_document_imported' THEN RAISE EXCEPTION 'AF179_AUDIT_PROBE'; END IF; RETURN NEW; END; $$");
          await client.query("CREATE TRIGGER af179_deny_knowledge_audit BEFORE INSERT ON public.audit_log FOR EACH ROW EXECUTE FUNCTION public.af179_deny_knowledge_audit()");
        });
        try { return await action(); }
        finally {
          await database(async client => {
            await client.query("DROP TRIGGER af179_deny_knowledge_audit ON public.audit_log");
            await client.query("DROP FUNCTION public.af179_deny_knowledge_audit()");
          });
          proof.auditTriggerRemoved = true; save();
        }
      },
      async close() {
        try {
          proof.runtimeAfter = await hashes();
          assert.deepEqual(proof.runtimeAfter, proof.runtimeBaseline, "Runtime/cost/Memory/notification/payment owner changed");
        } finally {
          await f.close();
          const drains = [...sockets].map(socket => new Promise(done => socket.once("close", done)));
          // Nest has stopped this owned listener; await actual idle SDK sockets,
          // whose close events can arrive after app.close() resolves.
          server.closeAllConnections();
          let timer;
          try { await Promise.race([Promise.all(drains), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Owned API sockets did not close")), 2000); })]); }
          finally { clearTimeout(timer); }
          closed = true;
        }
      },
      async assertClosed() {
        assert.equal(closed, true); assert.equal(server.listening, false);
        await new Promise(r => setImmediate(r)); assert.equal(sockets.size, 0);
        proof.poolsAfter = await database(async client => (await client.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'")).rows[0].n);
        assert.equal(proof.poolsAfter, 0);
        proof.status = "REAL_HTTP_PG_EVIDENCE_FORMAL_REPORT_IS_AUTHORITY"; proof.apiSocketsAfter = sockets.size;
        proof.runtimeOwnersUnchanged = true; save();
      }
    };
  } catch (error) { await f.close(); throw error; }
}
