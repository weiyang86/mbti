import { seedArguments, seedDatabase, SeedError } from "./database/seed.mjs";
import environment from "./runtime-environment.cjs";
import { DatabaseOperationError } from "./database/connection.mjs";

try { console.log(JSON.stringify(await seedDatabase(seedArguments(process.argv.slice(2))))); }
catch (error) {
  const known = error instanceof SeedError || error instanceof DatabaseOperationError || error instanceof environment.DatabaseTargetError;
  console.error(JSON.stringify({ status: "REJECTED", reason: known ? error.message : "Local seed failed; no credential or hash output", ...(error instanceof SeedError ? { code: error.code } : {}) }));
  process.exitCode = known && Number.isInteger(error.exitCode) ? error.exitCode : 2;
}
