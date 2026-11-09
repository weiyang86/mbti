import environment from "./runtime-environment.cjs";
import { DatabaseOperationError } from "./database/connection.mjs";
import { migrate, migrationArguments } from "./database/migration.mjs";

try { console.log(JSON.stringify(await migrate(migrationArguments(process.argv.slice(2))))); }
catch (error) {
  console.error(JSON.stringify({ status: "REJECTED", reason: error instanceof DatabaseOperationError || error instanceof environment.DatabaseTargetError ? error.message : "Local migration failed", ...(error instanceof DatabaseOperationError ? error.details : {}) }));
  process.exitCode = error.exitCode || 2;
}
