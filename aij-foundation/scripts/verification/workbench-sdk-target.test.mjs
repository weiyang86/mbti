import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createRunReader, generateTargetConsumer, installTargetConsumer, createConsumerHandler, removeTargetConsumer, repositoryRoot, sha256, verifyConsumerModules } from "./workbench-sdk-target-consumer.mjs";
import { checkTargetProof, requiredNativeCases, requiredSourcePaths } from "./workbench-sdk-target-proof.mjs";

const result = (extra = {}) => ({ id: "run-1", agentCode: "general-text", status: "succeeded", output: "Synthetic goal completed.", budgetStatus: "settled", imageAssetId: null, expiresAt: new Date(Date.now() + 60000).toISOString(), ...extra });
const context = (extra = {}) => ({ workspaceId: "space-1", roleId: "role-1", permissions: ["workspace.ai.read"], ...extra });
function readerFixture({ contexts = [context()], principals = [{ id: "member-1" }], run = result(), read, available } = {}) {
  const calls = []; let ci = 0, pi = 0;
  const api = async (path, options) => { calls.push({ path, options }); return path === "/client/auth/me" ? principals[Math.min(pi++, principals.length - 1)] : contexts[Math.min(ci++, contexts.length - 1)]; };
  const reader = createRunReader({ api, ai: { read: read ?? (async () => run) }, available });
  return { reader, calls };
}

test("reader verifies server identity and context before and after exact Run read", async () => {
  const { reader, calls } = readerFixture();
  try { await reader.read("space-1", "run-1"); assert.equal(reader.snapshot().result.output, "Synthetic goal completed."); assert.equal(calls.length, 4); assert(calls.every(c => c.options.signal instanceof AbortSignal)); }
  finally { reader.dispose(); }
});

test("reader rejects untrusted IDs before network and refuses malformed/foreign/expired result", async t => {
  for (const [space, run] of [["../x", "run-1"], ["space-1", "https://evil.invalid"], ["space-1", "run?x"], ["", "run-1"]]) {
    const f = readerFixture(); await f.reader.read(space, run); assert.equal(f.calls.length, 0); assert.equal(f.reader.snapshot().issue, 400); f.reader.dispose();
  }
  for (const extra of [{ id: "other-run" }, { agentCode: "personal-agent" }, { output: { unsafe: true } }, { imageAssetId: "image-1" }, { status: "made-up" }, { expiresAt: "never" }, { expiresAt: new Date(0).toISOString() }]) {
    await t.test(JSON.stringify(extra), async () => { const f = readerFixture({ run: result(extra) }); await f.reader.read("space-1", "run-1"); assert.equal(f.reader.snapshot().result, null); assert.equal(f.reader.snapshot().issue, 503); f.reader.dispose(); });
  }
});

test("role, session/member, scope and permissions changed during read discard private result", async () => {
  for (const options of [{ contexts: [context(), context({ roleId: "role-2" })] }, { principals: [{ id: "member-1" }, { id: "member-2" }] },
    { contexts: [context(), context({ permissions: [] })] }, { contexts: [context({ workspaceId: "other-space" })] }, { principals: [{}] }]) {
    const f = readerFixture(options); await f.reader.read("space-1", "run-1"); assert.equal(f.reader.snapshot().result, null); assert(f.reader.snapshot().issue); f.reader.dispose();
  }
});

test("no permission prevents Run read; API refusal and lost response never retry", async () => {
  let count = 0;
  const denied = readerFixture({ contexts: [context({ permissions: [] })], read: async () => { count++; } });
  await denied.reader.read("space-1", "run-1"); assert.equal(count, 0); assert.equal(denied.reader.snapshot().issue, 403); denied.reader.dispose();
  for (const status of [401, 403, 404, 409, 503, undefined]) {
    let reads = 0;
    const f = readerFixture({ read: async () => { reads++; throw status ? { status } : new TypeError("private transport content"); } });
    await f.reader.read("space-1", "run-1"); assert.equal(reads, 1); assert.equal(f.reader.snapshot().result, null); assert.equal(f.reader.snapshot().issue, status ?? 503); f.reader.dispose();
  }
});

