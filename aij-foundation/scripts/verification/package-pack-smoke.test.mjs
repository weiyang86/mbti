import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const artifactsRoot = join(repositoryRoot, ".artifacts", "af-062");
const names = ["@aij/core", "@aij/contracts", "@aij/sdk"];
function run(command, args, cwd = repositoryRoot) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: false, timeout: 120000 });
  assert.equal(result.error, undefined, `${command} ${args.join(" ")}: ${result.error?.message}`);
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test("all AIJ packages pack and install for real ESM/CommonJS and declaration consumers", async t => {
  mkdirSync(artifactsRoot, { recursive: true, mode: 0o700 });
  const smokeRoot = mkdtempSync(join(artifactsRoot, "consumer-"));
  const packs = join(smokeRoot, "packs");
  const consumer = join(smokeRoot, "consumer");
  mkdirSync(packs);
  mkdirSync(consumer);

  const manifests = new Map();
  const tarballs = new Map();
  for (const name of names) {
    const packageDirectory = join(repositoryRoot, "packages", name.split("/")[1]);
    const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
    manifests.set(name, manifest);
    assert.equal(manifest.private, true, `${name} remains private`);
    assert.equal(manifest.license, "UNLICENSED", `${name} does not imply redistribution rights`);
    assert.deepEqual(manifest.files, ["dist"], `${name} packs only generated public output`);
    const before = new Set(readdirSync(packs));
    run("pnpm", ["pack", "--pack-destination", packs], packageDirectory);
    const created = readdirSync(packs).filter(file => file.endsWith(".tgz") && !file.startsWith("._") && !before.has(file));
    assert.equal(created.length, 1, `${name} pack creates exactly one tarball`);
    const tarball = join(packs, created[0]);
    tarballs.set(name, `file:../packs/${created[0]}`);

    const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n");
    for (const file of ["index.mjs", "index.cjs", "index.d.ts", "index.d.mts", "index.d.cts"]) {
      assert.ok(entries.includes(`package/dist/${file}`), `${name} tarball contains dist/${file}`);
    }
    const packedManifest = JSON.parse(execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }));
    assert.equal(packedManifest.name, name);
    assert.equal(packedManifest.private, true);
    assert.ok(packedManifest.exports?.["."]?.import?.default);
    assert.ok(packedManifest.exports?.["."]?.require?.default);
    if (name === "@aij/sdk") assert.equal(packedManifest.dependencies?.["@aij/contracts"], "0.1.0", "workspace:* is rewritten to a pack-consumable version");
    else assert.deepEqual(packedManifest.dependencies ?? {}, {});
  }

  await t.test("packed consumer installs only the local tarballs offline", () => {
    const dependencies = Object.fromEntries(names.map(name => [name, tarballs.get(name)]));
    writeFileSync(join(consumer, "package.json"), JSON.stringify({
      name: "aij-packed-consumer-smoke", private: true, type: "module", dependencies,
      pnpm: { overrides: { "@aij/contracts": tarballs.get("@aij/contracts") } }
    }, null, 2) + "\n");
    run("pnpm", ["--dir", consumer, "install", "--offline", "--ignore-workspace", "--store-dir", join(artifactsRoot, "pnpm-store")]);
    for (const name of names) assert.ok(readdirSync(join(consumer, "node_modules", "@aij")).includes(name.split("/")[1]));
  });

  await t.test("packed ESM entry points run together", () => {
    writeFileSync(join(consumer, "consumer.mjs"), `import assert from "node:assert/strict";
import { resolveCorrelationId } from "@aij/core";
import { createSuccessEnvelope, isSuccessEnvelope } from "@aij/contracts";
import { createClientApi } from "@aij/sdk";
assert.equal(resolveCorrelationId("packed-id-123"), "packed-id-123");
const envelope = createSuccessEnvelope({ ok: true });
assert.equal(isSuccessEnvelope(envelope), true);
globalThis.fetch = async () => new Response(JSON.stringify(envelope), { status: 200 });
assert.deepEqual(await createClientApi(() => "http://packed.invalid/api")("/probe"), { ok: true });
`);
    run(process.execPath, [join(consumer, "consumer.mjs")], consumer);
  });

  await t.test("packed CommonJS entry points run together", () => {
    writeFileSync(join(consumer, "consumer.cjs"), `const assert = require("node:assert/strict");
const { resolveCorrelationId } = require("@aij/core");
const { createSuccessEnvelope, isSuccessEnvelope } = require("@aij/contracts");
const { createClientApi } = require("@aij/sdk");
assert.equal(resolveCorrelationId("packed-id-123"), "packed-id-123");
const envelope = createSuccessEnvelope({ ok: true });
assert.equal(isSuccessEnvelope(envelope), true);
globalThis.fetch = async () => new Response(JSON.stringify(envelope), { status: 200 });
(async () => {
  const value = await createClientApi(() => "http://packed.invalid/api")("/probe");
  assert.deepEqual(value, { ok: true });
})().catch(error => { console.error(error); process.exitCode = 1; });
`);
    run(process.execPath, [join(consumer, "consumer.cjs")], consumer);
  });

  await t.test("packed import and require declarations typecheck in separate module consumers", () => {
    writeFileSync(join(consumer, "consumer.mts"), `import { createSuccessEnvelope, type SuccessEnvelope } from "@aij/contracts";
import { createClientApi, type ClientApi } from "@aij/sdk";
import { resolveCorrelationId } from "@aij/core";
const envelope: SuccessEnvelope<number> = createSuccessEnvelope(1);
const client: ClientApi = createClientApi(() => "http://example.invalid");
void [envelope, client, resolveCorrelationId("packed-id-123")];
`);
    writeFileSync(join(consumer, "consumer.cts"), `import contracts = require("@aij/contracts");
import sdk = require("@aij/sdk");
import core = require("@aij/core");
const envelope: contracts.SuccessEnvelope<number> = contracts.createSuccessEnvelope(2);
const client: sdk.ClientApi = sdk.createClientApi(() => "http://example.invalid");
void [envelope, client, core.resolveCorrelationId("packed-id-123")];
`);
    run(process.execPath, [join(repositoryRoot, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--lib", "ES2022,DOM", "consumer.mts", "consumer.cts"], consumer);
  });

  const evidence = {
    packages: names.map(name => ({ name, tarball: tarballs.get(name), private: manifests.get(name).private, license: manifests.get(name).license })),
    packedConsumer: "offline local tarball install",
    conditions: ["ESM runtime", "CommonJS runtime", "ESM declarations", "CommonJS declarations"],
    consumerDirectory: smokeRoot
  };
  writeFileSync(join(smokeRoot, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(evidence));
});
