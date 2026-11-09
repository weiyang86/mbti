import { spawnSync } from "node:child_process";
import { join } from "node:path";
import pg from "pg";
import { assertLocalMigrationLedger } from "../database/migration.mjs";
import { schemaInvocation, apiRoot } from "../prisma-schema.mjs";
import { validateValues, refuse } from "./config.mjs";

export async function withAiLocalDatabase(values, operation) {
  const target = validateValues(values).databaseTarget;
  const client = new pg.Client({ ...target, password: decodeURIComponent(new URL(values.DATABASE_URL).password), ssl: false,
    connectionTimeoutMillis: 3000, query_timeout: 10000, statement_timeout: 10000, application_name: "aij-ai-local-development", options: "-c search_path=pg_catalog" });
  client.on("error", () => {});
  try {
    await client.connect();
    const { rows: [identity] } = await client.query('SELECT current_database() AS database,current_user AS "user",session_user AS "sessionUser",inet_server_port() AS "serverPort",current_setting(\'server_version_num\') AS version');
    assertDatabaseIdentity(identity, target);
    return await operation(client, target, identity);
  } catch (error) {
    if (error.exitCode) throw error;
    refuse("AI local database connection/query failed; no reset/recovery performed");
  } finally { await client.end().catch(() => {}); }
}
// Shared registered migration inventory, not a copied SQL chain.
export { localMigrations } from "../base-development/database.mjs";
import { localMigrations } from "../base-development/database.mjs";
export function assertDatabaseIdentity(identity, target) {
  if (identity?.database !== target.database || identity.user !== target.user || identity.sessionUser !== target.user || identity.serverPort !== 5432 || !/^16\d{4}$/.test(identity.version)) refuse("AI local authenticated database identity/version mismatch");
  return true;
}
export async function migrateAiLocal(values, action) {
  if (!["deploy", "status"].includes(action)) refuse("AI local permits only migration deploy/status");
  return withAiLocalDatabase(values, async client => {
    const { rows: [lock] } = await client.query("SELECT pg_try_advisory_lock(hashtext('aij-foundation-migrate'),hashtext(current_database())) AS locked");
    if (!lock.locked) refuse("Another AI local migration operation is active");
    try {
      const migrations = localMigrations();
      const { rows: tables } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
      if (tables.some(row => row.tablename === "_prisma_migrations")) {
        const { rows: ledger } = await client.query("SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations");
        assertLocalMigrationLedger(migrations, ledger);
      } else {
        const { rows: enums } = await client.query("SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'");
        if (tables.length || enums.length || action === "status") refuse("AI local initial deploy requires an empty public schema; no adoption");
      }
      const invocation = schemaInvocation(["validate"]);
      invocation.args = [invocation.args[0], "migrate", action, "--config", join(apiRoot, "prisma.config.mjs")];
      invocation.options.env.DATABASE_URL = values.DATABASE_URL;
      const child = spawnSync(invocation.command, invocation.args, invocation.options);
      if (child.status !== 0) refuse("AI local migration " + action + " failed; raw child output withheld; owned resources retained");
      return { status: action === "deploy" ? "DEPLOYED" : "UP_TO_DATE" };
    } finally { await client.query("SELECT pg_advisory_unlock(hashtext('aij-foundation-migrate'),hashtext(current_database()))"); }
  });
}
