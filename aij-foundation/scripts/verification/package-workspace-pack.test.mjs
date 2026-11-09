import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const artifactsRoot = join(repositoryRoot, ".artifacts", "af-065");
const names = ["@aij/core", "@aij/contracts", "@aij/sdk", "@aij/runtime-contracts", "@aij/ui"];

function run(command, args, cwd = repositoryRoot, timeout = 240000) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell: false, timeout });
  assert.equal(result.error, undefined, `${command} ${args.join(" ")}: ${result.error?.message}`);
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function manifestFor(name) {
  return JSON.parse(readFileSync(join(repositoryRoot, "packages", name.split("/")[1], "package.json"), "utf8"));
}

test("API and Web workspace links resolve the built public exports from the real hosts", () => {
  const apiManifest = JSON.parse(readFileSync(join(repositoryRoot, "apps/api/package.json"), "utf8"));
  const webManifest = JSON.parse(readFileSync(join(repositoryRoot, "apps/web/package.json"), "utf8"));
  assert.equal(apiManifest.dependencies["@aij/core"], "workspace:*");
  assert.equal(apiManifest.dependencies["@aij/contracts"], "workspace:*");
  assert.equal(apiManifest.dependencies["@aij/runtime-contracts"], "workspace:*");
  assert.equal(webManifest.dependencies["@aij/sdk"], "workspace:*");
  assert.equal(webManifest.dependencies["@aij/ui"], "workspace:*");

  const apiRequire = createRequire(join(repositoryRoot, "apps/api/package.json"));
  const webRequire = createRequire(join(repositoryRoot, "apps/web/package.json"));
  const resolved = new Map([
    ["@aij/core", apiRequire.resolve("@aij/core")],
    ["@aij/contracts", apiRequire.resolve("@aij/contracts")],
    ["@aij/runtime-contracts", apiRequire.resolve("@aij/runtime-contracts")],
    ["@aij/sdk", webRequire.resolve("@aij/sdk")],
    ["@aij/ui", webRequire.resolve("@aij/ui")]
  ]);
  for (const [name, entry] of resolved) {
    assert.equal(entry, resolve(repositoryRoot, "packages", name.split("/")[1], "dist/index.cjs"), `${name} resolves through its workspace package entry`);
  }

  const core = apiRequire("@aij/core");
  const contracts = apiRequire("@aij/contracts");
  const runtime = apiRequire("@aij/runtime-contracts");
  const sdk = webRequire("@aij/sdk");
  const ui = webRequire("@aij/ui");
  assert.equal(core.resolveCorrelationId("workspace-id-123"), "workspace-id-123");
  assert.equal(contracts.isSuccessEnvelope(contracts.createSuccessEnvelope({ source: "workspace" })), true);
  assert.equal(new runtime.LocalStorageError("OBJECT_MISSING").code, "OBJECT_MISSING");
  assert.equal(typeof sdk.createClientApi, "function");
  assert.equal(typeof ui.PageHeading, "function");
});

