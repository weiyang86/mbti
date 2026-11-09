import environment from "./runtime-environment.cjs";
import { checkDatabase, readDatabaseEnvironment, resolveDatabaseTarget, DatabaseOperationError } from "./database/connection.mjs";

// Explicit --config-only preserves the connection-free AF-004 policy check.
try {
  const args = process.argv.slice(2);
  const configOnly = args.includes("--config-only");
  const tokens = args.filter((arg) => !["--", "--config-only"].includes(arg));
  const [mode, flag, acceptanceId] = tokens;
  const validTokens = tokens.length === 1 || tokens.length === 3 && flag === "--acceptance";
  if (args.filter((arg) => arg === "--").length > 1 || args.filter((arg) => arg === "--config-only").length > 1 || !validTokens) {
    throw new environment.DatabaseTargetError("Usage: pnpm run db:check -- dev|test [--config-only] [--acceptance ID] (one optional --)");
  }
  const values = readDatabaseEnvironment(mode, process.env, acceptanceId);
  const target = resolveDatabaseTarget(mode, values, acceptanceId);
  console.log(JSON.stringify(configOnly ? { status: "CONFIG_VALID", connectionAttempted: false, target } : await checkDatabase(mode, values, { acceptanceId })));
} catch (error) {
  console.error(JSON.stringify({
    status: "REJECTED", connectionAttempted: false,
    reason: error instanceof environment.DatabaseTargetError || error instanceof DatabaseOperationError ? error.message : "Unable to read local database configuration",
    ...(error instanceof DatabaseOperationError ? error.details : {})
  }));
  process.exitCode = error.exitCode || 2;
}