test("invalidate/unmount/hidden fences late callbacks and aborts old scope", async () => {
  for (const action of ["invalidate", "dispose", "hidden"]) {
    let resolveRead, visible = true, seenSignal;
    const f = readerFixture({ available: () => visible, read: async (_w, _r, signal) => { seenSignal = signal; return new Promise(yes => { resolveRead = yes; }); } });
    const pending = f.reader.read("space-1", "run-1");
    for (let n = 0; n < 10 && !resolveRead; n++) await Promise.resolve();
    assert(resolveRead);
    if (action === "hidden") { visible = false; f.reader.invalidate(); } else f.reader[action]();
    assert(seenSignal.aborted); resolveRead(result()); await pending;
    assert.equal(f.reader.snapshot().result, null); assert.equal(f.reader.snapshot().phase, "idle"); f.reader.dispose();
  }
});

test("content TTL clears in RAM without a second request", async () => {
  const f = readerFixture({ run: result({ expiresAt: new Date(Date.now() + 60).toISOString() }) });
  await f.reader.read("space-1", "run-1"); assert(f.reader.snapshot().result);
  await new Promise(yes => setTimeout(yes, 90)); assert.equal(f.reader.snapshot().result, null); assert.equal(f.calls.length, 4); f.reader.dispose();
});

test("new read wins over an older pending callback; unknown task remains read-only", async () => {
  let resolveOld, count = 0;
  const f = readerFixture({ read: async () => ++count === 1 ? new Promise(yes => { resolveOld = yes; }) : result({ output: "new-scope-result" }) });
  const old = f.reader.read("space-1", "run-1");
  for (let n = 0; n < 10 && !resolveOld; n++) await Promise.resolve();
  assert(resolveOld); await f.reader.read("space-1", "run-1");
  assert.equal(f.reader.snapshot().result.output, "new-scope-result");
  resolveOld(result({ output: "late-private-result" })); await old;
  assert.equal(f.reader.snapshot().result.output, "new-scope-result"); f.reader.dispose();
  const unknown = readerFixture({ run: result({ status: "unknown", budgetStatus: "reserved", output: "must-not-display" }) });
  await unknown.reader.read("space-1", "run-1"); assert.equal(unknown.reader.snapshot().result.status, "unknown"); assert.equal(unknown.reader.snapshot().result.output, null); unknown.reader.dispose();
});

