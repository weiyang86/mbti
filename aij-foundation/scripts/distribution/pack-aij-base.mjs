import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const packageSource = join(repositoryRoot, "scripts/distribution/aij-base");
const artifactsRoot = join(repositoryRoot, ".artifacts/af-077");
const runId = `${new Date().toISOString().replaceAll(/[^0-9TZ]/g, "")}-${randomBytes(3).toString("hex")}`;
const runRoot = join(artifactsRoot, `pack-${runId}`);
const stageRoot = join(runRoot, "package");
const templateRoot = join(stageRoot, "template", "aij-foundation");
const packRoot = join(runRoot, "pack-output");
const sourceArchive = join(stageRoot, "template", "aij-foundation.tgz");

const safeRootFiles = new Set(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".gitignore"]);
const forbiddenPathParts = new Set([".git", ".artifacts", "node_modules", "dist", "build", ".next", "coverage", ".local-data", "runtime-data", "uploads", "storage", "backups"]);
const forbiddenExtensions = /(?:\.pem|\.key|\.p12|\.pfx|\.dump|\.sqlite\d*|\.db|\.log|\.sql\.gz)$/i;

function includeSourcePath(path) {
  const parts = path.split("/");
  if (parts.length === 1) return safeRootFiles.has(path);
  const top = parts[0];
  if (!new Set(["apps", "packages", "scripts"]).has(top)) return false;
  if (parts.some(part => forbiddenPathParts.has(part))) return false;
  if (path.startsWith("scripts/verification/") || path.startsWith("scripts/test/") || path.startsWith("scripts/distribution/")) return false;
  const name = parts.at(-1);
  if (name.startsWith(".env") && name !== ".env.example" && !name.endsWith(".example")) return false;
  if (forbiddenExtensions.test(name)) return false;
  return true;
}

function assertPlainFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Refuse to pack non-regular source: ${path}`);
  return stat;
}

function collectSourceFiles() {
  const listed = execFileSync("git", ["--no-optional-locks", "ls-files", "-z"], { cwd: repositoryRoot, encoding: "buffer" })
    .toString("utf8").split("\0").filter(Boolean);
  const paths = listed.filter(includeSourcePath).sort();
  for (const required of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "apps/api/package.json", "apps/web/package.json", "apps/api/prisma/schema.prisma", "scripts/run-app.mjs", "scripts/runtime-environment.cjs"]) {
    if (!paths.includes(required)) throw new Error(`Required source file is not tracked: ${required}`);
  }
  return paths;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function removeAppleDouble(root) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.name.startsWith("._")) {
      rmSync(path, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      removeAppleDouble(path);
    }
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: false, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result.stdout;
}

mkdirSync(runRoot, { recursive: false, mode: 0o700 });
mkdirSync(packRoot, { recursive: true, mode: 0o700 });
mkdirSync(templateRoot, { recursive: true, mode: 0o700 });
mkdirSync(join(stageRoot, "dist"), { recursive: true, mode: 0o755 });
mkdirSync(join(stageRoot, "bin"), { recursive: true, mode: 0o755 });

const packagedFiles = [];
for (const relativePath of collectSourceFiles()) {
  const source = resolve(repositoryRoot, relativePath);
  const stat = assertPlainFile(source);
  const target = join(templateRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
  copyFileSync(source, target);
  chmodSync(target, stat.mode & 0o777);
  packagedFiles.push({ path: `aij-foundation/${relativePath.split(sep).join("/")}`, sha256: sha256(target) });
}

removeAppleDouble(templateRoot);
run("tar", ["-czf", sourceArchive, "-C", join(stageRoot, "template"), "aij-foundation"], repositoryRoot);
for (const sourceFile of ["package.json"]) copyFileSync(join(packageSource, sourceFile), join(stageRoot, sourceFile));
for (const sourceFile of ["runtime.cjs", "index.mjs", "index.cjs", "index.d.mts", "index.d.cts"]) {
  copyFileSync(join(packageSource, "src", sourceFile), join(stageRoot, "dist", sourceFile));
}
copyFileSync(join(packageSource, "bin/aij-base.cjs"), join(stageRoot, "bin/aij-base.cjs"));
chmodSync(join(stageRoot, "bin/aij-base.cjs"), 0o755);

removeAppleDouble(stageRoot);
run("pnpm", ["pack", "--pack-destination", packRoot], stageRoot);
removeAppleDouble(packRoot);
const tarballs = readdirSync(packRoot).filter(file => !file.startsWith("._") && file.endsWith(".tgz"));
if (tarballs.length !== 1) throw new Error(`Expected one local tarball, got ${tarballs.length}`);
const tarball = join(packRoot, tarballs[0]);
const outerEntries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).split("\n").filter(Boolean);
for (const expected of ["package/package.json", "package/dist/index.mjs", "package/dist/index.cjs", "package/dist/index.d.mts", "package/dist/index.d.cts", "package/bin/aij-base.cjs", "package/template/aij-foundation.tgz"]) {
  if (!outerEntries.includes(expected)) throw new Error(`Tarball missing ${expected}`);
}
const manifest = {
  package: "@aij/base",
  version: "0.1.0",
  private: true,
  localOnly: true,
  tarball: relative(repositoryRoot, tarball),
  tarballSha256: sha256(tarball),
  sourceArchiveSha256: sha256(sourceArchive),
  sourceFileCount: packagedFiles.length,
  sourceFiles: packagedFiles,
  outerEntries,
  licenseDecision: "PENDING_OWNER_DECISION",
  publication: "NOT_AUTHORIZED",
  supportedPlatforms: "PENDING_OWNER_DECISION"
};
const manifestPath = join(runRoot, "pack-manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ status: "PACKED_LOCAL_PRIVATE_CONSUMER", tarball: manifest.tarball, tarballSha256: manifest.tarballSha256, manifest: relative(repositoryRoot, manifestPath), sourceFileCount: manifest.sourceFileCount }));
