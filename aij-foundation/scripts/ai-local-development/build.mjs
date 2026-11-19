import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths, profile, root, publicEnvironment, systemEnvironment, assertPath, writePrivate, refuse, validateOwner, validateValues, assertExplicitEnvironmentSupport } from "./config.mjs";
import { localMigrations } from "./database.mjs";

const apiRoot = join(root, "apps/api"), webRoot = join(root, "apps/web");
const apiRequire = createRequire(join(apiRoot, "package.json"));
const webRequire = createRequire(join(webRoot, "package.json"));
export function assertNoWebEnvironmentFiles(inspectPath = assertPath) {
  // Next loads these independently of the shared runtime reader, before next.config.
  // Refuse rather than read, rename, delete, or temporarily hide any user environment file.
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    if (inspectPath(join(webRoot, name))) refuse("Web environment files would bypass the public allowlist; left untouched");
  }
}
export function buildPlan() {
  return [
    { application: "api", binary: apiRequire.resolve("typescript/bin/tsc"), args: ["-p", join(apiRoot, "tsconfig.json"), "--outDir", profile.apiOutput, "--incremental", "false"], cwd: apiRoot, env: { ...systemEnvironment(), ...publicEnvironment(), NODE_ENV: "development" } },
    { application: "web", binary: webRequire.resolve("next/dist/bin/next"), args: ["build", "--webpack"], cwd: webRoot, env: { ...systemEnvironment(), ...publicEnvironment(), NODE_ENV: "production" } }
  ];
}
export function launchPlan(application, values) {
  if (application === "api") {
    validateValues(values);
    return { binary: join(profile.apiOutput, "main.js"), args: [], cwd: apiRoot, env: { ...systemEnvironment(), ...values, NODE_ENV: "development" } };
  }
  if (application === "web") return { binary: webRequire.resolve("next/dist/bin/next"), args: ["start", "--port", "3955", "--hostname", "127.0.0.1"], cwd: webRoot, env: { ...systemEnvironment(), ...publicEnvironment(), NODE_ENV: "production" } };
  refuse("Unknown AI local application");
}
function schemaFingerprint() { return createHash("sha256").update(JSON.stringify(localMigrations())).digest("hex"); }
export function assertBuildRecord(saved, owner) {
  validateOwner(owner);
  if (saved?.version !== 1 || saved.repository !== root || saved.instanceId !== owner.instanceId ||
      !["BUILDING", "READY"].includes(saved.status)) refuse("AI local build output lacks this repository/instance owner; no adoption");
  return saved;
}
function assertOutputTree(path) {
  const stat = assertPath(path);
  if (stat?.isDirectory()) for (const entry of readdirSync(path)) assertOutputTree(join(path, entry));
}
export function assertOutputOwnership(owner) {
  validateOwner(owner);
  for (const path of [profile.apiOutput, profile.webOutput]) {
    const stat = assertPath(path);
    if (stat && !stat.isDirectory()) refuse("AI local output path is not an owned directory; left untouched");
    assertOutputTree(path);
  }
  const marker = assertPath(paths.build, { restricted: true });
  if (!marker) {
    if ([profile.apiOutput, profile.webOutput].some(path => existsSync(path))) refuse("Existing AI local build output has no owner record; left untouched");
    return null;
  }
  if (!marker.isFile()) refuse("Invalid AI local build owner file");
  return assertBuildRecord(JSON.parse(readFileSync(paths.build, "utf8")), owner);
}
export function hasBuild(owner) {
  const saved = assertOutputOwnership(owner);
  if (!saved) return false;
  return saved.status === "READY" && saved.migrations === schemaFingerprint() &&
    [join(profile.apiOutput, "main.js"), join(profile.webOutput, "BUILD_ID")].every(path => assertPath(path)?.isFile());
}
export function buildApplications(owner, values) {
  validateValues(values); assertExplicitEnvironmentSupport(values); assertOutputOwnership(owner);
  assertNoWebEnvironmentFiles();
  const record = { version: 1, repository: root, instanceId: owner.instanceId };
  const snapshots = ["tsconfig.json", "next-env.d.ts"].map(name => {
    const path = join(webRoot, name); assertPath(path);
    return { path, bytes: readFileSync(path) };
  });
  writePrivate(paths.build, { ...record, status: "BUILDING" });
  try {
    for (const plan of buildPlan()) {
      const child = spawnSync(process.execPath, [plan.binary, ...plan.args], { cwd: plan.cwd, env: plan.env, encoding: "utf8", timeout: 600000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
      if (child.status !== 0) refuse("Isolated AI local " + plan.application + " build failed; raw child output withheld; outputs retained");
    }
  } finally {
    // Next may rewrite these generated configuration files; preserve their exact pre-build bytes.
    for (const saved of snapshots) { assertPath(saved.path); writeFileSync(saved.path, saved.bytes); }
  }
  writePrivate(paths.build, { ...record, status: "READY", migrations: schemaFingerprint(), builtAt: new Date().toISOString() });
}
