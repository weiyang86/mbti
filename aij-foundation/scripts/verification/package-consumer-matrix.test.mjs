import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const packagesRoot = resolve(repositoryRoot, "packages");
const artifactsRoot = join(repositoryRoot, ".artifacts", "af-066");
const packageNames = ["@aij/core", "@aij/contracts", "@aij/sdk", "@aij/runtime-contracts", "@aij/ui"];
const packageDirectories = new Map(packageNames.map(name => [name, resolve(packagesRoot, name.split("/")[1])]));
const expectedWorkspaceDependencies = {
  "@aij/core": {}, "@aij/contracts": {}, "@aij/sdk": { "@aij/contracts": "workspace:*" },
  "@aij/runtime-contracts": {}, "@aij/ui": {}
};
const expectedPackedDependencies = {
  "@aij/core": {}, "@aij/contracts": {}, "@aij/sdk": { "@aij/contracts": "0.1.0" },
  "@aij/runtime-contracts": {}, "@aij/ui": {}
};

function run(command, args, cwd = repositoryRoot, timeout = 180000) {
  return spawnSync(command, args, { cwd, encoding: "utf8", shell: false, timeout, maxBuffer: 4 * 1024 * 1024 });
}

function runOk(command, args, cwd = repositoryRoot, timeout = 180000) {
  const result = run(command, args, cwd, timeout);
  assert.equal(result.error, undefined, `${command} ${args.join(" ")}: ${result.error?.message}`);
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function manifest(name) {
  return JSON.parse(readFileSync(join(packageDirectories.get(name), "package.json"), "utf8"));
}

function assertVersionSatisfies(actual, range, label) {
  const version = actual.split(".").map(Number);
  assert.equal(version.length, 3, `${label}: valid semver version`);
  assert.ok(version.every(Number.isSafeInteger), `${label}: numeric semver version`);
  if (/^\d+\.\d+\.\d+$/.test(range)) {
    assert.equal(actual, range, `${label}: exact dependency version`);
    return;
  }
  if (range.startsWith("^")) {
    const minimum = range.slice(1).split(".").map(Number);
    const boundary = minimum[0] > 0 ? [minimum[0] + 1, 0, 0] : minimum[1] > 0 ? [0, minimum[1] + 1, 0] : [0, 0, minimum[2] + 1];
    const compare = (left, right) => left.findIndex((part, index) => part !== right[index]) < 0 ? 0 :
      left[left.findIndex((part, index) => part !== right[index])] < right[left.findIndex((part, index) => part !== right[index])] ? -1 : 1;
    assert.ok(compare(version, minimum) >= 0 && compare(version, boundary) < 0, `${label}: ${actual} satisfies ${range}`);
    return;
  }
  assert.equal(actual, range, `${label}: supported range is exact or caret`);
}

function consumerSource(kind, expectedEntries) {
  if (kind === "esm") return `import assert from "node:assert/strict";
import { resolveCorrelationId } from "@aij/core";
import { createSuccessEnvelope, isSuccessEnvelope } from "@aij/contracts";
import { createClientApi, createAiRunRecoveryClient, createPersonalSkillsClient, createPersonalAgentsClient, createPersonalAgentRunsClient, createPersonalMemoriesClient, createPersonalAgentRunPreviewsClient, createPersonalWorkflowsClient, createPersonalDocumentsClient, createExternalServicesApi } from "@aij/sdk";
import { LocalStorageError } from "@aij/runtime-contracts";
import { PageHeading } from "@aij/ui";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const expected = ${JSON.stringify(expectedEntries)};
for (const [name, entry] of Object.entries(expected)) assert.equal(import.meta.resolve(name), entry, name + " resolves to the ESM public export");
assert.equal(resolveCorrelationId("matrix-id-123"), "matrix-id-123");
const envelope = createSuccessEnvelope({ matrix: true });
assert.equal(isSuccessEnvelope(envelope), true);
globalThis.fetch = async () => new Response(JSON.stringify(envelope), { status: 200 });
assert.deepEqual(await createClientApi(() => "http://matrix.invalid")("/probe"), { matrix: true });
assert.equal(typeof createAiRunRecoveryClient, "function");
assert.equal(typeof createPersonalSkillsClient, "function");
assert.equal(typeof createPersonalAgentsClient, "function");
assert.equal(typeof createPersonalAgentRunsClient, "function");
assert.equal(typeof createPersonalMemoriesClient, "function");
assert.equal(typeof createPersonalAgentRunPreviewsClient,"function");
assert.equal(typeof createPersonalDocumentsClient,"function");
assert.equal(typeof createExternalServicesApi,"function");
assert.equal(typeof createPersonalWorkflowsClient,"function");
const workflows = createPersonalWorkflowsClient(async (path, options) => {assert.equal(path,"/client/ai/personal-workflows?limit=1");assert.equal(options.method,"GET");assert.equal(options.workspaceId,"space-123");return {items:[],nextCursor:null};});
workflows.list("space-123",{limit:1}).then(value=>assert.deepEqual(value.items,[])).catch(error=>{console.error(error);process.exitCode=1;});
const previews = createPersonalAgentRunPreviewsClient(async (path, options) => {assert.equal(path,"/client/ai/personal-agents/7ac902e2-d7fa-44f0-82bd-2a4c27f7c009/run-preview?expectedRevision=1");assert.equal(options.method,"GET");assert.equal(options.workspaceId,"space-123");assert.equal(options.body,undefined);return {maximumEstimatedCostNanos:"123",modelExecutionConfigured:false};});
previews.preview("space-123","7ac902e2-d7fa-44f0-82bd-2a4c27f7c009",1).then(value=>assert.equal(value.maximumEstimatedCostNanos,"123")).catch(error=>{console.error(error);process.exitCode=1;});

const memories = createPersonalMemoriesClient(async (path, options) => { assert.equal(path,"/client/ai/personal-memories");assert.equal(options.method,"POST");assert.equal(options.workspaceId,"space-123");assert.deepEqual(JSON.parse(options.body),{code:"explicit-memory",title:"Explicit",content:"Synthetic memory",kind:"preference",enabled:false,agentIds:[]});return {id:"memory-123"}; });
memories.create("space-123",{code:"explicit-memory",title:"Explicit",content:"Synthetic memory",kind:"preference"}).then(value=>assert.equal(value.id,"memory-123")).catch(error=>{console.error(error);process.exitCode=1;});
const personalRuns = createPersonalAgentRunsClient(async (path, options) => { assert.equal(path, "/client/ai/personal-agents/agent-123/runs"); assert.equal(options.workspaceId, "space-123"); assert.equal(options.method, "POST"); assert.deepEqual(JSON.parse(options.body), {input:{question:"Synthetic"},idempotencyKey:"opaque-key-123",expectedRevision:1}); return {id:"opaque-run"}; });
personalRuns.submit("space-123","agent-123",{input:{question:"Synthetic"},idempotencyKey:"opaque-key-123",expectedRevision:1}).then(value=>assert.equal(value.id,"opaque-run")).catch(error=>{console.error(error);process.exitCode=1;});
const agents = createPersonalAgentsClient(async (path, options) => { assert.equal(path, "/client/ai/personal-agents/model-options"); assert.equal(options.workspaceId, "space-123"); assert.equal(options.method, "GET"); return { catalogVersion: 1, items: [] }; });
agents.modelOptions("space-123").then(value => assert.equal(value.catalogVersion, 1)).catch(error => { console.error(error); process.exitCode = 1; });
const skills = createPersonalSkillsClient(async (path, options) => { assert.equal(path, "/client/ai/skills/skill-123/versions?limit=2"); assert.equal(options.workspaceId, "space-123"); assert.equal(options.method, "GET"); return { items: [], nextCursor: null }; });
skills.versions("space-123", "skill-123", { limit: 2 }).then(value => assert.deepEqual(value, { items: [], nextCursor: null })).catch(error => { console.error(error); process.exitCode = 1; });
const recovery = createAiRunRecoveryClient(async (path, options) => { assert.equal(path, "/client/ai/run-requests/opaque-key-123"); assert.equal(options.workspaceId, "space-123"); assert.equal(options.method, "GET"); return { id: "opaque-run" }; });
const pending = recovery.recoverRequest("space-123", "opaque-key-123");
pending.then(value => assert.equal(value.id, "opaque-run")).catch(error => { console.error(error); process.exitCode = 1; });
assert.equal(new LocalStorageError("OBJECT_MISSING").code, "OBJECT_MISSING");
assert.ok(renderToStaticMarkup(React.createElement(PageHeading, { eyebrow: "Matrix", title: "Consumer" })).includes("<h1>Consumer</h1>"));
`;
  if (kind === "cjs") return `const assert = require("node:assert/strict");
const { resolveCorrelationId } = require("@aij/core");
const { createSuccessEnvelope, isSuccessEnvelope } = require("@aij/contracts");
const { createClientApi, createAiRunRecoveryClient, createPersonalSkillsClient, createPersonalAgentsClient, createPersonalAgentRunsClient, createPersonalMemoriesClient, createPersonalAgentRunPreviewsClient, createPersonalWorkflowsClient, createPersonalDocumentsClient, createExternalServicesApi } = require("@aij/sdk");
const { LocalStorageError } = require("@aij/runtime-contracts");
const { PageHeading } = require("@aij/ui");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
assert.equal(resolveCorrelationId("matrix-id-123"), "matrix-id-123");
const envelope = createSuccessEnvelope({ matrix: true });
assert.equal(isSuccessEnvelope(envelope), true);
global.fetch = async () => new Response(JSON.stringify(envelope), { status: 200 });
assert.equal(typeof createAiRunRecoveryClient, "function");
assert.equal(typeof createPersonalSkillsClient, "function");
assert.equal(typeof createPersonalAgentsClient, "function");
assert.equal(typeof createPersonalAgentRunsClient, "function");
assert.equal(typeof createPersonalMemoriesClient, "function");
assert.equal(typeof createPersonalAgentRunPreviewsClient,"function");
assert.equal(typeof createPersonalDocumentsClient,"function");
assert.equal(typeof createExternalServicesApi,"function");
assert.equal(typeof createPersonalWorkflowsClient,"function");
const workflows = createPersonalWorkflowsClient(async (path, options) => {assert.equal(path,"/client/ai/personal-workflows?limit=1");assert.equal(options.method,"GET");assert.equal(options.workspaceId,"space-123");return {items:[],nextCursor:null};});
workflows.list("space-123",{limit:1}).then(value=>assert.deepEqual(value.items,[])).catch(error=>{console.error(error);process.exitCode=1;});
const previews = createPersonalAgentRunPreviewsClient(async (path, options) => {assert.equal(path,"/client/ai/personal-agents/7ac902e2-d7fa-44f0-82bd-2a4c27f7c009/run-preview?expectedRevision=1");assert.equal(options.method,"GET");assert.equal(options.workspaceId,"space-123");assert.equal(options.body,undefined);return {maximumEstimatedCostNanos:"123",modelExecutionConfigured:false};});
previews.preview("space-123","7ac902e2-d7fa-44f0-82bd-2a4c27f7c009",1).then(value=>assert.equal(value.maximumEstimatedCostNanos,"123")).catch(error=>{console.error(error);process.exitCode=1;});

const memories = createPersonalMemoriesClient(async (path, options) => { assert.equal(path,"/client/ai/personal-memories");assert.equal(options.method,"POST");assert.equal(options.workspaceId,"space-123");assert.deepEqual(JSON.parse(options.body),{code:"explicit-memory",title:"Explicit",content:"Synthetic memory",kind:"preference",enabled:false,agentIds:[]});return {id:"memory-123"}; });
memories.create("space-123",{code:"explicit-memory",title:"Explicit",content:"Synthetic memory",kind:"preference"}).then(value=>assert.equal(value.id,"memory-123")).catch(error=>{console.error(error);process.exitCode=1;});
const personalRuns = createPersonalAgentRunsClient(async (path, options) => { assert.equal(path, "/client/ai/personal-agents/agent-123/runs"); assert.equal(options.workspaceId, "space-123"); assert.equal(options.method, "POST"); assert.deepEqual(JSON.parse(options.body), {input:{question:"Synthetic"},idempotencyKey:"opaque-key-123",expectedRevision:1}); return {id:"opaque-run"}; });
personalRuns.submit("space-123","agent-123",{input:{question:"Synthetic"},idempotencyKey:"opaque-key-123",expectedRevision:1}).then(value=>assert.equal(value.id,"opaque-run")).catch(error=>{console.error(error);process.exitCode=1;});
const agents = createPersonalAgentsClient(async (path, options) => { assert.equal(path, "/client/ai/personal-agents/model-options"); assert.equal(options.workspaceId, "space-123"); assert.equal(options.method, "GET"); return { catalogVersion: 1, items: [] }; });
agents.modelOptions("space-123").then(value => assert.equal(value.catalogVersion, 1)).catch(error => { console.error(error); process.exitCode = 1; });
const skills = createPersonalSkillsClient(async (path, options) => { assert.equal(path, "/client/ai/skills/skill-123/versions?limit=2"); assert.equal(options.workspaceId, "space-123"); assert.equal(options.method, "GET"); return { items: [], nextCursor: null }; });
skills.versions("space-123", "skill-123", { limit: 2 }).then(value => assert.deepEqual(value, { items: [], nextCursor: null })).catch(error => { console.error(error); process.exitCode = 1; });
const recovery = createAiRunRecoveryClient(async (path, options) => { assert.equal(path, "/client/ai/run-requests/opaque-key-123"); assert.equal(options.workspaceId, "space-123"); assert.equal(options.method, "GET"); return { id: "opaque-run" }; });
const pending = recovery.recoverRequest("space-123", "opaque-key-123");
pending.then(value => assert.equal(value.id, "opaque-run")).catch(error => { console.error(error); process.exitCode = 1; });
assert.equal(new LocalStorageError("OBJECT_MISSING").code, "OBJECT_MISSING");
assert.ok(renderToStaticMarkup(React.createElement(PageHeading, { eyebrow: "Matrix", title: "Consumer" })).includes("<h1>Consumer</h1>"));
(async () => assert.deepEqual(await createClientApi(() => "http://matrix.invalid")("/probe"), { matrix: true }))()
  .catch(error => { console.error(error); process.exitCode = 1; });
`;
  if (kind === "esm-types") return `import { createSuccessEnvelope, type SuccessEnvelope } from "@aij/contracts";
import { createClientApi, createAiRunRecoveryClient, createPersonalSkillsClient, createPersonalAgentsClient, createPersonalAgentRunsClient, createPersonalMemoriesClient, createPersonalAgentRunPreviewsClient, createPersonalWorkflowsClient, createPersonalDocumentsClient, createExternalServicesApi, type AiRunRecoveryReference, type ClientApi } from "@aij/sdk";
import { resolveCorrelationId } from "@aij/core";
import { LocalStorageError, type RuntimeScope, type StorageAdapter } from "@aij/runtime-contracts";
import { PageHeading, type PageHeadingProps } from "@aij/ui";
const envelope: SuccessEnvelope<number> = createSuccessEnvelope(1);
const client: ClientApi = createClientApi(() => "http://matrix.invalid");
const recovered: Promise<AiRunRecoveryReference> = createAiRunRecoveryClient(client).recoverRequest("space", "opaque-key-123");
const privateSkill: Promise<import("@aij/sdk").PersonalSkill> = createPersonalSkillsClient(client).create("space", {code:"my-skill",name:"Skill",instructions:"Prompt data"});
const privateAgent: Promise<import("@aij/sdk").PersonalAgent> = createPersonalAgentsClient(client).create("space", {code:"my-agent",name:"Agent",instructions:"Prompt",modelCode:"text-model",modelRevision:1,catalogVersion:1,inputFields:["question"],outputFormat:"text",outputFields:[],skillBindings:[{skillId:"skill",revision:1}]});
const submitted: Promise<import("@aij/contracts").AiAgentRunResult> = createPersonalAgentRunsClient(client).submit("space","agent",{input:{question:"Synthetic"},idempotencyKey:"opaque-key-123",expectedRevision:1});
const memory: Promise<import("@aij/sdk").PersonalMemory> = createPersonalMemoriesClient(client).create("space",{code:"explicit-memory",title:"Title",content:"Synthetic",kind:"confirmed_fact"});
const preview:Promise<import("@aij/sdk").PersonalAgentRunPreview> = createPersonalAgentRunPreviewsClient(client).preview("space","7ac902e2-d7fa-44f0-82bd-2a4c27f7c009",1);
const documents:Promise<import("@aij/sdk").PersonalDocumentPage>=createPersonalDocumentsClient(client).list("space",{limit:1});void documents;
const externalFactory:typeof import("@aij/sdk").createExternalServicesApi=createExternalServicesApi;void externalFactory;
const workflow:Promise<import("@aij/sdk").PersonalWorkflowPage<import("@aij/sdk").PersonalWorkflowSummary>>=createPersonalWorkflowsClient(client).list("space",{limit:1});
void [recovered,privateSkill,privateAgent,submitted,memory,preview,workflow];
const scope: RuntimeScope = { type: "global", id: "synthetic" };
const storage: StorageAdapter = { relativePath: key => key, write: async () => ({ path: "x", size: 1 }), read: async () => new Uint8Array(), remove: async () => {}, exists: async () => true };
const heading: PageHeadingProps = { eyebrow: "Matrix", title: "Consumer" };
void [envelope, client, scope, storage, heading, PageHeading, resolveCorrelationId("matrix-id-123"), new LocalStorageError("OBJECT_MISSING")];
`;
  return `import contracts = require("@aij/contracts");
import sdk = require("@aij/sdk");
import core = require("@aij/core");
import runtime = require("@aij/runtime-contracts");
import ui = require("@aij/ui");
const envelope: contracts.SuccessEnvelope<number> = contracts.createSuccessEnvelope(2);
const client: sdk.ClientApi = sdk.createClientApi(() => "http://matrix.invalid");
const recovered: Promise<sdk.AiRunRecoveryReference> = sdk.createAiRunRecoveryClient(client).recoverRequest("space", "opaque-key-123");
const privateSkill: Promise<sdk.PersonalSkillPage<sdk.PersonalSkillVersion, number>> = sdk.createPersonalSkillsClient(client).versions("space","skill",{limit:2});
const privateAgent: Promise<sdk.PersonalAgentPage<sdk.PersonalAgentVersion, number>> = sdk.createPersonalAgentsClient(client).versions("space","agent",{limit:1});
const submitted: Promise<contracts.AiAgentRunResult> = sdk.createPersonalAgentRunsClient(client).submit("space","agent",{input:{question:"Synthetic"},idempotencyKey:"opaque-key-123",expectedRevision:1});
const memory: Promise<sdk.PersonalMemoryPage> = sdk.createPersonalMemoriesClient(client).list("space",{limit:1});
const preview:Promise<sdk.PersonalAgentRunPreview> = sdk.createPersonalAgentRunPreviewsClient(client).preview("space","7ac902e2-d7fa-44f0-82bd-2a4c27f7c009",1);
const documents:Promise<sdk.PersonalDocumentPage>=sdk.createPersonalDocumentsClient(client).list("space",{limit:1});void documents;
const externalFactory:typeof sdk.createExternalServicesApi=sdk.createExternalServicesApi;void externalFactory;
const workflow:Promise<sdk.PersonalWorkflowPage<sdk.PersonalWorkflowSummary>>=sdk.createPersonalWorkflowsClient(client).list("space",{limit:1});
void [recovered,privateSkill,privateAgent,submitted,memory,preview,workflow];
const scope: runtime.RuntimeScope = { type: "global", id: "synthetic" };
const heading: ui.PageHeadingProps = { eyebrow: "Matrix", title: "Consumer" };
void [envelope, client, scope, heading, ui.PageHeading, core.resolveCorrelationId("matrix-id-123"), new runtime.LocalStorageError("OBJECT_MISSING")];
`;
}

function writeConsumerFiles(consumer, expectedEntries) {
  writeFileSync(join(consumer, "consumer.mjs"), consumerSource("esm", expectedEntries));
  writeFileSync(join(consumer, "consumer.cjs"), consumerSource("cjs", expectedEntries));
  writeFileSync(join(consumer, "consumer.mts"), consumerSource("esm-types", expectedEntries));
  writeFileSync(join(consumer, "consumer.cts"), consumerSource("cjs-types", expectedEntries));
}

function assertPublicSurface(name, actualManifest, mode) {
  const expectedName = name;
  assert.equal(actualManifest.name, expectedName);
  assert.equal(actualManifest.version, manifest(name).version, `${mode} ${name} version matches source`);
  assert.equal(actualManifest.private, true, `${name} remains private`);
  assert.equal(actualManifest.license, "UNLICENSED", `${name} does not imply redistribution rights`);
  assert.equal(actualManifest.main, "./dist/index.cjs", `${name} has CommonJS legacy entry`);
  assert.equal(actualManifest.module, "./dist/index.mjs", `${name} has ESM legacy entry`);
  assert.equal(actualManifest.types, "./dist/index.d.ts", `${name} has a TypeScript entry`);
  if (mode === "packed" || mode === "installed tarball") {
    assert.deepEqual(actualManifest.dependencies ?? {}, expectedPackedDependencies[name], `${name} packed dependency matrix`);
  } else {
    assert.deepEqual(actualManifest.dependencies ?? {}, expectedWorkspaceDependencies[name], `${name} workspace dependency matrix`);
  }
  assert.equal(actualManifest.exports?.["."]?.import?.default, "./dist/index.mjs", `${name} has ESM public entry`);
  assert.equal(actualManifest.exports?.["."]?.require?.default, "./dist/index.cjs", `${name} has CJS public entry`);
  assert.equal(actualManifest.exports?.["."]?.import?.types, "./dist/index.d.mts", `${name} has ESM declaration entry`);
  assert.equal(actualManifest.exports?.["."]?.require?.types, "./dist/index.d.cts", `${name} has CJS declaration entry`);
  assert.deepEqual(actualManifest.files, ["dist"], `${name} packs only generated output`);
  for (const file of ["index.mjs", "index.cjs", "index.d.ts", "index.d.mts", "index.d.cts"]) {
    assert.ok(existsSync(join(packageDirectories.get(name), "dist", file)), `${name} built ${file}`);
  }
}

function runConsumerMatrix(consumer, names, expectedEntries) {
  writeConsumerFiles(consumer, expectedEntries);
  runOk(process.execPath, [join(consumer, "consumer.mjs")], consumer);
  runOk(process.execPath, [join(consumer, "consumer.cjs")], consumer);
  const tsc = join(repositoryRoot, "node_modules", "typescript", "bin", "tsc");
  runOk(process.execPath, [tsc, "--noEmit", "--strict", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--lib", "ES2022,DOM", "consumer.mts", "consumer.cts"], consumer);
  return names.map(name => ({ name, version: manifest(name).version, import: expectedEntries[name] }));
}

test("workspace and packed consumers install, execute, typecheck, and reject incompatible versions", async t => {
  mkdirSync(artifactsRoot, { recursive: true, mode: 0o700 });
  const lockPath = join(repositoryRoot, "pnpm-lock.yaml");
  const lockBefore = readFileSync(lockPath);
  const webRequire = createRequire(join(repositoryRoot, "apps/web/package.json"));
  const reactRoot = dirname(webRequire.resolve("react"));
  const reactDomRoot = dirname(webRequire.resolve("react-dom/server"));
  const typesReactRoot = resolve(repositoryRoot, "node_modules", "@types", "react");
  assert.ok(existsSync(join(typesReactRoot, "index.d.ts")), "local React declaration peer exists");
  const workspaceRoot = mkdtempSync(join(packagesRoot, "af066-workspace-consumer-"));
  const packedRoot = mkdtempSync(join(artifactsRoot, "packed-consumer-"));
  const mismatchRoot = mkdtempSync(join(packagesRoot, "af066-incompatible-consumer-"));
  try {
    const workspaceName = `aij-af066-workspace-consumer-${process.pid}`;
    const workspaceDependencies = Object.fromEntries(packageNames.map(name => [name, "workspace:*"]));
    workspaceDependencies.react = `link:${relative(workspaceRoot, reactRoot)}`;
    workspaceDependencies["react-dom"] = `link:${relative(workspaceRoot, reactDomRoot)}`;
    const workspaceManifest = {
      name: workspaceName, version: "0.0.0", private: true, type: "module",
      dependencies: workspaceDependencies,
      devDependencies: { "@types/react": `link:${relative(workspaceRoot, typesReactRoot)}` }
    };
    writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify(workspaceManifest, null, 2) + "\n");
    const workspaceDirectoryName = workspaceRoot.split("/").at(-1);
    runOk("pnpm", ["install", "--offline", "--ignore-scripts", "--lockfile=false", "--filter", `./packages/${workspaceDirectoryName}...`], repositoryRoot, 180000);

    const workspaceRequire = createRequire(join(workspaceRoot, "package.json"));
    const workspaceEntries = {};
    for (const name of packageNames) {
      const actualManifest = JSON.parse(readFileSync(join(packageDirectories.get(name), "package.json"), "utf8"));
      assertPublicSurface(name, actualManifest, "workspace");
      assert.equal(workspaceManifest.dependencies[name], "workspace:*");
      const resolvedEntry = workspaceRequire.resolve(name);
      assert.equal(resolvedEntry, join(packageDirectories.get(name), "dist", "index.cjs"), `${name} workspace resolution uses its public CJS export`);
      workspaceEntries[name] = pathToFileURL(join(packageDirectories.get(name), "dist", "index.mjs")).href;
      const installedManifest = JSON.parse(readFileSync(join(workspaceRoot, "node_modules", name, "package.json"), "utf8"));
      assert.equal(installedManifest.version, actualManifest.version, `${name} workspace link resolves the declared version`);
    }
    const workspaceRows = runConsumerMatrix(workspaceRoot, packageNames, workspaceEntries);
    const reactVersion = JSON.parse(readFileSync(join(realpathSync(reactRoot), "package.json"), "utf8")).version;
    assertVersionSatisfies(reactVersion, manifest("@aij/ui").peerDependencies.react, "workspace @aij/ui React peer");
    await t.test("workspace mode installs every workspace link and consumes ESM/CJS/types", () => {
      assert.equal(workspaceRows.length, packageNames.length);
      const sdk = manifest("@aij/sdk");
      assert.equal(sdk.dependencies["@aij/contracts"], "workspace:*");
      const contracts = JSON.parse(readFileSync(join(workspaceRoot, "node_modules", "@aij/contracts", "package.json"), "utf8"));
      assert.equal(contracts.version, "0.1.0", "workspace SDK dependency resolves to the actual contracts version");
    });

    const packDirectory = join(packedRoot, "packs");
    const packedConsumer = join(packedRoot, "consumer");
    mkdirSync(packDirectory);
    mkdirSync(packedConsumer);
    const tarballs = new Map();
    const packedManifests = new Map();
    for (const name of packageNames) {
      const before = new Set(readdirSync(packDirectory));
      runOk("pnpm", ["pack", "--pack-destination", packDirectory], packageDirectories.get(name));
      const created = readdirSync(packDirectory).filter(file => file.endsWith(".tgz") && !file.startsWith("._") && !before.has(file));
      assert.equal(created.length, 1, `${name} creates one local tarball`);
      const archive = join(packDirectory, created[0]);
      tarballs.set(name, `file:../packs/${created[0]}`);
      const packedManifest = JSON.parse(execFileSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" }));
      assertPublicSurface(name, packedManifest, "packed");
      assert.deepEqual(packedManifest.files, ["dist"], `${name} tarball includes only dist`);
      const files = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
      for (const file of ["index.mjs", "index.cjs", "index.d.mts", "index.d.cts"]) assert.ok(files.includes(`package/dist/${file}`), `${name} tarball contains ${file}`);
      packedManifests.set(name, packedManifest);
    }

    const packedDependencies = Object.fromEntries(packageNames.map(name => [name, tarballs.get(name)]));
    packedDependencies.react = `link:${relative(packedConsumer, reactRoot)}`;
    packedDependencies["react-dom"] = `link:${relative(packedConsumer, reactDomRoot)}`;
    writeFileSync(join(packedConsumer, "package.json"), JSON.stringify({
      name: `aij-af066-packed-consumer-${process.pid}`, version: "0.0.0", private: true, type: "module",
      dependencies: packedDependencies,
      devDependencies: { "@types/react": `link:${relative(packedConsumer, typesReactRoot)}` },
      pnpm: { overrides: { "@aij/contracts": tarballs.get("@aij/contracts") } }
    }, null, 2) + "\n");
    runOk("pnpm", ["--dir", packedConsumer, "install", "--offline", "--ignore-workspace", "--ignore-scripts", "--lockfile=false", "--store-dir", join(artifactsRoot, "packed-pnpm-store")], repositoryRoot, 180000);

    const packedRequire = createRequire(join(packedConsumer, "package.json"));
    const packedEntries = {};
    for (const name of packageNames) {
      const resolvedEntry = packedRequire.resolve(name);
      const installedPackage = realpathSync(join(packedConsumer, "node_modules", name));
      assert.equal(realpathSync(resolvedEntry), realpathSync(join(installedPackage, "dist", "index.cjs")), `${name} packed CJS export resolves from the isolated consumer`);
      packedEntries[name] = pathToFileURL(realpathSync(join(installedPackage, "dist", "index.mjs"))).href;
      const installedManifest = JSON.parse(readFileSync(join(packedConsumer, "node_modules", name, "package.json"), "utf8"));
      assert.equal(installedManifest.version, packedManifests.get(name).version, `${name} packed consumer version matches its tarball`);
      assertPublicSurface(name, installedManifest, "installed tarball");
    }
    const sdkDependency = packedManifests.get("@aij/sdk").dependencies["@aij/contracts"];
    assert.equal(sdkDependency, packedManifests.get("@aij/contracts").version, "packed SDK dependency is rewritten from workspace:* to the exact compatible package version");
    assertVersionSatisfies(
      JSON.parse(readFileSync(join(packedConsumer, "node_modules", "react", "package.json"), "utf8")).version,
      packedManifests.get("@aij/ui").peerDependencies.react,
      "@aij/ui React peer"
    );
    const packedRows = runConsumerMatrix(packedConsumer, packageNames, packedEntries);
    await t.test("packed mode installs local tarballs and consumes ESM/CJS/types with compatible dependencies", () => {
      assert.equal(packedRows.length, packageNames.length);
      const contracts = JSON.parse(readFileSync(join(packedConsumer, "node_modules", "@aij/contracts", "package.json"), "utf8"));
      assert.equal(contracts.version, sdkDependency);
      assert.equal(packedManifests.get("@aij/ui").peerDependencies.react, "^19.2.0");
    });

    const mismatchName = `aij-af066-incompatible-consumer-${process.pid}`;
    writeFileSync(join(mismatchRoot, "package.json"), JSON.stringify({
      name: mismatchName, version: "0.0.0", private: true,
      dependencies: { "@aij/core": "workspace:^99.0.0" }
    }, null, 2) + "\n");
    const mismatchPath = mismatchRoot.split("/").at(-1);
    const mismatch = run("pnpm", ["install", "--offline", "--ignore-scripts", "--lockfile=false", "--filter", `./packages/${mismatchPath}...`], repositoryRoot, 60000);
    assert.equal(mismatch.error, undefined, `pnpm incompatibility probe starts: ${mismatch.error?.message}`);
    assert.notEqual(mismatch.status, 0, "pnpm refuses an incompatible workspace package version");
    const mismatchOutput = `${mismatch.stdout}\n${mismatch.stderr}`;
    assert.match(mismatchOutput, /ERR_PNPM_NO_MATCHING_VERSION_INSIDE_WORKSPACE/);
    await t.test("incompatible workspace version is rejected by pnpm", () => {
      assert.equal(mismatch.status, 1);
      assert.match(mismatchOutput, /@aij\/core@workspace:\^99\.0\.0/);
    });

    const evidence = {
      taskId: "AF-066",
      batch: "NEXT-09B",
      modes: ["actual pnpm workspace:* install", "offline local pnpm pack tarball install"],
      packages: packageNames.map(name => ({
        name,
        workspaceVersion: manifest(name).version,
        packedVersion: packedManifests.get(name).version,
        workspaceDependencyDeclarations: manifest(name).dependencies ?? {},
        packedDependencyDeclarations: packedManifests.get(name).dependencies ?? {},
        peerDependencies: packedManifests.get(name).peerDependencies ?? {},
        esm: workspaceEntries[name],
        cjs: join(packedConsumer, "node_modules", name, "dist", "index.cjs"),
        types: ["index.d.mts", "index.d.cts"]
      })),
      consumerDirectories: { workspace: workspaceRoot, packed: packedConsumer },
      incompatibleWorkspaceInstall: { exitCode: mismatch.status, expectedCode: "ERR_PNPM_NO_MATCHING_VERSION_INSIDE_WORKSPACE" },
      registry: "offline/local only; no publish or remote fetch"
    };
    writeFileSync(join(artifactsRoot, "compatibility-matrix.json"), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
    assert.deepEqual(readFileSync(lockPath), lockBefore, "root pnpm lockfile remains unchanged by isolated consumer installs");
  } finally {
    for (const directory of [workspaceRoot, mismatchRoot]) {
      const real = realpathSync(directory);
      assert.ok(real.startsWith(`${packagesRoot}/`), "temporary workspace consumer remains inside packages/");
      rmSync(real, { recursive: true, force: false });
    }
    // A filtered install can recalculate the root's hoisted node_modules even
    // with --lockfile=false. Restore the committed workspace dependency graph
    // after removing the synthetic workspace members so later host builds use
    // the repository's frozen dependency tree.
    runOk("pnpm", ["install", "--offline", "--frozen-lockfile"], repositoryRoot, 180000);
    assert.ok(existsSync(join(typesReactRoot, "index.d.ts")), "workspace React declarations are restored after isolated consumer installs");
    assert.deepEqual(readFileSync(lockPath), lockBefore, "root lockfile remains unchanged after dependency restoration");
  }
});
