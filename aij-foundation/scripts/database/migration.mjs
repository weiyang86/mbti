import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { schemaInvocation, apiRoot } from "../prisma-schema.mjs";
import { preflight } from "./managed.mjs";
import { acceptanceRecord, assertLocalPath, checkDatabase, DatabaseOperationError, profile, readDatabaseEnvironment, repositoryRoot, resolveDatabaseTarget, withDatabase } from "./connection.mjs";

export const migrationName = "20261019000000_initial";
export const schemaPath = join(apiRoot, "prisma/schema.prisma");
export const migrationPath = join(apiRoot, "prisma/migrations", migrationName, "migration.sql");
const hash = (value) => createHash("sha256").update(value).digest("hex");
function safeOutput(text, values, variable) {
  const url = new URL(values[variable]);
  for (const value of [values[variable], decodeURIComponent(url.password), url.password]) if (value) text = text.split(value).join("[REDACTED]");
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}
function evidence(value, task = "AF-010") {
  if (!/^AF-\d{3}(?:-[A-Z])?$/.test(task)) throw new DatabaseOperationError("Invalid evidence task identifier", 2);
  const directory = join(repositoryRoot, ".artifacts", task.toLowerCase(), "operations"); assertLocalPath(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, randomUUID() + ".json");
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return path;
}

