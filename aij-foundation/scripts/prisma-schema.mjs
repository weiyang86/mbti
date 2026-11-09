import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const apiRoot = resolve(repositoryRoot, "apps/api");
const require = createRequire(resolve(apiRoot, "package.json"));

export function schemaInvocation(args, environment = process.env) {
  if (args.filter((arg) => arg === "--").length > 1) throw new Error("Only one optional -- separator is allowed");
  const actions = args.filter((arg) => arg !== "--");
  if (actions.length !== 1 || !["validate", "generate"].includes(actions[0])) {
    throw new Error("Usage: prisma-schema.mjs [--] <validate|generate>; no database operations");
  }
  for (const name of ["prisma", "@prisma/client"]) {
    if (require(name + "/package.json").version !== "6.19.3") throw new Error("Expected " + name + " 6.19.3");
  }
  // Compilation only: never load .env or inherit credentials, engine overrides or NODE_OPTIONS.
  // Port 1 is deliberately not a database endpoint. These two Prisma commands do not query it.
  const env = Object.fromEntries(Object.entries(environment).filter(([key]) =>
    /^(PATH|HOME|TMPDIR|TMP|TEMP|SystemRoot|WINDIR|LANG|LC_ALL|TZ)$/i.test(key)));
  Object.assign(env, {
    DATABASE_URL: "postgresql://aij_schema_compile@127.0.0.1:1/aij_schema_compile",
    CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1"
  });
  return {
    command: process.execPath,
    args: [require.resolve("prisma/build/index.js"), actions[0], "--config", resolve(apiRoot, "prisma.config.mjs")],
    options: { cwd: apiRoot, env, shell: false, encoding: "utf8", timeout: 60000, maxBuffer: 4 * 1024 * 1024 }
  };
}

export function runSchema(args) {
  let invocation;
  try { invocation = schemaInvocation(args); }
  catch (error) { console.error(error.message); return 2; }
  console.log("Prisma schema " + args.filter((arg) => arg !== "--")[0] + ": compilation only; no database connection or environment file loading");
  const result = spawnSync(invocation.command, invocation.args, invocation.options);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error("Prisma process failed: " + result.error.code);
  return result.status ?? (result.error?.code === "ETIMEDOUT" ? 124 : 1);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = runSchema(process.argv.slice(2));
}