test("five local tarballs install offline and satisfy import, require, and declaration consumers", async t => {
  mkdirSync(artifactsRoot, { recursive: true, mode: 0o700 });
  const smokeRoot = mkdtempSync(join(artifactsRoot, "consumer-"));
  const packs = join(smokeRoot, "packs");
  const consumer = join(smokeRoot, "consumer");
  mkdirSync(packs);
  mkdirSync(consumer);

  const manifests = new Map();
  const tarballs = new Map();
  const expectedDependencies = new Map([
    ["@aij/core", {}],
    ["@aij/contracts", {}],
    ["@aij/sdk", { "@aij/contracts": "0.1.0" }],
    ["@aij/runtime-contracts", {}],
    ["@aij/ui", {}]
  ]);
  for (const name of names) {
    const packageDirectory = join(repositoryRoot, "packages", name.split("/")[1]);
    const manifest = manifestFor(name);
    manifests.set(name, manifest);
    assert.equal(manifest.private, true, `${name} remains private`);
    assert.equal(manifest.license, "UNLICENSED", `${name} does not imply redistribution rights`);
    assert.deepEqual(manifest.files, ["dist"], `${name} packs only generated public output`);
    const before = new Set(readdirSync(packs));
    run("pnpm", ["pack", "--pack-destination", packs], packageDirectory);
    const created = readdirSync(packs).filter(file => file.endsWith(".tgz") && !file.startsWith("._") && !before.has(file));
    assert.equal(created.length, 1, `${name} pack creates exactly one local tarball`);
    const tarball = join(packs, created[0]);
    tarballs.set(name, `file:../packs/${created[0]}`);

    const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n");
    for (const file of ["index.mjs", "index.cjs", "index.d.ts", "index.d.mts", "index.d.cts"]) {
      assert.ok(entries.includes(`package/dist/${file}`), `${name} tarball contains dist/${file}`);
    }
    const packedManifest = JSON.parse(execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }));
    assert.equal(packedManifest.name, name);
    assert.equal(packedManifest.private, true);
    assert.equal(packedManifest.license, "UNLICENSED");
    assert.equal(packedManifest.exports?.["."]?.import?.default, "./dist/index.mjs");
    assert.equal(packedManifest.exports?.["."]?.require?.default, "./dist/index.cjs");
    assert.equal(packedManifest.exports?.["."]?.import?.types, "./dist/index.d.mts");
    assert.equal(packedManifest.exports?.["."]?.require?.types, "./dist/index.d.cts");
    assert.deepEqual(packedManifest.dependencies ?? {}, expectedDependencies.get(name));
    if (name === "@aij/ui") assert.deepEqual(packedManifest.peerDependencies, { react: "^19.2.0" });
  }

  await t.test("consumer installs all local packages and React peer dependencies offline", () => {
    const dependencies = Object.fromEntries(names.map(name => [name, tarballs.get(name)]));
    const hostNodeModules = join(repositoryRoot, "node_modules");
    dependencies.react = `link:${relative(consumer, join(hostNodeModules, "react"))}`;
    dependencies["react-dom"] = `link:${relative(consumer, join(hostNodeModules, "react-dom"))}`;
    writeFileSync(join(consumer, "package.json"), JSON.stringify({
      name: "aij-af065-packed-consumer", private: true, type: "module", dependencies,
      devDependencies: { "@types/react": `link:${relative(consumer, join(hostNodeModules, "@types/react"))}` },
      pnpm: { overrides: { "@aij/contracts": tarballs.get("@aij/contracts") } }
    }, null, 2) + "\n");
    run("pnpm", ["--dir", consumer, "install", "--offline", "--ignore-workspace", "--ignore-scripts", "--store-dir", join(artifactsRoot, "pnpm-store")]);
    for (const name of names) assert.ok(readdirSync(join(consumer, "node_modules", "@aij")).includes(name.split("/")[1]));
  });

  await t.test("packed ESM entry points execute with their real peer", () => {
    writeFileSync(join(consumer, "consumer.mjs"), `import assert from "node:assert/strict";
import { resolveCorrelationId } from "@aij/core";
import { createSuccessEnvelope, isSuccessEnvelope } from "@aij/contracts";
import { createClientApi } from "@aij/sdk";
import { LocalStorageError } from "@aij/runtime-contracts";
import { PageHeading } from "@aij/ui";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
assert.equal(resolveCorrelationId("packed-id-123"), "packed-id-123");
const envelope = createSuccessEnvelope({ ok: true });
assert.equal(isSuccessEnvelope(envelope), true);
globalThis.fetch = async () => new Response(JSON.stringify(envelope), { status: 200 });
assert.deepEqual(await createClientApi(() => "http://packed.invalid/api")("/probe"), { ok: true });
assert.equal(new LocalStorageError("OBJECT_MISSING").code, "OBJECT_MISSING");
assert.ok(renderToStaticMarkup(React.createElement(PageHeading, { eyebrow: "Packed", title: "UI" })).includes("<h1>UI</h1>"));
`);
    run(process.execPath, [join(consumer, "consumer.mjs")], consumer);
  });

  await t.test("packed CommonJS entry points execute with their real peer", () => {
    writeFileSync(join(consumer, "consumer.cjs"), `const assert = require("node:assert/strict");
const { resolveCorrelationId } = require("@aij/core");
const { createSuccessEnvelope, isSuccessEnvelope } = require("@aij/contracts");
const { createClientApi } = require("@aij/sdk");
const { LocalStorageError } = require("@aij/runtime-contracts");
const { PageHeading } = require("@aij/ui");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
assert.equal(resolveCorrelationId("packed-id-123"), "packed-id-123");
const envelope = createSuccessEnvelope({ ok: true });
assert.equal(isSuccessEnvelope(envelope), true);
globalThis.fetch = async () => new Response(JSON.stringify(envelope), { status: 200 });
assert.equal(new LocalStorageError("OBJECT_MISSING").code, "OBJECT_MISSING");
assert.ok(renderToStaticMarkup(React.createElement(PageHeading, { eyebrow: "Packed", title: "UI" })).includes("<h1>UI</h1>"));
(async () => assert.deepEqual(await createClientApi(() => "http://packed.invalid/api")("/probe"), { ok: true }))()
  .catch(error => { console.error(error); process.exitCode = 1; });
`);
    run(process.execPath, [join(consumer, "consumer.cjs")], consumer);
  });

  await t.test("packed import and require declaration conditions typecheck", () => {
    writeFileSync(join(consumer, "consumer.mts"), `import { createSuccessEnvelope, type SuccessEnvelope } from "@aij/contracts";
import { createClientApi, type ClientApi } from "@aij/sdk";
import { resolveCorrelationId } from "@aij/core";
import { LocalStorageError, type RuntimeScope, type StorageAdapter } from "@aij/runtime-contracts";
import { PageHeading, type PageHeadingProps } from "@aij/ui";
const envelope: SuccessEnvelope<number> = createSuccessEnvelope(1);
const client: ClientApi = createClientApi(() => "http://example.invalid");
const scope: RuntimeScope = { type: "global", id: "synthetic" };
const storage: StorageAdapter = { relativePath: key => key, write: async () => ({ path: "x", size: 1 }), read: async () => new Uint8Array(), remove: async () => {}, exists: async () => true };
const heading: PageHeadingProps = { eyebrow: "Packed", title: "UI" };
void [envelope, client, resolveCorrelationId("packed-id-123"), new LocalStorageError("OBJECT_MISSING"), scope, storage, PageHeading, heading];
`);
    writeFileSync(join(consumer, "consumer.cts"), `import contracts = require("@aij/contracts");
import sdk = require("@aij/sdk");
import core = require("@aij/core");
import runtime = require("@aij/runtime-contracts");
import ui = require("@aij/ui");
const envelope: contracts.SuccessEnvelope<number> = contracts.createSuccessEnvelope(2);
const client: sdk.ClientApi = sdk.createClientApi(() => "http://example.invalid");
const scope: runtime.RuntimeScope = { type: "global", id: "synthetic" };
const heading: ui.PageHeadingProps = { eyebrow: "Packed", title: "UI" };
void [envelope, client, core.resolveCorrelationId("packed-id-123"), new runtime.LocalStorageError("OBJECT_MISSING"), scope, ui.PageHeading, heading];
`);
    run(process.execPath, [join(repositoryRoot, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--lib", "ES2022,DOM", "consumer.mts", "consumer.cts"], consumer);
  });

  const evidence = {
    packages: names.map(name => ({ name, version: manifests.get(name).version, private: manifests.get(name).private, license: manifests.get(name).license, tarball: tarballs.get(name) })),
    packedConsumer: "offline local tarball install; no publish",
    conditions: ["ESM runtime", "CommonJS runtime", "ESM declarations", "CommonJS declarations"],
    workspaceHosts: ["apps/api", "apps/web"],
    consumerDirectory: smokeRoot
  };
  writeFileSync(join(smokeRoot, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(evidence));
});
