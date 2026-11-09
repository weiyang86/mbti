import environment from "../runtime-environment.cjs";
import { DatabaseOperationError } from "./connection.mjs";
import { preflight, upDatabases, lifecycle, cleanup, prepareManual } from "./managed.mjs";

try {
  const args = process.argv.slice(2);
  if (args.filter((arg) => arg === "--").length > 1) throw new DatabaseOperationError("Only one optional -- separator is allowed", 2);
  const [action, mode, ...rest] = args.filter((arg) => arg !== "--");
  let result;
  if (["preflight", "prepare-manual"].includes(action) && mode === undefined && !rest.length) {
    result = action === "preflight" ? await preflight() : await prepareManual();
  } else if (["up", "stop", "restart", "cleanup"].includes(action) && ["dev", "test", "both"].includes(mode) && !rest.length) {
    const modes = mode === "both" ? ["dev", "test"] : [mode];
    result = action === "up" ? await upDatabases(modes) : action === "cleanup" ? await cleanup(modes) : await lifecycle(action, modes);
  } else throw new DatabaseOperationError("Usage: db:up|db:stop|db:restart|db:cleanup -- dev|test|both", 2);
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({
    status: "REJECTED",
    reason: error instanceof DatabaseOperationError || error instanceof environment.DatabaseTargetError ? error.message : "Local database operation failed safely",
    ...(error instanceof DatabaseOperationError ? error.details : {})
  }));
  process.exitCode = error.exitCode || 2;
}
