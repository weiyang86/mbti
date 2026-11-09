import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { apiRoot, schemaInvocation } from "../prisma-schema.mjs";
import { createAcceptance, migrationName, migrationPath, schemaPath } from "../database/migration.mjs";
import { checkDatabase, profile, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";

const require = createRequire(join(apiRoot, "package.json"));
const { Prisma } = require("@prisma/client");
const sql = readFileSync(migrationPath, "utf8");
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
async function bootstrapSnapshot(mode) {
  return withDatabase(mode, readDatabaseEnvironment(mode), async (client) => ({
    tables: (await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname<>'information_schema' ORDER BY schemaname,tablename")).rows,
    sentinel: (await client.query("SELECT id,mode,instance_id,marker,created_at FROM af005_verification.sentinel ORDER BY id")).rows
  }));
}
export function acceptanceTests(mode) {
  return async (t) => {
    const parent = join(repositoryRoot, ".artifacts/af-010/integration"); mkdirSync(parent, { recursive: true });
    const root = mkdtempSync(join(parent, mode + "-")); let sequence = 0, lease, values, firstLedger;
    const paths = [schemaPath, migrationPath, resolve("package.json"), resolve("scripts/db-migrate.mjs"), resolve("scripts/database/migration.mjs"), resolve("scripts/database/connection.mjs"), ...["dev", "test"].flatMap((m) => [profile(m).environmentFile, profile(m).secretFile, profile(m).stateFile])];
    const originalHashes = paths.map(sha), before = await bootstrapSnapshot(mode);
    const json = (name, value) => writeFileSync(join(root, name + ".json"), JSON.stringify(value, null, 2) + "\n");
    function run(command, expected = 0, extra = {}) {
      const child = spawnSync(command[0], command.slice(1), { cwd: repositoryRoot, encoding: "utf8", timeout: 45000, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...extra } });
      const output = (child.stdout || "") + (child.stderr || "");
      for (const m of ["dev", "test"]) {
        const password = readFileSync(profile(m).secretFile, "utf8");
        assert.ok(!output.includes(password) && !output.includes(encodeURIComponent(password)), "No actual password in child output");
      }
      json(String(++sequence).padStart(3, "0"), { command, exitCode: child.status, stdout: child.stdout, stderr: child.stderr });
      assert.equal(child.error, undefined); assert.equal(child.status, expected, output);
      const line = output.split("\n").find((line) => line.startsWith("{"));
      return line ? JSON.parse(line) : undefined;
    }
    const query = (operation) => withDatabase(mode, values, operation, { acceptanceId: lease.id });
    const migrate = (action, expected = 0) => run(["pnpm", "run", "db:migrate", "--", mode, action, "--acceptance", lease.id], expected);
    await t.test("new recorded database is authenticated, empty, and status propagates pending exit1", async () => {
      lease = await createAcceptance(mode); json("lease", lease);
      values = readDatabaseEnvironment(mode, process.env, lease.id);
      const connected = await checkDatabase(mode, values, { acceptanceId: lease.id });
      assert.equal(connected.identity.database, lease.database); assert.equal(connected.identity.user, profile(mode).user);
      await query(async (client) => {
        const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname<>'information_schema'");
        assert.deepEqual(rows, []); json("empty-before-deploy", { identity: connected.identity, tables: rows });
      });
      assert.equal(run(["pnpm", "run", "db:check", "--", mode, "--acceptance", lease.id]).target.database, lease.database);
      assert.equal(migrate("status", 1).childExitCode, 1);
    });
    await t.test("first deploy creates exactly one fresh initial migration ledger", async () => {
      assert.equal(migrate("deploy").status, "DEPLOYED");
      firstLedger = await query(async (client) => (await client.query("SELECT id,checksum,migration_name,started_at,finished_at,rolled_back_at,applied_steps_count FROM public._prisma_migrations ORDER BY id")).rows);
      assert.equal(firstLedger.length, 1); assert.equal(firstLedger[0].migration_name, migrationName);
      assert.equal(firstLedger[0].checksum, sha(migrationPath)); assert.ok(firstLedger[0].finished_at); assert.equal(firstLedger[0].rolled_back_at, null);
      json("first-ledger", firstLedger);
    });
    await t.test("second deploy adds no change and real status is up to date", async () => {
      assert.equal(migrate("deploy").status, "DEPLOYED"); assert.equal(migrate("status").status, "UP_TO_DATE");
      const second = await query(async (client) => (await client.query("SELECT id,checksum,migration_name,started_at,finished_at,rolled_back_at,applied_steps_count FROM public._prisma_migrations ORDER BY id")).rows);
      assert.deepEqual(second, firstLedger); json("second-ledger", second);
    });
    await t.test("live tables, columns, nullability, enums, indexes and FK actions match target whitelist", async () => {
      await query(async (client) => {
        const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map((r) => r.tablename);
        assert.deepEqual(tables, [...Prisma.dmmf.datamodel.models.map((m) => m.dbName), "_prisma_migrations"].sort());
        const columns = (await client.query("SELECT table_name,column_name,is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name")).rows;
        for (const m of Prisma.dmmf.datamodel.models) assert.deepEqual(columns.filter((c) => c.table_name === m.dbName), m.fields.filter((f) => f.kind !== "object").map((f) => ({ table_name: m.dbName, column_name: f.dbName || f.name, is_nullable: f.isRequired ? "NO" : "YES" })).sort((a,b) => a.column_name < b.column_name ? -1 : 1));
        const enums = (await client.query("SELECT t.typname AS name,array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' GROUP BY t.typname ORDER BY t.typname")).rows;
        assert.deepEqual(enums, Prisma.dmmf.datamodel.enums.map((e) => ({ name: e.name, values: e.values.map((v) => v.name) })).sort((a,b) => a.name < b.name ? -1 : 1));
        const indexes = (await client.query("SELECT i.relname AS name,t.relname AS table,x.indisunique AS unique,ARRAY(SELECT a.attname::text FROM unnest(x.indkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num ORDER BY k.ord) AS columns FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' ORDER BY i.relname")).rows;
        const expected = [...sql.matchAll(/CREATE (UNIQUE )?INDEX "([^"]+)" ON "([^"]+)"\(([^)]+)\);/g)].map((m) => ({ name:m[2],table:m[3],unique:!!m[1],columns:m[4].split(",").map((s)=>s.trim().replaceAll('"','')) }));
        for (const table of tables) expected.push({ name:table+"_pkey",table,unique:true,columns:["id"] });
        assert.deepEqual(indexes, expected.sort((a,b)=>a.name < b.name ? -1 : 1));
        const foreignKeys = (await client.query("SELECT c.conname AS name,c.confdeltype::text AS delete,c.confupdtype::text AS update FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.contype='f' AND n.nspname='public' ORDER BY c.conname")).rows;
        assert.deepEqual(foreignKeys, [...sql.matchAll(/ADD CONSTRAINT "([^"]+)" FOREIGN KEY/g)].map((m)=>({name:m[1],delete:"r",update:"c"})).sort((a,b)=>a.name<b.name?-1:1));
        json("catalog", { tables, columns, enums, indexes, foreignKeys });
      });
    });
    await t.test("real Prisma read-only diff reports zero drift", () => {
      const i = schemaInvocation(["validate"]);
      i.args = [i.args[0], "migrate", "diff", "--from-schema-datasource", schemaPath, "--to-schema-datamodel", schemaPath, "--exit-code", "--config", join(apiRoot, "prisma.config.mjs")];
      const variable = mode === "dev" ? "DATABASE_URL" : "TEST_DATABASE_URL";
      run([i.command, ...i.args], 0, { DATABASE_URL: values[variable], CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" });
    });
    await t.test("actual unique/enum/FK/Restrict constraints reject synthetic rows, transaction rolls back", async () => {
      await query(async (client) => {
        await client.query("BEGIN");
        try {
          await client.query("INSERT INTO public.plugin_installation(id,project_id,plugin_code,version,owner,updated_at) VALUES ('af010-install','synthetic','synthetic','0.0.0','fixture',CURRENT_TIMESTAMP)");
          const reject = async (statement, code) => {
            await client.query("SAVEPOINT constraint_probe");
            await assert.rejects(client.query(statement), (error) => error.code === code);
            await client.query("ROLLBACK TO SAVEPOINT constraint_probe");
          };
          await reject("INSERT INTO public.plugin_installation(id,project_id,plugin_code,version,owner,updated_at) VALUES ('af010-duplicate','synthetic','synthetic','0.0.0','fixture',CURRENT_TIMESTAMP)", "23505");
          await reject("UPDATE public.plugin_installation SET status='invalid_state' WHERE id='af010-install'", "22P02");
          await reject("INSERT INTO public.plugin_operation(id,installation_id,action,version,owner) VALUES ('af010-bad','missing','install','0.0.0','fixture')", "23503");
          await client.query("INSERT INTO public.plugin_operation(id,installation_id,action,version,owner) VALUES ('af010-operation','af010-install','install','0.0.0','fixture')");
          await reject("DELETE FROM public.plugin_installation WHERE id='af010-install'", "23503");
          json("constraint-probes", { unique:"23505",enum:"22P02",foreignKey:"23503",restrictDelete:"23503",cleanup:"ROLLBACK of this synthetic transaction only" });
        } finally { await client.query("ROLLBACK"); }
      });
    });
    await t.test("cross-mode lease and URL misuse are rejected before connecting", () => {
      const other = mode === "dev" ? "test" : "dev";
      run([process.execPath, "scripts/db-migrate.mjs", other, "deploy", "--acceptance", lease.id], 2);
      const variable = mode === "dev" ? "DATABASE_URL" : "TEST_DATABASE_URL";
      const otherValues = readDatabaseEnvironment(other), otherVariable = other === "dev" ? "DATABASE_URL" : "TEST_DATABASE_URL";
      run([process.execPath, "scripts/db-migrate.mjs", mode, "deploy", "--acceptance", lease.id], 2, { [variable]: otherValues[otherVariable] });
    });
    await t.test("bootstrap/sentinel, credentials and sources are preserved; no synthetic product rows remain", async () => {
      assert.deepEqual(await bootstrapSnapshot(mode), before); assert.deepEqual(paths.map(sha), originalHashes);
      await query(async (client) => { for (const m of Prisma.dmmf.datamodel.models) assert.equal((await client.query('SELECT count(*)::int AS count FROM public."'+m.dbName+'"')).rows[0].count, 0); });
      json("result", { mode, database:lease.database, acceptanceId:lease.id, firstAndSecondLedgerEqual:true, bootstrapUnchanged:true, credentialsAndSourcesUnchanged:true, productTables:21,enumTypes:4,foreignKeys:13,productRows:0,resetDropOrVolumeRemoval:false });
    });
  };
}
