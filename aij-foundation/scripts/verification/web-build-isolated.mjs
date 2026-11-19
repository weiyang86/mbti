import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const task = process.argv[2] ?? "AF-035";
if (process.argv.length > 3 || !["AF-035", "AF-036", "AF-037", "AF-038", "AF-043", "AF-048", "AF-061", "AF-062", "AF-064", "AF-065", "AF-066", "AF-086", "AF-087", "AF-088", "AF-090", "AF-095", "AF-096", "AF-101", "AF-106", "AF-119", "AF-120", "AF-124", "AF-141", "AF-142", "AF-146", "AF-149", "AF-150", "AF-158", "AF-162", "AF-166", "AF-169", "AF-173", "AF-177", "AF-178", "AF-181", "AF-182", "AF-189", "AF-190", "AF-194", "AF-203", "AF-214", "AF-213", "AF-218", "AF-217", "AF-191", "AF-221", "AF-225"].includes(task)) {
  process.stderr.write("Usage: web-build-isolated.mjs [AF-035|AF-036|AF-037|AF-038|AF-043|AF-048|AF-061|AF-062|AF-064|AF-065|AF-066|AF-086|AF-087|AF-088|AF-090|AF-095|AF-096|AF-101|AF-106]\n");
  process.exit(2);
}
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|TMPDIR|TMP|TEMP|SystemRoot|WINDIR|CI|LANG|LC_ALL|TZ)$/i.test(key)));
environment.AIJ_NEXT_DIST_DIR = ".next-" + task.toLowerCase().replaceAll("-", "");
environment.NEXT_TELEMETRY_DISABLED = "1";
if (["AF-090", "AF-124", "AF-141", "AF-142", "AF-146", "AF-149", "AF-150", "AF-158", "AF-162", "AF-166", "AF-169", "AF-173", "AF-177", "AF-178", "AF-181", "AF-182", "AF-189", "AF-190", "AF-194", "AF-203", "AF-214", "AF-213", "AF-218", "AF-217", "AF-191", "AF-221", "AF-225"].includes(task)) {
  environment.APP_ENV = "test";
  environment.RUNTIME_PROFILE = "host";
  environment.PROJECT_ID = "aij-foundation";
  environment.AIJ_TEST_API_URL = "/api";
}
const tsconfigPath = resolve("apps/web/tsconfig.json");
const nextEnvPath = resolve("apps/web/next-env.d.ts");
const tsconfigBefore = readFileSync(tsconfigPath);
const nextEnvBefore = readFileSync(nextEnvPath);
let result;
try {
  result = spawnSync("pnpm", ["--filter", "@aij/web", "build"], { env: environment, stdio: "inherit", shell: false });
} finally {
  writeFileSync(tsconfigPath, tsconfigBefore);
  writeFileSync(nextEnvPath, nextEnvBefore);
}
if (result.error) {
  process.stderr.write("Isolated Web build could not start: " + (result.error.code || "SPAWN_FAILED") + "\n");
  process.exitCode = 127;
} else process.exitCode = result.status ?? 1;
