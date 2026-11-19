import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance } from "../database/migration.mjs";
import { profile, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const { Prisma } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const task = "AF-042";
const mode = "test";
const hashFile = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const migrationDirectory = join(repositoryRoot, "apps/api/prisma/migrations");
const migrationFiles = readdirSync(migrationDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{14}_[a-z0-9_]+$/.test(entry.name))
  .map((entry) => ({ name: entry.name, file: join(migrationDirectory, entry.name, "migration.sql") }))
  .sort((a, b) => a.name.localeCompare(b.name));
let commandSequence = 1;

function writeEvidence(directory, name, data) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(directory, name), JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
}

function acceptanceFiles() {
  const directory = join(repositoryRoot, ".local-data/postgres/acceptance");
  if (!existsSync(directory)) return {};
  return Object.fromEntries(readdirSync(directory).filter((file) => file.endsWith(".json") && !file.startsWith("._")).sort()
    .map((file) => [file, hashFile(join(directory, file))]));
}

function migrationLedger(client) {
  return client.query("SELECT id,checksum,migration_name,started_at,finished_at,rolled_back_at,applied_steps_count FROM public._prisma_migrations ORDER BY migration_name")
    .then(({ rows }) => rows);
}

function countPublicTables(client) {
  return client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename")
    .then(async ({ rows }) => {
      const result = {};
      for (const { tablename } of rows) {
        assert.match(tablename, /^[a-z][a-z0-9_]*$/);
        const { rows: count } = await client.query(`SELECT count(*)::int AS count FROM public."${tablename}"`);
        result[tablename] = count[0].count;
      }
      return result;
    });
}

function run(command, directory, { forbiddenValues = [], deferEvidence = false } = {}) {
  const child = spawnSync(command[0], command.slice(1), {
    cwd: repositoryRoot, encoding: "utf8", timeout: 120_000, env: process.env,
    maxBuffer: 4 * 1024 * 1024
  });
  assert.equal(child.error, undefined, `Command could not start: ${command[0]}`);
  const output = (child.stdout || "") + (child.stderr || "");
  const values = readDatabaseEnvironment(mode);
  const password = decodeURIComponent(new URL(values.TEST_DATABASE_URL).password);
  assert.ok(!output.includes(password), "database credential is never emitted");
  for (const secret of forbiddenValues) assert.ok(!output.includes(secret), "synthetic administrator password is never emitted");
  assert.doesNotMatch(output, /\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}/, "password hashes are never emitted");
  const evidenceName = `command-${String(commandSequence++).padStart(2, "0")}.json`;
  const commandEvidence = {
    command, exitCode: child.status, stdout: child.stdout || "", stderr: child.stderr || ""
  };
  if (!deferEvidence) writeEvidence(directory, evidenceName, commandEvidence);
  assert.equal(child.status, 0, `${command.join(" ")} failed with exit ${child.status}: ${output}`);
  const json = [...(child.stdout || "").split(/\r?\n/), ...(child.stderr || "").split(/\r?\n/)]
    .filter((line) => line.startsWith("{"));
  assert.ok(json.length, "command must return a structured result");
  const result = JSON.parse(json.at(-1));
  Object.defineProperties(result, {
    commandOutput: { value: output },
    commandEvidence: { value: commandEvidence },
    commandEvidenceName: { value: evidenceName }
  });
  return result;
}

