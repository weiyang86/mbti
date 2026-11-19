import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { apiRoot } from "../prisma-schema.mjs";
import { createAcceptance, migrationName, schemaPath } from "../database/migration.mjs";
import { checkDatabase, profile, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { preflight } from "../database/managed.mjs";

const require = createRequire(join(apiRoot, "package.json"));
const prismaCli = require.resolve("prisma/build/index.js");
const migrationsRoot = join(apiRoot, "prisma/migrations");
const initialMigrationDir = migrationName;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const safeEnvironment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|HOME|TMPDIR|TMP|TEMP|SystemRoot|WINDIR|LANG|LC_ALL|TZ)$/i.test(key)));

function redact(output, password) {
  return String(output).split(password).join("[REDACTED]").split(encodeURIComponent(password)).join("[REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

function writeEvidence(root, name, value) {
  const path = join(root, name + ".json");
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return path;
}

function createMigrationWorkspace(root, directories, { failureProbe = false } = {}) {
  const migrations = join(root, "migrations");
  mkdirSync(migrations, { recursive: true });
  copyFileSync(join(migrationsRoot, "migration_lock.toml"), join(migrations, "migration_lock.toml"));
  for (const name of directories) {
    mkdirSync(join(migrations, name), { recursive: true });
    copyFileSync(join(migrationsRoot, name, "migration.sql"), join(migrations, name, "migration.sql"));
  }
  if (failureProbe) {
    const name = "20990101000000_af075_failure_probe";
    mkdirSync(join(migrations, name));
    writeFileSync(join(migrations, name, "migration.sql"), [
      "BEGIN;",
      'CREATE TABLE "af075_failure_probe" ("id" TEXT PRIMARY KEY);',
      `INSERT INTO "af075_failure_probe" ("id") VALUES ('${randomBytes(8).toString("hex")}');`,
      "SELECT 1 / 0;",
      "COMMIT;",
      ""
    ].join("\n"));
  }
  const schema = join(root, "schema.prisma");
  // migrate deploy reads the datasource provider and this workspace's migration chain.
  // The historical SQL remains an exact copy; no source migration is edited.
  copyFileSync(schemaPath, schema);
  return { schema, migrations };
}

function runPrisma(workspace, values, password, stepRoot, name, action, expectedExit = 0) {
  const args = [prismaCli, "migrate", action, "--schema", workspace.schema];
  const child = spawnSync(process.execPath, args, {
    cwd: join(workspace.schema, ".."), encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024,
    env: { ...safeEnvironment(), DATABASE_URL: values.TEST_DATABASE_URL, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1" }
  });
  const rawStdout = child.stdout || "", rawStderr = child.stderr || "";
  assert.ok(!rawStdout.includes(password) && !rawStderr.includes(password) && !rawStdout.includes(encodeURIComponent(password)) && !rawStderr.includes(encodeURIComponent(password)), "Prisma output must not reveal the test database password");
  const stdout = redact(rawStdout, password), stderr = redact(rawStderr, password);
  writeEvidence(stepRoot, name, { command: [process.execPath, ...args], exitCode: child.status, signal: child.signal, stdout, stderr });
  assert.equal(child.error, undefined, child.error?.code);
  assert.equal(child.status, expectedExit, stdout + stderr);
  return { stdout, stderr, exitCode: child.status };
}

function runProtectedMigration(id, baseValues, password, stepRoot, label, action, expectedExit = 0) {
  const args = ["scripts/db-migrate.mjs", "test", action, "--acceptance", id];
  const child = spawnSync(process.execPath, args, {
    cwd: repositoryRoot, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    env: { ...safeEnvironment(), TEST_DATABASE_URL: baseValues.TEST_DATABASE_URL, RUNTIME_PROFILE: "host", PROJECT_ID: "aij-foundation" }
  });
  const rawStdout = child.stdout || "", rawStderr = child.stderr || "";
  assert.ok(!rawStdout.includes(password) && !rawStderr.includes(password) && !rawStdout.includes(encodeURIComponent(password)) && !rawStderr.includes(encodeURIComponent(password)), "Protected migration output must not reveal the test database password");
  const stdout = redact(rawStdout, password), stderr = redact(rawStderr, password);
  writeEvidence(stepRoot, "protected-" + label, { command: [process.execPath, ...args], exitCode: child.status, signal: child.signal, stdout, stderr });
  assert.equal(child.error, undefined, child.error?.code);
  assert.equal(child.status, expectedExit, stdout + stderr);
  const resultLine = (stdout + "\n" + stderr).split("\n").find((line) => line.startsWith("{"));
  return resultLine ? JSON.parse(resultLine) : undefined;
}

async function insertLegacySentinels(client, id) {
  const member = "af075-member-" + id;
  await client.query("INSERT INTO public.member_user(id,username,nickname,updated_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP)", [member, "synthetic-" + id, "AF-075 synthetic"]);
  await client.query("INSERT INTO public.client_auth_session(id,member_id,device_hash,device_summary,ip_hash,expires_at,updated_at) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP+INTERVAL '1 day',CURRENT_TIMESTAMP)", ["af075-session-" + id, member, "synthetic-device-hash", "synthetic device", "synthetic-ip-hash"]);
  await client.query("INSERT INTO public.client_consent_record(id,member_id,consent_type,granted,text_version,text_digest,source,updated_at) VALUES ($1,$2,'synthetic-test',true,'v1','synthetic-digest','test-fixture',CURRENT_TIMESTAMP)", ["af075-consent-" + id, member]);
  return { member, session: "af075-session-" + id, consent: "af075-consent-" + id };
}

async function databaseSnapshot(mode) {
  const values = readDatabaseEnvironment(mode);
  return withDatabase(mode, values, async (client) => ({
    tables: (await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname<>'information_schema' ORDER BY schemaname,tablename")).rows,
    sentinels: (await client.query("SELECT id,mode,instance_id,marker FROM af005_verification.sentinel ORDER BY id")).rows
  }));
}

export async function upgradeAcceptanceTests() {
  const artifactRoot = join(repositoryRoot, ".artifacts/af-075/schema-upgrade");
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  const before = await databaseSnapshot("test");
  const baseTestValues = readDatabaseEnvironment("test", process.env);
  const sourceFiles = readdirSync(migrationsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .map((entry) => join(migrationsRoot, entry.name, "migration.sql"));
  sourceFiles.push(schemaPath, join(migrationsRoot, "migration_lock.toml"));
  const sourceHashes = sourceFiles.map((file) => hash(readFileSync(file)));
  const directories = readdirSync(migrationsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith("._"))
    .map((entry) => entry.name).sort();
  assert.equal(directories[0], initialMigrationDir);
  assert.ok(directories.length >= 2);
  await preflight(["test"]);

  const success = await createAcceptance("test", "AF-075");
  const successRoot = mkdtempSync(join(artifactRoot, "success-"));
  const successValues = readDatabaseEnvironment("test", process.env, success.id);
  const successPassword = readFileSync(profile("test").secretFile, "utf8");
  assert.equal((await checkDatabase("test", successValues, { acceptanceId: success.id })).identity.database, success.database);
  writeEvidence(successRoot, "acceptance", { task: success.task, id: success.id, database: success.database, target: "127.0.0.1:55433", volumeRemoved: false });

  const legacyRoot = join(successRoot, "previous-version");
  mkdirSync(legacyRoot, { recursive: true });
  const legacy = createMigrationWorkspace(legacyRoot, [initialMigrationDir]);
  const legacyDeploy = runPrisma(legacy, successValues, successPassword, successRoot, "previous-version-deploy", "deploy");
  assert.match(legacyDeploy.stdout, /20261019000000_initial/);
  const previousStatus = runPrisma(legacy, successValues, successPassword, successRoot, "previous-version-status", "status");
  assert.match(previousStatus.stdout, /up to date/i);

  const sentinels = await withDatabase("test", successValues, (client) => insertLegacySentinels(client, success.id), { acceptanceId: success.id });
  writeEvidence(successRoot, "legacy-sentinels", sentinels);
  const first = runProtectedMigration(success.id, baseTestValues, successPassword, successRoot, "upgrade-deploy", "deploy");
  assert.equal(first.status, "DEPLOYED");
  const upgraded = await withDatabase("test", successValues, async (client) => {
    const ledger = (await client.query("SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name")).rows;
    const session = (await client.query("SELECT namespace,status FROM public.client_auth_session WHERE id=$1", [sentinels.session])).rows[0];
    const consent = (await client.query("SELECT namespace,granted FROM public.client_consent_record WHERE id=$1", [sentinels.consent])).rows[0];
    const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map((row) => row.tablename);
    assert.equal(session.namespace, "legacy-unscoped"); assert.equal(session.status, "active");
    assert.equal(consent.namespace, "legacy-unscoped"); assert.equal(consent.granted, true);
    assert.deepEqual(ledger.map((row) => row.migration_name), directories);
    assert.ok(ledger.every((row) => row.finished_at && row.rolled_back_at === null));
    assert.ok(tables.includes("client_workspace") && tables.includes("plugin_operation"));
    return { ledger, session, consent, tableCount: tables.length, tables };
  }, { acceptanceId: success.id });
  writeEvidence(successRoot, "upgraded-catalog", upgraded);
  assert.equal(runProtectedMigration(success.id, baseTestValues, successPassword, successRoot, "upgrade-status", "status").status, "UP_TO_DATE");
  assert.equal(runProtectedMigration(success.id, baseTestValues, successPassword, successRoot, "upgrade-repeat-deploy", "deploy").status, "DEPLOYED");
  const idempotentLedger = await withDatabase("test", successValues, async (client) =>
    (await client.query("SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name")).rows,
  { acceptanceId: success.id });
  assert.deepEqual(idempotentLedger, upgraded.ledger, "repeated deployment does not alter the migration ledger");

  const failure = await createAcceptance("test", "AF-075");
  const failureRoot = mkdtempSync(join(artifactRoot, "failure-"));
  const failureValues = readDatabaseEnvironment("test", process.env, failure.id);
  const failurePassword = successPassword;
  assert.equal((await checkDatabase("test", failureValues, { acceptanceId: failure.id })).identity.database, failure.database);
  const failureLegacyRoot = join(failureRoot, "previous-version");
  mkdirSync(failureLegacyRoot, { recursive: true });
  const failureLegacy = createMigrationWorkspace(failureLegacyRoot, [initialMigrationDir]);
  runPrisma(failureLegacy, failureValues, failurePassword, failureRoot, "previous-version-deploy", "deploy");
  const failureSentinels = await withDatabase("test", failureValues, (client) => insertLegacySentinels(client, failure.id), { acceptanceId: failure.id });
  const brokenRoot = join(failureRoot, "injected-failure");
  mkdirSync(brokenRoot, { recursive: true });
  const broken = createMigrationWorkspace(brokenRoot, directories, { failureProbe: true });
  const failedDeploy = runPrisma(broken, failureValues, failurePassword, failureRoot, "injected-failure-deploy", "deploy", 1);
  assert.match(failedDeploy.stdout + failedDeploy.stderr, /division by zero|1 \/ 0|migration/i);
  const failureState = await withDatabase("test", failureValues, async (client) => {
    const probe = await client.query("SELECT to_regclass('public.af075_failure_probe') AS table_name");
    const rows = (await client.query("SELECT migration_name,finished_at,rolled_back_at,logs FROM public._prisma_migrations WHERE migration_name='20990101000000_af075_failure_probe'")).rows;
    const session = (await client.query("SELECT status,namespace FROM public.client_auth_session WHERE id=$1", [failureSentinels.session])).rows[0];
    assert.equal(probe.rows[0].table_name, null, "transactional failed migration leaves no partial DDL");
    assert.equal(rows.length, 1); assert.equal(rows[0].finished_at, null); assert.equal(rows[0].rolled_back_at, null);
    // Prisma leaves its logs column null for this engine error; the complete sanitized CLI output is retained separately.
    assert.equal(rows[0].logs, null);
    assert.equal(session.status, "active"); assert.equal(session.namespace, "legacy-unscoped", "completed migrations before the failure remain applied");
    return { failedMigration: rows[0], partialTable: probe.rows[0].table_name, preservedSession: session, diagnosticArtifact: "injected-failure-deploy.json" };
  }, { acceptanceId: failure.id });
  writeEvidence(failureRoot, "failure-state", failureState);
  const rejectedStatus = runProtectedMigration(failure.id, baseTestValues, failurePassword, failureRoot, "failure-status", "status", 2);
  assert.equal(rejectedStatus.status, "REJECTED");
  assert.match(rejectedStatus.reason, /Migration history\/checksum is not the local applied chain/);
  const stillFailed = await withDatabase("test", failureValues, async (client) =>
    (await client.query("SELECT migration_name,finished_at,rolled_back_at FROM public._prisma_migrations WHERE migration_name='20990101000000_af075_failure_probe'")).rows[0],
  { acceptanceId: failure.id });
  assert.equal(stillFailed.finished_at, null); assert.equal(stillFailed.rolled_back_at, null);
  writeEvidence(failureRoot, "failure-policy", { statusCommand: rejectedStatus, ledgerRetained: true, automaticResolveOrReset: false, databasePreservedForOwnerInspection: failure.database });

  assert.deepEqual(await databaseSnapshot("test"), before, "repository test database tables and sentinel remain unchanged");
  assert.deepEqual(sourceFiles.map((file) => hash(readFileSync(file))), sourceHashes, "schema and all source migrations remain byte-for-byte unchanged");
  writeEvidence(artifactRoot, "result-" + randomBytes(4).toString("hex"), {
    status: "REAL_TEST_DATABASE_MIGRATION_UPGRADE_AND_FAILURE_POLICY_VERIFIED",
    successAcceptance: success.database,
    failureAcceptance: failure.database,
    previousVersionMigration: initialMigrationDir,
    currentMigrationCount: directories.length,
    preservedClientSessionAndConsent: true,
    legacyNamespaceBackfill: true,
    deployStatusIdempotent: true,
    failedMigrationTransactionRollback: true,
    failedLedgerAndSanitizedDiagnosticsArtifactRetained: true,
    failedDatabaseNotAutomaticallyRepairedOrDeleted: true,
    bootstrapTestDatabaseUnchanged: true,
    sourceMigrationAndSchemaHashesUnchanged: true,
    volumesStoppedOrRemoved: false
  });
  return { successDatabase: success.database, failureDatabase: failure.database, migrationCount: directories.length };
}