test("actual private packed SDK/contracts install outside repo; module/type matrix, safe HTTP assets, real SDK HTTP", { timeout: 180000 }, async t => {
  const packs = await mkdtemp(join(tmpdir(), "af191-packs-")); let consumer, server;
  try {
    for (const name of ["contracts", "sdk"]) execFileSync("pnpm", ["pack", "--pack-destination", packs], { cwd: join(repositoryRoot, "packages", name), stdio: "pipe", timeout: 60000 });
    const options = { sdkTgz: join(packs, "aij-sdk-0.1.0.tgz"), contractsTgz: join(packs, "aij-contracts-0.1.0.tgz") };
    await assert.rejects(generateTargetConsumer({ ...options, parent: repositoryRoot }), /OUTSIDE_REPOSITORY/);
    consumer = await generateTargetConsumer(options);
    consumer = await installTargetConsumer(consumer);
    assert.deepEqual(await verifyConsumerModules(consumer, { typescriptPath: join(repositoryRoot, "node_modules/typescript/bin/tsc") }), ["esm", "cjs", "esm-types", "cjs-types"]);
    await writeFile(join(consumer.directory, "invalid.mts"), `import {createClientApi,createAiClient} from '@aij/sdk'; const wrong:Promise<number>=createAiClient(createClientApi(()=>undefined)).read('space','run'); void wrong;`);
    const invalid = spawnSync(process.execPath, [join(repositoryRoot, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--target", "ES2022", "--lib", "ES2022,DOM", "invalid.mts"], { cwd: consumer.directory, encoding: "utf8" });
    assert.notEqual(invalid.status, 0); assert.match(invalid.stdout + invalid.stderr, /AiAgentRunResult/);
    const handler = await createConsumerHandler(consumer), network = [];
    server = createServer((req, res) => { void (async () => {
      if (await handler(req, res)) return;
      network.push({ path: req.url, method: req.method, workspace: req.headers["x-aij-workspace-id"] });
      const status = ["space-1", "bad-envelope"].includes(req.headers["x-aij-workspace-id"]) ? 200 : 403;
      if (req.headers["x-aij-workspace-id"] === "bad-envelope") { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify({ success: true, data: result() })); return; }
      res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(status === 200 ? { success: true, data: result(), message: "ok" } : { success: false }));
    })().catch(() => { res.writeHead(500); res.end(); }); });
    await new Promise(yes => server.listen(0, "127.0.0.1", yes));
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [path, expected] of [["/af191-consumer/", 200], ["/af191-consumer/app.mjs", 200], ["/af191-consumer/node_modules/@aij/sdk/dist/index.mjs", 200],
      ["/af191-consumer/node_modules/@aij/contracts/dist/index.mjs", 200], ["/af191-consumer/sdk.tgz", 404], ["/af191-consumer/package.json", 404], ["/af191-consumer/%252e%252e/.env", 404], ["/af191-consumer/app.mjs?x=1", 404]]) {
      const response = await fetch(origin + path); assert.equal(response.status, expected, path); assert.equal(response.headers.get("cache-control"), "no-store"); await response.text();
    }
    assert.equal((await fetch(origin + "/af191-consumer/", { method: "POST" })).status, 405);
    // Walk the actual installed browser ESM graph over HTTP, resolving its real
    // transitive contracts import through the same importmap. Native evaluation
    // is intentionally left to root's browser acceptance.
    const visited = new Set(), imports = { "@aij/sdk": "/af191-consumer/node_modules/@aij/sdk/dist/index.mjs", "@aij/contracts": "/af191-consumer/node_modules/@aij/contracts/dist/index.mjs" };
    const visit = async path => { if (visited.has(path)) return; visited.add(path); const response = await fetch(origin + path); assert.equal(response.status, 200); const code = await response.text();
      assert(!/from\s*["']node:|\brequire\(/.test(code), "browser module must not require Node");
      for (const match of code.matchAll(/^(?:import|export)\s+(?:[^;\n]+?\s+from\s+)?["']([^"']+)["']/gm)) { const specifier = match[1];
        assert(specifier.startsWith(".") || imports[specifier], "unsupported browser dependency: " + specifier);
        const target = imports[specifier] ?? new URL(specifier, origin + path).pathname;
        assert(target.startsWith("/af191-consumer/")); await visit(target);
      }
    }; await visit(imports["@aij/sdk"]); assert(visited.has(imports["@aij/contracts"]) && visited.size > 2);
    for (const path of ["/af191-consumer/%2e%2e/.env", "/af191-consumer/../.env", "/af191-consumer/./app.mjs", "/af191-consumer/\\app.mjs", "/af191-consumer/app.mjs#private"]) {
      let code; await handler({ method: "GET", url: path }, { writeHead(status) { code = status; }, end() {} }); assert.equal(code, 404);
    }
    const app = await readFile(join(consumer.directory, "app.mjs"), "utf8");
    assert(!/localStorage|sessionStorage|indexedDB|innerHTML|unsafeHTML|console\.|\.submit\(|\.searchParams/.test(app));
    assert(app.includes("visibilitychange") && app.includes("'blur'") && app.includes("pagehide"));
    const sdk = await import(pathToFileURL(join(consumer.directory, "node_modules/@aij/sdk/dist/index.mjs")).href);
    assert.equal((await sdk.createAiClient(sdk.createClientApi(() => origin + "/api")).read("space-1", "run-1")).id, "run-1");
    await assert.rejects(sdk.createAiClient(sdk.createClientApi(() => origin + "/api")).read("space-no-access", "run-1"), error => error.status === 403);
    await assert.rejects(sdk.createAiClient(sdk.createClientApi(() => origin + "/api")).read("bad-envelope", "run-1"), error => error.status === 503);
    assert.deepEqual(network.map(n => n.method), ["GET", "GET", "GET"]); assert.equal(network[0].path, "/api/client/ai/runs/run-1");
    await t.test("static route rejects package file replacement with symlink", async () => {
      const file = join(consumer.directory, "app.mjs"); await rm(file); await symlink(join(consumer.directory, "reader.mjs"), file);
      const response = await fetch(origin + "/af191-consumer/app.mjs"); assert.equal(response.status, 500); await response.text();
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise((yes, no) => server.close(error => error ? no(error) : yes())); assert.equal(server.listening, false); }
    if (consumer) await removeTargetConsumer(consumer);
    await rm(packs, { recursive: true });
  }
});

test("root-only gate and missing adapter are hard failures, never skipped", () => {
  const env = { ...process.env }; delete env.AIJ_AF191_ROOT_ACCEPTANCE; delete env.AIJ_AF191_ROOT_ADAPTER; delete env.NODE_TEST_CONTEXT;
  let r = spawnSync(process.execPath, ["--test", "scripts/verification/workbench-sdk-target-live.test.mjs"], { cwd: repositoryRoot, env, encoding: "utf8" });
  assert.notEqual(r.status, 0); assert.match(r.stdout + r.stderr, /AF191_ROOT_ACCEPTANCE_NOT_ENABLED/);
  r = spawnSync(process.execPath, ["--test", "scripts/verification/workbench-sdk-target-live.test.mjs"], { cwd: repositoryRoot, env: { ...env, AIJ_AF191_ROOT_ACCEPTANCE: "true" }, encoding: "utf8" });
  assert.notEqual(r.status, 0); assert.match(r.stdout + r.stderr, /AF191_REAL_ROOT_ADAPTER_REQUIRED/);
});

test("proof checker rejects empty claims, missing real native proof and stale/counter/refusal claims", async () => {
  await assert.rejects(checkTargetProof({}), /SCHEMA/);
  const claim = { schemaVersion: 1, task: "AF-191", stage: "ROOT_ASSERTED", acceptanceId: "lease-1", approvedLeaseTask: "AF-191", runId: "run-1", workspaceId: "space-1", sourceCommit: "a".repeat(40),
    startedAt: new Date(Date.now() - 1000).toISOString(), finishedAt: new Date().toISOString(), counters: { runs: 1, jobs: 1, traces: 1, upstream: 1, submits: 1 }, refusals: { anonymous: 401, noPermission: 403, otherMember: 404 },
    transport: "AiCenterHttpTransport:owned-loopback", vendorReadiness: "NOT_PROVEN_SYNTHETIC", ownerAcceptance: "PENDING", closed: { applicationPools: 0, ownedSockets: 0, consumerRemoved: true },
    packages: { sdk: { sha256: "a".repeat(64) }, contracts: { sha256: "b".repeat(64) }, lockSha256: "c".repeat(64), outsideRepository: true, realInstall: true, matrix: ["esm", "cjs", "esm-types", "cjs-types", "browser-importmap"] }, files: [] };
  await assert.rejects(checkTargetProof(claim), /EVIDENCE_FILES_REQUIRED/);
  await assert.rejects(checkTargetProof({ ...claim, counters: { ...claim.counters, submits: 2 } }), /EXACTLY_ONCE/);
  await assert.rejects(checkTargetProof({ ...claim, refusals: { ...claim.refusals, otherMember: 200 } }), /API_REFUSALS/);
  await assert.rejects(checkTargetProof({ ...claim, finishedAt: "2020-01-01" }), /FRESH_RUN/);
  assert(requiredNativeCases.includes("document-hidden"));
  // Unit-only bytes exercise integrity failures; they never form accepted
  // native evidence and cannot pass the target harness.
  const root = await mkdtemp(join(tmpdir(), "af191-proof-unit-"));
  try {
    const files = [];
    for (const path of requiredSourcePaths) { const bytes = Buffer.from("AF191 integrity unit fixture only: " + path); await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), bytes); files.push({ path, kind: "source", sha256: sha256(bytes) }); }
    const withFiles = { ...claim, files };
    await assert.rejects(checkTargetProof(withFiles, { root }), /NATIVE_EVIDENCE_MISSING/);
    await assert.rejects(checkTargetProof({ ...withFiles, files: [{ ...files[0], path: "../escape" }] }, { root }), /REFERENCE_INVALID/);
    await assert.rejects(checkTargetProof({ ...withFiles, files: [files[0], files[0]] }, { root }), /PATH_INVALID/);
    await writeFile(join(root, files[0].path), "changed after observation");
    await assert.rejects(checkTargetProof(withFiles, { root }), /HASH_MISMATCH/);
  } finally { await rm(root, { recursive: true }); }
});