async function defaultDatabaseSnapshot() {
  const values = readDatabaseEnvironment(mode);
  return withDatabase(mode, values, async (client) => ({
    tables: (await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema' ORDER BY schemaname,tablename")).rows,
    sentinels: (await client.query("SELECT id,mode,instance_id,marker,created_at FROM af005_verification.sentinel ORDER BY id")).rows
  }));
}

test("G7-01 creates a new test acceptance database, deploys/statuses the local chain, and seeds idempotently", async (t) => {
  assert.ok(migrationFiles.length >= 1, "the repository has a local migration chain to deploy");
  const baseSnapshot = await defaultDatabaseSnapshot();
  const oldLeases = acceptanceFiles();
  const lease = await createAcceptance(mode, task);
  assert.equal(lease.status, "CREATED_EMPTY_ACCEPTANCE");
  assert.equal(lease.mode, mode);
  assert.equal(lease.database, `aij_foundation_af042_test_${lease.id}`);
  const values = readDatabaseEnvironment(mode, process.env, lease.id);
  const targetDirectory = join(repositoryRoot, ".artifacts/af-042/integration", lease.id);
  writeEvidence(targetDirectory, "lease.json", {
    status: lease.status, task: lease.task, id: lease.id, mode: lease.mode,
    database: lease.database, ownershipFile: lease.ownershipFile,
    target: { host: lease.bootstrapTarget.host, port: lease.bootstrapTarget.port, user: lease.bootstrapTarget.user, database: lease.bootstrapTarget.database }
  });

  await t.test("new database is empty and matches the validated local test identity", async () => {
    assert.deepEqual(Object.keys(acceptanceFiles()).filter((file) => !(file in oldLeases)), [`${lease.id}.json`]);
    assert.ok(Object.entries(oldLeases).every(([file, digest]) => acceptanceFiles()[file] === digest), "existing acceptance leases were not removed or changed");
    await withDatabase(mode, values, async (client, target, identity) => {
      assert.equal(target.database, lease.database);
      assert.equal(identity.database, lease.database);
      assert.equal(identity.user, profile(mode).user);
      assert.equal(identity.sessionUser, profile(mode).user);
      assert.equal(identity.serverPort, 5432);
      assert.deepEqual((await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows, []);
      writeEvidence(targetDirectory, "identity-and-empty.json", {
        target: { host: target.host, port: target.port, database: target.database, user: target.user },
        identity: { database: identity.database, user: identity.user, serverPort: identity.serverPort }, tables: []
      });
    }, { acceptanceId: lease.id });
  });

  let firstLedger;
  await t.test("migrate deploy applies the exact local migration chain and status is up to date", async () => {
    const deploy = run(["pnpm", "run", "db:migrate", "--", mode, "deploy", "--acceptance", lease.id], targetDirectory);
    assert.equal(deploy.status, "DEPLOYED");
    assert.equal(deploy.target.database, lease.database);
    await withDatabase(mode, values, async (client) => {
      firstLedger = await migrationLedger(client);
      assert.equal(firstLedger.length, migrationFiles.length);
      assert.deepEqual(firstLedger.map((entry) => entry.migration_name), migrationFiles.map((entry) => entry.name));
      for (const entry of firstLedger) {
        assert.equal(entry.checksum, hashFile(migrationFiles.find((migration) => migration.name === entry.migration_name).file));
        assert.ok(entry.finished_at);
        assert.equal(entry.rolled_back_at, null);
      }
      const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map((row) => row.tablename);
      const expected = [...Prisma.dmmf.datamodel.models.map((model) => model.dbName), "_prisma_migrations"].sort();
      assert.deepEqual(tables, expected);
    }, { acceptanceId: lease.id });
    const status = run(["pnpm", "run", "db:migrate", "--", mode, "status", "--acceptance", lease.id], targetDirectory);
    assert.equal(status.status, "UP_TO_DATE");
    writeEvidence(targetDirectory, "migration-chain.json", {
      migrationNames: firstLedger.map((entry) => entry.migration_name),
      checksums: firstLedger.map((entry) => entry.checksum), tableCount: Prisma.dmmf.datamodel.models.length
    });
  });

  await t.test("second deploy and status add no migration rows or schema drift", async () => {
    const secondDeploy = run(["pnpm", "run", "db:migrate", "--", mode, "deploy", "--acceptance", lease.id], targetDirectory);
    assert.equal(secondDeploy.status, "DEPLOYED");
    const status = run(["pnpm", "run", "db:migrate", "--", mode, "status", "--acceptance", lease.id], targetDirectory);
    assert.equal(status.status, "UP_TO_DATE");
    await withDatabase(mode, values, async (client) => {
      assert.deepEqual(await migrationLedger(client), firstLedger, "migration ledger is byte-for-byte stable across repeated deploy");
      assert.deepEqual((await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map((row) => row.tablename), [...Prisma.dmmf.datamodel.models.map((model) => model.dbName), "_prisma_migrations"].sort());
    }, { acceptanceId: lease.id });
  });

  let credentialFile;
  await t.test("real Seed is safe to repeat and preserves a changed administrator password/role", async () => {
    const first = run(["pnpm", "run", "db:seed", "--", mode, "--acceptance", lease.id, "--generate-credentials"], targetDirectory, { deferEvidence: true });
    assert.equal(first.status, "SEEDED");
    assert.equal(first.admin.action, "created");
    credentialFile = first.credentials.file;
    assert.ok(credentialFile);
    const credential = JSON.parse(readFileSync(credentialFile, "utf8"));
    assert.ok(credential.password.length >= 20);
    assert.equal(statSync(credentialFile).mode & 0o077, 0, "generated credential has no group/world permissions on this local filesystem");
    execFileSync("git", ["--no-optional-locks", "check-ignore", "--quiet", credentialFile], { cwd: repositoryRoot });
    assert.ok(!first.commandOutput.includes(credential.password), "generated password is not in the command output");
    assert.doesNotMatch(first.commandOutput, /\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}/, "password hash is not in the command output");
    writeEvidence(targetDirectory, first.commandEvidenceName, first.commandEvidence);
    const initialCounts = await withDatabase(mode, values, async (client) => countPublicTables(client), { acceptanceId: lease.id });
    for (const [table, count] of Object.entries(initialCounts)) assert.equal(count, table === "organization_profile" || table === "project_profile" || table === "sys_user" || table === "sys_role" || table === "sys_permission" || table === "sys_user_role" || table === "sys_role_permission" ? 1 : 0, `${table} has only the minimal bootstrap rows`);
    await withDatabase(mode, values, async (client) => {
      const { rows: [user] } = await client.query("SELECT id FROM public.sys_user WHERE username='aij-admin'");
      assert.ok(user);
      const preservedHash = await bcrypt.hash(`G7-01 synthetic password changed ${randomUUID()}`, 12);
      await client.query("UPDATE public.sys_user SET password_hash=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [preservedHash, user.id]);
      await client.query("UPDATE public.project_profile SET name='G7-01 protected synthetic project',updated_at=CURRENT_TIMESTAMP WHERE code='aij-foundation-test'");
      const { rows: [role] } = await client.query("INSERT INTO public.sys_role (id,role_code,role_name,data_scope,created_at,updated_at) VALUES ($1,$2,$3,'own',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id", [randomUUID(), `g7_01_preserved_${lease.id}`, "G7-01 synthetic preserved role"]);
      const reassigned = await client.query("UPDATE public.sys_user_role SET role_id=$1 WHERE user_id=$2", [role.id, user.id]);
      assert.equal(reassigned.rowCount, 1);
      writeEvidence(targetDirectory, "preservation-before-repeat.json", { adminId: user.id, passwordChanged: true, roleChanged: true, projectConfigurationChanged: true });
    }, { acceptanceId: lease.id });
    const beforeRepeat = await withDatabase(mode, values, async (client) => ({
      counts: await countPublicTables(client),
      user: (await client.query("SELECT password_hash FROM public.sys_user WHERE username='aij-admin'")).rows[0],
      roles: (await client.query("SELECT r.role_code FROM public.sys_user_role ur JOIN public.sys_role r ON r.id=ur.role_id JOIN public.sys_user u ON u.id=ur.user_id WHERE u.username='aij-admin' ORDER BY r.role_code")).rows,
      project: (await client.query("SELECT name FROM public.project_profile WHERE code='aij-foundation-test'")).rows[0]
    }), { acceptanceId: lease.id });
    const second = run(["pnpm", "run", "db:seed", "--", mode, "--acceptance", lease.id], targetDirectory, { forbiddenValues: [credential.password] });
    assert.equal(second.status, "SEEDED");
    assert.equal(second.admin.action, "preserved");
    assert.equal(second.admin.rolesTouched, false);
    const afterRepeat = await withDatabase(mode, values, async (client) => ({
      counts: await countPublicTables(client),
      user: (await client.query("SELECT password_hash FROM public.sys_user WHERE username='aij-admin'")).rows[0],
      roles: (await client.query("SELECT r.role_code FROM public.sys_user_role ur JOIN public.sys_role r ON r.id=ur.role_id JOIN public.sys_user u ON u.id=ur.user_id WHERE u.username='aij-admin' ORDER BY r.role_code")).rows,
      project: (await client.query("SELECT name FROM public.project_profile WHERE code='aij-foundation-test'")).rows[0]
    }), { acceptanceId: lease.id });
    assert.deepEqual(afterRepeat, beforeRepeat, "repeat Seed preserves counts, changed password hash, role assignment and project edit");
    writeEvidence(targetDirectory, "seed-idempotence.json", {
      firstAction: first.admin.action, secondAction: second.admin.action,
      rowsStable: true, changedPasswordAndRolePreserved: true, projectChangePreserved: true,
      credentialFile: credentialFile.replace(repositoryRoot + "/", "")
    });
    const afterDefaultSnapshot = await defaultDatabaseSnapshot();
    assert.deepEqual(afterDefaultSnapshot, baseSnapshot, "default test database application tables and sentinels remain unchanged");
    assert.ok(Object.entries(oldLeases).every(([file, digest]) => acceptanceFiles()[file] === digest), "all prior acceptance leases remain intact");
    writeEvidence(targetDirectory, "protection.json", {
      defaultTestDatabaseUnchanged: true, priorAcceptanceLeasesPreserved: Object.keys(oldLeases).length,
      noResetDropOrVolumeCleanup: true, credentialFileIgnored: true
    });
  });
});