// Explicit test preparation: create only a new, random, recorded database. Never adopt/drop/reset.
export async function createAcceptance(mode, task = "AF-010") {
  if (!["AF-010", "AF-011", "AF-012", "AF-013", "AF-014", "AF-015", "AF-016", "AF-017", "AF-018", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-024", "AF-025-A", "AF-026", "AF-027", "AF-028", "AF-029", "AF-030", "AF-031", "AF-032", "AF-033", "AF-035", "AF-036", "AF-037", "AF-038", "AF-039", "AF-040", "AF-041", "AF-042", "AF-043", "AF-044", "AF-045", "AF-046", "AF-047", "AF-048", "AF-049", "AF-050", "AF-051", "AF-052", "AF-053", "AF-054", "AF-055", "AF-056", "AF-057", "AF-058", "AF-063", "AF-068", "AF-069", "AF-070", "AF-071", "AF-072", "AF-075", "AF-081", "AF-082", "AF-083", "AF-084", "AF-085", "AF-086", "AF-087", "AF-088", "AF-089", "AF-090", "AF-092", "AF-093", "AF-094", "AF-095", "AF-096", "AF-097", "AF-098", "AF-099", "AF-100", "AF-101", "AF-102", "AF-104", "AF-105", "AF-106", "AF-107", "AF-108", "AF-109", "AF-110", "AF-111", "AF-112", "AF-113", "AF-114", "AF-115", "AF-116", "AF-118", "AF-119", "AF-120", "AF-121", "AF-122", "AF-123", "AF-124", "AF-138", "AF-141", "AF-142", "AF-145", "AF-146", "AF-151", "AF-149", "AF-150", "AF-154", "AF-158", "AF-159", "AF-161", "AF-162", "AF-163", "AF-166", "AF-165", "AF-167", "AF-170", "AF-169", "AF-173", "AF-177", "AF-178", "AF-179", "AF-181", "AF-182", "AF-189", "AF-190", "AF-198", "AF-201", "AF-202", "AF-203", "AF-205", "AF-206", "AF-207", "AF-209", "AF-210", "AF-211", "AF-214", "AF-215", "AF-191", "AF-221", "AF-223", "AF-224", "AF-225", "AF-227", "AF-228", "AF-229", "AF-232", "AF-213", "AF-218", "AF-217", "AF-157", "AF-155", "AF-153", "AF-193", "AF-194"].includes(task)) throw new DatabaseOperationError("Unregistered acceptance task", 2);
  const p = profile(mode), values = readDatabaseEnvironment(mode);
  resolveDatabaseTarget(mode, values);
  await preflight([mode]);
  return withDatabase(mode, values, async (client, target) => {
    const owner = JSON.parse(readFileSync(p.stateFile, "utf8"));
    const id = randomBytes(8).toString("hex"), database = "aij_foundation_" + task.toLowerCase().replaceAll("-", "") + "_" + mode + "_" + id;
    const { rows } = await client.query("SELECT datname FROM pg_database WHERE datname=$1", [database]);
    if (rows.length) throw new DatabaseOperationError("Acceptance name already exists; no adoption or reset", 2);
    const directory = join(repositoryRoot, ".local-data/postgres/acceptance"); assertLocalPath(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, id + ".json"); assertLocalPath(path);
    const record = { task, id, mode, database, repository: repositoryRoot, instanceId: owner.instanceId, schemaSha256: hash(readFileSync(schemaPath)), createdAt: new Date().toISOString(), ready: false };
    writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    // Both SQL identifiers are constructed from the exact protected profile and hex ID.
    await client.query('CREATE DATABASE "' + database + '" WITH TEMPLATE template0 OWNER "' + target.user + '"');
    record.ready = true; writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
    return { status: "CREATED_EMPTY_ACCEPTANCE", ...record, ownershipFile: path, bootstrapTarget: target };
  });
}

export function migrationArguments(args) {
  if (args.filter((a) => a === "--").length > 1) throw new DatabaseOperationError("Only one optional -- separator is allowed", 2);
  const [mode, action, flag, acceptanceId, ...extra] = args.filter((a) => a !== "--");
  profile(mode);
  if (!["deploy", "status"].includes(action) || extra.length || flag !== undefined && (flag !== "--acceptance" || acceptanceId === undefined)) {
    throw new DatabaseOperationError("Usage: db:migrate -- dev|test deploy|status [--acceptance ID]; no reset/dev/push/resolve", 2);
  }
  return { mode, action, acceptanceId };
}

// Kept as the single migration-history compatibility guard so restore/upgrade
// verification can exercise the same fail-closed check used before Prisma.
export function assertLocalMigrationLedger(migrations, ledger) {
  for (const row of ledger) if (!row.finished_at || row.rolled_back_at || !migrations.some((migration) => migration.name === row.migration_name && migration.checksum === row.checksum)) {
    throw new DatabaseOperationError("Migration history/checksum is not the local applied chain; no repair/reset", 2);
  }
  return true;
}

export async function migrate({ mode, action, acceptanceId }, input = process.env) {
  if (!["deploy", "status"].includes(action)) throw new DatabaseOperationError("Only migrate deploy/status are permitted", 2);
  const values = readDatabaseEnvironment(mode, input, acceptanceId);
  const target = resolveDatabaseTarget(mode, values, acceptanceId);
  // Same authenticated guard as db:check, before Prisma can connect or execute SQL.
  const checked = await checkDatabase(mode, values, { acceptanceId });
  await preflight([mode]);
  if (acceptanceId && acceptanceRecord(mode, acceptanceId).schemaSha256 !== hash(readFileSync(schemaPath))) {
    throw new DatabaseOperationError("Acceptance Schema differs from its creation snapshot", 2);
  }
  return withDatabase(mode, values, async (client) => {
    const { rows: [lock] } = await client.query("SELECT pg_try_advisory_lock(hashtext('aij-foundation-migrate'),hashtext(current_database())) AS locked");
    if (!lock.locked) throw new DatabaseOperationError("Another owned migration operation is active", 2);
    try {
      const directory = join(apiRoot, "prisma/migrations");
      const migrations = readdirSync(directory, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith("._")).map((e) => {
        if (!/^\d{14}_[a-z0-9_]+$/.test(e.name)) throw new DatabaseOperationError("Invalid local migration directory", 2);
        const path = join(directory, e.name, "migration.sql"); assertLocalPath(path);
        return { name: e.name, checksum: hash(readFileSync(path)) };
      });
      if (!migrations.length) throw new DatabaseOperationError("No local migrations registered", 2);
      const { rows: tables } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
      if (action === "deploy" && !tables.some((r) => r.tablename === "_prisma_migrations")) {
        const { rows: enums } = await client.query("SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'");
        if (tables.length || enums.length) throw new DatabaseOperationError("Initial deploy requires an empty public Schema; existing data left untouched", 2);
      }
      if (tables.some((r) => r.tablename === "_prisma_migrations")) {
        const { rows: ledger } = await client.query("SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations");
        assertLocalMigrationLedger(migrations, ledger);
      }
      const invocation = schemaInvocation(["validate"]);
      invocation.args = [invocation.args[0], "migrate", action, "--config", join(apiRoot, "prisma.config.mjs")];
      invocation.options.env.DATABASE_URL = values[target.variable];
      const child = spawnSync(invocation.command, invocation.args, invocation.options);
      const exitCode = child.status ?? (child.error?.code === "ETIMEDOUT" ? 124 : 1);
      const result = { command: [invocation.command, ...invocation.args], cwd: invocation.options.cwd, target, identity: checked.identity,
        exitCode, signal: child.signal, stdout: safeOutput(child.stdout || "", values, target.variable), stderr: safeOutput(child.stderr || "", values, target.variable) };
      const evidenceFile = evidence(result, acceptanceId ? acceptanceRecord(mode, acceptanceId).task : "AF-010");
      if (exitCode) throw new DatabaseOperationError("Prisma migrate " + action + " failed; inspect sanitized evidence", exitCode, { target, evidenceFile, childExitCode: exitCode });
      return { status: action === "deploy" ? "DEPLOYED" : "UP_TO_DATE", target, identity: checked.identity, exitCode, evidenceFile };
    } finally { await client.query("SELECT pg_advisory_unlock(hashtext('aij-foundation-migrate'),hashtext(current_database()))"); }
  }, { acceptanceId });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "create-acceptance") throw new DatabaseOperationError("Usage: migration.mjs create-acceptance dev|test", 2);
    console.log(JSON.stringify(await createAcceptance(process.argv[3])));
  } catch (error) {
    console.error(JSON.stringify({ status: "REJECTED", reason: error instanceof DatabaseOperationError ? error.message : "Acceptance preparation failed", ...(error instanceof DatabaseOperationError ? error.details : {}) }));
    process.exitCode = error.exitCode || 2;
  }
}
