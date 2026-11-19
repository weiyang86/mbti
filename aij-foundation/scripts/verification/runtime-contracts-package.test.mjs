import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "./registry.mjs";

const packageDirectory = join(repositoryRoot, "packages/runtime-contracts");
const runtime = await import(new URL("../../packages/runtime-contracts/dist/index.mjs", import.meta.url));
const requireApi = createRequire(join(repositoryRoot, "apps/api/package.json"));
const apiStorage = requireApi(join(repositoryRoot, "apps/api/dist/files/local-storage.adapter.js"));
const runtimeCommonJs = requireApi("@aij/runtime-contracts");

test("runtime package exports storage and queue ports with the current runtime DTO contracts", async () => {
  const manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
  const declaration = await readFile(join(packageDirectory, "dist/index.d.ts"), "utf8");
  assert.equal(manifest.name, "@aij/runtime-contracts");
  assert.equal(manifest.private, true);
  assert.equal(manifest.license, "UNLICENSED");
  assert.deepEqual(manifest.dependencies ?? {}, {});
  for (const token of ["RuntimeScope", "RuntimeEvent", "RuntimeJobInput", "QueueAdapter", "StorageAdapter", "OutboxTransaction", "LocalStorageError"]) {
    assert.match(declaration, new RegExp(token), `public declaration exports ${token}`);
  }
  assert.equal(typeof runtime.LocalStorageError, "function");
  const error = new runtime.LocalStorageError("OBJECT_MISSING");
  assert.equal(error.code, "OBJECT_MISSING");
  assert.equal(error.message, "OBJECT_MISSING");
});

test("API storage host consumes the contract package error and adapter port without a copied owner", async () => {
  const source = await readFile(join(repositoryRoot, "apps/api/src/files/local-storage.adapter.ts"), "utf8");
  assert.equal(apiStorage.LocalStorageError, runtimeCommonJs.LocalStorageError, "API CommonJS host and CommonJS package export resolve the same class owner");
  assert.match(source, /from "@aij\/runtime-contracts"/);
  assert.match(source, /class LocalStorageAdapter implements StorageAdapter/);
  assert.doesNotMatch(source, /export class LocalStorageError/);
  assert.doesNotMatch(source, /export type LocalStorageErrorCode\s*=/);
});

test("API queue and event registry consume the public contract types", async () => {
  const job = await readFile(join(repositoryRoot, "apps/api/src/async-runtime/job.service.ts"), "utf8");
  const registry = await readFile(join(repositoryRoot, "apps/api/src/async-runtime/registry.ts"), "utf8");
  const contracts = await readFile(join(repositoryRoot, "apps/api/src/async-runtime/runtime-contracts.ts"), "utf8");
  assert.match(job, /implements QueueAdapter/);
  assert.match(job, /from "@aij\/runtime-contracts"/);
  assert.doesNotMatch(job, /export interface QueueAdapter/);
  assert.match(registry, /from "@aij\/runtime-contracts"/);
  assert.match(contracts, /export type \{[^}]*RuntimeEvent[^}]*RuntimeJobInput[^}]*RuntimeScope[^}]*\} from "@aij\/runtime-contracts"/s);
  assert.doesNotMatch(contracts, /export type RuntimeScope\s*=/);
});
