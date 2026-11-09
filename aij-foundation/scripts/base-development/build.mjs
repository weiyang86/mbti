import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths, profile, root, publicEnvironment, systemEnvironment, assertPath, writePrivate, refuse, redact } from "./config.mjs";
import { localMigrations } from "./database.mjs";

const apiRoot = join(root, "apps/api"), webRoot = join(root, "apps/web");
const apiRequire = createRequire(join(apiRoot, "package.json"));
const webRequire = createRequire(join(webRoot, "package.json"));
export function buildPlan() {
  return [
    { application: "api", binary: apiRequire.resolve("typescript/bin/tsc"), args: ["-p", join(apiRoot, "tsconfig.json"), "--outDir", profile.apiOutput, "--incremental", "false"], cwd: apiRoot, env: { ...systemEnvironment(), NODE_ENV: "development" } },
    { application: "web", binary: webRequire.resolve("next/dist/bin/next"), args: ["build", "--webpack"], cwd: webRoot, env: { ...systemEnvironment(), ...publicEnvironment(), NODE_ENV: "production" } }
  ];
}
export function launchPlan(application, values) {
  if (application === "api") return { binary: join(profile.apiOutput, "main.js"), args: [], cwd: apiRoot, env: { ...systemEnvironment(), ...values, NODE_ENV: "development" } };
  if (application === "web") return { binary: webRequire.resolve("next/dist/bin/next"), args: ["start", "--port", "3855", "--hostname", "127.0.0.1"], cwd: webRoot, env: { ...systemEnvironment(), ...publicEnvironment(), NODE_ENV: "production" } };
  refuse("Unknown Base application");
}
function schemaFingerprint() { return createHash("sha256").update(JSON.stringify(localMigrations())).digest("hex"); }
export function hasBuild(owner) {
  for (const path of [paths.build, join(profile.apiOutput, "main.js"), join(profile.webOutput, "BUILD_ID")]) {
    assertPath(path);
    if (!existsSync(path)) return false;
  }
  const saved = JSON.parse(readFileSync(paths.build, "utf8"));
  return saved.status === "READY" && saved.instanceId === owner.instanceId && saved.migrations === schemaFingerprint();
}
export function buildApplications(owner, values) {
  for (const path of [profile.apiOutput, profile.webOutput]) assertPath(path);
  writePrivate(paths.build, { instanceId: owner.instanceId, status: "BUILDING" });
  const snapshots = ["tsconfig.json", "next-env.d.ts"].map(name => ({ path: join(webRoot, name), bytes: readFileSync(join(webRoot, name)) }));
  try {
    for (const plan of buildPlan()) {
      const child = spawnSync(process.execPath, [plan.binary, ...plan.args], { cwd: plan.cwd, env: plan.env, encoding: "utf8", timeout: 600000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      if (child.status !== 0) refuse("Isolated Base " + plan.application + " build failed: " + redact(child.stderr || child.stdout || "command failed", values));
    }
  } finally {
    for (const saved of snapshots) writeFileSync(saved.path, saved.bytes);
  }
  writePrivate(paths.build, { status: "READY", instanceId: owner.instanceId, migrations: schemaFingerprint(), builtAt: new Date().toISOString() });
}
