import pg from "pg";
import environment from "../runtime-environment.cjs";

// Shared policy is owned by runtime-environment; all tools and the API consume it.
export const { repositoryRoot, DatabaseOperationError, profile, assertLocalPath, acceptanceRecord, resolveDatabaseTarget, readDatabaseEnvironment } = environment;
export async function withDatabase(mode, input, operation, { acceptanceId } = {}) {
  const target = resolveDatabaseTarget(mode, input, acceptanceId);
  const password = decodeURIComponent(new URL(input[target.variable]).password);
  const client = new pg.Client({
    host: target.host, port: target.port, database: target.database, user: target.user, password,
    ssl: false, connectionTimeoutMillis: 3000, query_timeout: 5000, statement_timeout: 5000,
    application_name: "aij-af-005-" + mode, options: "-c search_path=pg_catalog"
  });
  client.on("error", () => {}); // Never allow raw driver errors/URLs to escape through an unhandled event.
  try {
    await client.connect();
    const { rows: [identity] } = await client.query(
      "SELECT current_database() AS database, current_user AS \"user\", session_user AS \"sessionUser\", " +
      "inet_server_port() AS \"serverPort\", current_setting('server_version') AS version, " +
      "pg_postmaster_start_time()::text AS \"startedAt\""
    );
    if (identity.database !== target.database || identity.user !== target.user ||
        identity.sessionUser !== target.user || identity.serverPort !== 5432) {
      throw new DatabaseOperationError("Connected database identity does not match the validated target", 3, { target, connectionAttempted: true });
    }
    return await operation(client, target, identity);
  } catch (error) {
    if (error instanceof DatabaseOperationError) throw error;
    const code = typeof error.code === "string" && /^[A-Z0-9]{3,30}$/.test(error.code) ? error.code : "UNAVAILABLE";
    throw new DatabaseOperationError("Database connection/query failed: " + code, 3, { target, connectionAttempted: true });
  } finally { await client.end().catch(() => {}); }
}
export async function checkDatabase(mode, input = readDatabaseEnvironment(mode), options = {}) {
  return withDatabase(mode, input, async (_client, target, identity) => ({
    status: "CONNECTED", connectionAttempted: true, target, identity
  }), options);
}
