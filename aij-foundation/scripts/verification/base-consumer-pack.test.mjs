import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const artifactsRoot = join(repositoryRoot, ".artifacts", "af-077");
const runRoot = mkdtempSync(join(artifactsRoot, "consumer-test-"));
const packResult = spawnSync(process.execPath, ["scripts/distribution/pack-aij-base.mjs"], {
  cwd: repositoryRoot, encoding: "utf8", shell: false, timeout: 120000, maxBuffer: 8 * 1024 * 1024
});
assert.equal(packResult.error, undefined, `pack builder: ${packResult.error?.message}`);
assert.equal(packResult.status, 0, `pack builder failed\n${packResult.stdout}\n${packResult.stderr}`);
const buildOutput = JSON.parse(packResult.stdout.trim().split("\n").at(-1));
assert.equal(buildOutput.status, "PACKED_LOCAL_PRIVATE_CONSUMER");
const manifestPath = join(repositoryRoot, buildOutput.manifest);
const packManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const tarball = join(repositoryRoot, buildOutput.tarball);
assert.ok(existsSync(tarball), "local packed artifact exists");

const consumerRoot = join(runRoot, "consumer");
mkdirSync(consumerRoot, { recursive: true, mode: 0o700 });
const consumerPackage = {
  name: `aij-base-local-consumer-${process.pid}`,
  version: "0.0.0",
  private: true,
  type: "module",
  dependencies: { "@aij/base": `file:${tarball}` }
};
writeFileSync(join(consumerRoot, "package.json"), JSON.stringify(consumerPackage, null, 2) + "\n", { mode: 0o600, flag: "wx" });
const install = spawnSync("pnpm", ["install", "--offline", "--ignore-workspace", "--ignore-scripts", "--lockfile=false", "--store-dir", join(runRoot, "pnpm-store")], {
  cwd: consumerRoot, encoding: "utf8", shell: false, timeout: 120000, maxBuffer: 8 * 1024 * 1024
});
assert.equal(install.error, undefined, `consumer pnpm install: ${install.error?.message}`);
assert.equal(install.status, 0, `consumer pnpm install failed\n${install.stdout}\n${install.stderr}`);
const require = createRequire(join(consumerRoot, "package.json"));
const installedDirectory = join(consumerRoot, "node_modules", "@aij", "base");
const installedPackage = JSON.parse(readFileSync(join(installedDirectory, "package.json"), "utf8"));
const nestedArchive = join(installedDirectory, "template", "aij-foundation.tgz");
assert.equal(installedPackage.name, "@aij/base");
assert.equal(installedPackage.version, "0.1.0");
assert.equal(installedPackage.private, true);

test("aij-base local tarball installs in an isolated consumer and exposes ESM/CJS APIs", async (t) => {
  await t.test("pnpm pack contains only the declared private package surface and project archive", () => {
    assert.equal(packManifest.package, "@aij/base");
    assert.equal(packManifest.private, true);
    assert.equal(packManifest.localOnly, true);
    assert.equal(packManifest.licenseDecision, "PENDING_OWNER_DECISION");
    assert.equal(packManifest.publication, "NOT_AUTHORIZED");
    assert.equal(packManifest.supportedPlatforms, "PENDING_OWNER_DECISION");
    assert.ok(packManifest.sourceFileCount > 0);
    const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (const entry of ["package/package.json", "package/dist/index.mjs", "package/dist/index.cjs", "package/dist/index.d.mts", "package/dist/index.d.cts", "package/bin/aij-base.cjs", "package/template/aij-foundation.tgz"]) {
      assert.ok(entries.includes(entry), `packed export exists: ${entry}`);
    }
    assert.ok(entries.every(entry => !/(?:^|\/)(?:node_modules|\.git|\.artifacts|\.env(?:\.|$)|uploads|storage|backups)(?:\/|$)/.test(entry)), "outer package contains no local environment, dependency, repository, or customer-data path");
    const sourcePaths = packManifest.sourceFiles.map(file => file.path);
    assert.ok(sourcePaths.includes("aij-foundation/apps/api/package.json"));
    assert.ok(sourcePaths.includes("aij-foundation/apps/web/package.json"));
    assert.ok(sourcePaths.includes("aij-foundation/pnpm-lock.yaml"));
    assert.ok(sourcePaths.every(path => !/(?:^|\/)(?:node_modules|\.git|\.artifacts|\.local-data|uploads|storage|backups)(?:\/|$)/.test(path) && !/(?:^|\/)\.env(?!\.example$)(?:$|\/)/.test(path)), "curated project archive excludes protected local data");
  });

  await t.test("actual isolated pnpm install resolves the public ESM and CommonJS exports", async () => {
    const esmUrl = pathToFileURL(join(installedDirectory, "dist", "index.mjs")).href;
    const esm = await import(esmUrl);
    assert.deepEqual(esm.getPackageInfo(), {
      name: "@aij/base", version: "0.1.0", private: true, distribution: "LOCAL_PRIVATE_PACK_ONLY"
    });
    assert.deepEqual(Object.keys(esm).sort(), ["getPackageInfo", "materializeProject"]);
    assert.equal(realpathSync(require.resolve("@aij/base")), realpathSync(join(installedDirectory, "dist", "index.cjs")));
    const cjs = require("@aij/base");
    assert.deepEqual(cjs.getPackageInfo(), esm.getPackageInfo());
    assert.deepEqual(Object.keys(cjs).sort(), ["getPackageInfo", "materializeProject"]);
  });

  await t.test("installed package declarations resolve in real ESM and CJS TypeScript consumers", () => {
    writeFileSync(join(consumerRoot, "consumer.mts"), [
      'import { getPackageInfo, materializeProject, type MaterializedProject } from "@aij/base";',
      'const info = getPackageInfo();',
      'const installed: MaterializedProject = materializeProject({ destination: "./project" });',
      'const exactName: "@aij/base" = info.name;',
      'void [installed, exactName];'
    ].join("\n") + "\n", { mode: 0o600, flag: "wx" });
    writeFileSync(join(consumerRoot, "consumer.cts"), [
      'import base = require("@aij/base");',
      'const info: ReturnType<typeof base.getPackageInfo> = base.getPackageInfo();',
      'const result = base.materializeProject({ destination: "./project" });',
      'void [info, result];'
    ].join("\n") + "\n", { mode: 0o600, flag: "wx" });
    const tsc = join(repositoryRoot, "node_modules/typescript/bin/tsc");
    const checked = spawnSync(process.execPath, [tsc, "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "consumer.mts", "consumer.cts"], {
      cwd: consumerRoot, encoding: "utf8", shell: false, timeout: 30000, maxBuffer: 1024 * 1024
    });
    assert.equal(checked.error, undefined, `tsc: ${checked.error?.message}`);
    assert.equal(checked.status, 0, `installed type declarations failed to resolve\n${checked.stdout}\n${checked.stderr}`);
  });

  await t.test("installed CLI materializes the packed project and refuses overwrite or invalid options", () => {
    const target = join(runRoot, "materialized-project");
    const cli = join(installedDirectory, "bin", "aij-base.cjs");
    const installed = spawnSync(process.execPath, [cli, "install", "--dir", target], { encoding: "utf8", shell: false, timeout: 30000 });
    assert.equal(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
    const result = JSON.parse(installed.stdout.trim());
    assert.equal(result.status, "LOCAL_PROJECT_INSTALLED");
    assert.ok(result.filesWritten >= 5);
    assert.ok(existsSync(join(target, "package.json")));
    assert.ok(existsSync(join(target, "pnpm-lock.yaml")));
    assert.ok(existsSync(join(target, "pnpm-workspace.yaml")));
    assert.ok(existsSync(join(target, "apps/api/package.json")));
    assert.ok(existsSync(join(target, "apps/web/package.json")));

    const protectedTarget = join(runRoot, "do-not-overwrite");
    mkdirSync(protectedTarget, { mode: 0o700 });
    writeFileSync(join(protectedTarget, "sentinel.txt"), "preserve", { mode: 0o600, flag: "wx" });
    const refused = spawnSync(process.execPath, ["-e", `const b=require(${JSON.stringify(require.resolve("@aij/base"))});try{b.materializeProject({destination:${JSON.stringify(protectedTarget)}});process.exit(9)}catch(e){if(!e.message.includes("already exists"))process.exit(8)}`], {
      cwd: consumerRoot, encoding: "utf8", shell: false, timeout: 10000
    });
    assert.equal(refused.status, 0, refused.stderr);
    assert.equal(readFileSync(join(protectedTarget, "sentinel.txt"), "utf8"), "preserve");
    const invalid = spawnSync(process.execPath, [cli, "unknown"], { encoding: "utf8", shell: false, timeout: 10000 });
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /Usage: aij-base install/);
  });
});

test("isolated consumer and project materialization stay outside checkout runtime dependencies", () => {
  assert.ok(consumerRoot.startsWith(artifactsRoot));
  assert.ok(!resolve(join(consumerRoot, "node_modules", "@aij", "base")).startsWith(resolve(repositoryRoot, "apps")));
  assert.ok(existsSync(nestedArchive));
  assert.ok(readdirSync(runRoot).includes("consumer"));
  assert.ok(packManifest.sourceFileCount > 0);
});
