// ROOT ONLY. Deliberately fails without root opt-in + real adapter; never skip.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createConsumerHandler, generateTargetConsumer, installTargetConsumer, removeTargetConsumer, repositoryRoot, sha256, verifyConsumerModules } from "./workbench-sdk-target-consumer.mjs";
import { checkTargetProof, requiredNativeCases, requiredSourcePaths } from "./workbench-sdk-target-proof.mjs";

export async function runRootAcceptance(startTargetAcceptance) {
  assert.equal(process.env.AIJ_AF191_ROOT_ACCEPTANCE, "true", "AF191_ROOT_ACCEPTANCE_NOT_ENABLED");
  assert.equal(process.cwd(), repositoryRoot, "AF191_ROOT_CWD_REQUIRED");
  const git = args => execFileSync("git", args, { encoding: "utf8", cwd: repositoryRoot }).trim();
  assert.equal(resolve(git(["rev-parse", "--git-dir"])), resolve(git(["rev-parse", "--git-common-dir"])), "AF191_MAIN_WORKTREE_REQUIRED");
  assert.equal(git(["branch", "--show-current"]), "dev", "AF191_ROOT_DEV_REQUIRED");
  assert.equal(typeof startTargetAcceptance, "function", "AF191_REAL_ROOT_ADAPTER_REQUIRED");
  const startedAt = new Date().toISOString(), sourceCommit = git(["rev-parse", "HEAD"]);
  const sourceFiles = await Promise.all(requiredSourcePaths.map(async path => ({ path, kind: "source", sha256: sha256(await readFile(join(repositoryRoot, path))) })));
  let f, consumer, proof, closed;
  try {
    f = await startTargetAcceptance({ task: "AF-191", freshLease: true, transport: "AiCenterHttpTransport:owned-loopback", concurrency: 1 });
    for (const method of ["counters", "databaseSnapshot", "native", "request", "fetchAsActor", "mountConsumer", "pumpJobs", "evidence", "close"]) assert.equal(typeof f?.[method], "function", "AF191_ADAPTER_METHOD_MISSING:" + method);
    assert.equal(f.task, "AF-191"); assert.equal(f.approvedLeaseTask, "AF-191"); assert.match(f.acceptanceId, /^[A-Za-z0-9_-]{1,128}$/);
    assert(typeof f.artifactDirectory === "string" && f.artifactDirectory.startsWith(join(repositoryRoot, ".artifacts/")), "AF191_PRIVATE_REPORT_DIRECTORY_REQUIRED");
    assert.equal(await realpath(f.artifactDirectory), f.artifactDirectory);
    execFileSync("git", ["check-ignore", "--quiet", f.artifactDirectory], { cwd: repositoryRoot, stdio: "ignore" });
    assert.equal(f.transport, "AiCenterHttpTransport:owned-loopback"); assert.equal(f.agentCode, "general-text");
    const apiUrl = new URL(f.apiBaseUrl); assert.equal(apiUrl.hostname, "127.0.0.1"); assert.equal(apiUrl.protocol, "http:"); assert.equal(apiUrl.pathname, "/api");
    assert.deepEqual(await f.counters(), { runs: 0, jobs: 0, traces: 0, upstream: 0, submits: 0 });
    consumer = await generateTargetConsumer({ sdkTgz: f.sdkTgz, contractsTgz: f.contractsTgz });
    consumer = await installTargetConsumer(consumer);
    const matrix = await verifyConsumerModules(consumer, { typescriptPath: join(repositoryRoot, "node_modules/typescript/bin/tsc") });
    await f.mountConsumer({ consumer, handler: await createConsumerHandler(consumer), route: "/af191-consumer/" });
    const native = [];
    const submit = await f.native("desktop-workbench-submit", { viewportWidth: 1440, workspaceId: f.workspaceId, agentCode: "general-text",
      withholdFirstSubmitResponse: true, requireExplicitRecoveryGet: true }); native.push(submit);
    const runId = submit.runId; assert.match(runId, /^[A-Za-z0-9_-]{1,128}$/); assert.equal(submit.status, "queued");
    assert.equal(submit.case, "desktop-workbench-submit"); assert.equal(submit.native, true);
    assert.equal(submit.submissionUnconfirmedObserved, true); assert.equal(submit.recoveryGetObserved, true); assert.equal(submit.postCount, 1);
    assert.equal((await f.pumpJobs()).length, 1); assert.equal((await f.pumpJobs()).length, 0);
    const sdk = await import(pathToFileURL(join(consumer.directory, "node_modules/@aij/sdk/dist/index.mjs")).href);
    const originalFetch = globalThis.fetch;
    let result;
    try {
      // Actual installed createClientApi performs HTTP; adapter only supplies its
      // private synthetic actor Cookie, checks exact owned origin, then calls the
      // runtime-captured native fetch (Next may wrap the process-global fetch).
      // It must never fabricate or rewrite a Response.
      globalThis.fetch = (url, init) => f.fetchAsActor("owner", url, init);
      result = await sdk.createAiClient(sdk.createClientApi(() => f.apiBaseUrl)).read(f.workspaceId, runId);
      assert.equal(result.id, runId); assert.equal(result.status, "succeeded"); assert.equal(result.output === "Synthetic goal completed.", true, "AF191_OUTPUT_MISMATCH");
      assert.equal(result.budgetStatus, "settled"); assert.match(result.estimatedCostNanos, /^\d+$/);
    } finally { globalThis.fetch = originalFetch; }
    const db = await f.databaseSnapshot(runId);
    assert.equal(db.run.id, runId); assert.equal(db.run.projectId, f.projectId); assert.equal(db.run.workspaceId, f.workspaceId); assert.equal(db.run.memberId, f.memberId);
    assert.equal(db.run.agentCode, "general-text"); assert.equal(db.run.sourceType, "catalog"); assert.equal(db.run.budgetStatus, "settled");
    assert.equal(db.run.estimatedCostNanos, result.estimatedCostNanos);
    assert.equal(db.job.id, db.run.jobId); assert.equal(db.job.jobType, "aij-ai.agent-execute"); assert.equal(db.job.scopeId, f.projectId); assert.equal(db.job.workspaceId, f.workspaceId);
    assert.equal(db.job.status, "completed"); assert.equal(db.job.attempts, 1); assert.equal(db.job.maxAttempts, 1);
    assert.equal(db.trace.jobId, db.job.id); assert.equal(db.trace.projectId, f.projectId); assert.equal(db.trace.attempt, 1); assert.equal(db.trace.status, "succeeded");
    // This synthetic upstream reports usage, never a paid vendor charge. The
    // existing AiExecutionTrace remains the only cost truth owner.
    assert.equal(db.trace.costSource, "unreported"); assert.equal(db.trace.costAmountNanos, null);
    const refusal = {};
    for (const [actor, status, key] of [["anonymous", 401, "anonymous"], ["no-permission", 403, "noPermission"], ["other-member", 404, "otherMember"]]) {
      const response = await f.request({ actor, method: "GET", path: `/client/ai/runs/${runId}`, workspaceId: f.workspaceId });
      assert.equal(response.status, status); assert.equal(response.body?.success, false); assert.equal(response.body?.data, null, "AF191_REFUSAL_CONTENT_LEAK"); refusal[key] = response.status;
      try {
        globalThis.fetch = (url, init) => f.fetchAsActor(actor, url, init);
        await assert.rejects(sdk.createAiClient(sdk.createClientApi(() => f.apiBaseUrl)).read(f.workspaceId, runId), error => error.status === status);
      } finally { globalThis.fetch = originalFetch; }
    }
    for (const name of requiredNativeCases.filter(c => c !== "desktop-workbench-submit")) {
      const receipt = await f.native(name, { viewportWidth: name.startsWith("mobile390") ? 390 : 1440, workspaceId: f.workspaceId, runId, expectedOutput: result.output });
      assert.equal(receipt.case, name); assert.equal(receipt.runId, runId); assert.equal(receipt.native, true);
      if (name.endsWith("consumer-read") || name.endsWith("workbench-read")) { assert.equal(receipt.status, result.status); assert.equal(receipt.output === result.output, true, "AF191_NATIVE_OUTPUT_MISMATCH"); }
      else {
        assert.equal(receipt.privateContentCleared, true);
        const status = { anonymous: 401, "no-permission": 403, "other-member": 404, "scope-change": 404, "role-change": 403, "session-change": 401 }[name];
        if (status) assert.equal(receipt.apiStatus, status);
      }
      native.push(receipt);
    }
    assert.equal(native.length, requiredNativeCases.length);
    const counters = await f.counters(); assert.deepEqual(counters, { runs: 1, jobs: 1, traces: 1, upstream: 1, submits: 1 });
    const files = await f.evidence({ consumer, runId, native, matrix, sourceFiles });
    proof = { schemaVersion: 1, task: "AF-191", stage: "ROOT_ASSERTED", acceptanceId: f.acceptanceId, approvedLeaseTask: f.approvedLeaseTask,
      sourceCommit, startedAt, workspaceId: f.workspaceId, runId, counters, refusals: refusal, transport: f.transport, vendorReadiness: "NOT_PROVEN_SYNTHETIC", ownerAcceptance: "PENDING",
      packages: { ...consumer.packages, lockSha256: consumer.lockSha256, realInstall: true, outsideRepository: true, matrix: [...matrix, "browser-importmap"] }, files: [...sourceFiles, ...files] };
  } finally {
    // Root close must close its own processes/listeners and measure PG pools;
    // remove only our marked fresh outside directory. Unknown processes stay.
    try { if (f) closed = await f.close(); }
    finally { if (consumer) await removeTargetConsumer(consumer); }
  }
  assert.equal(closed?.applicationPools, 0); assert.equal(closed?.ownedSockets, 0);
  assert(Array.isArray(closed?.files), "AF191_CLOSE_EVIDENCE_REQUIRED");
  proof.closed = { applicationPools: 0, ownedSockets: 0, consumerRemoved: true };
  proof.files.push(...closed.files); proof.finishedAt = new Date().toISOString();
  await checkTargetProof(proof);
  await writeFile(join(f.artifactDirectory, "target-proof.json"), JSON.stringify(proof, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return proof;
}

test("AF191 root current workbench + installed independent SDK same-task target", { timeout: 900000 }, async () => {
  assert.equal(process.env.AIJ_AF191_ROOT_ACCEPTANCE, "true", "AF191_ROOT_ACCEPTANCE_NOT_ENABLED");
  const adapter = process.env.AIJ_AF191_ROOT_ADAPTER;
  assert(adapter, "AF191_REAL_ROOT_ADAPTER_REQUIRED");
  const path = resolve(adapter); assert(path.startsWith(join(repositoryRoot, "scripts/verification/")), "AF191_ROOT_ADAPTER_PATH_REQUIRED");
  assert.equal(await realpath(path), path); assert((await lstat(path)).isFile());
  const { startTargetAcceptance } = await import(pathToFileURL(path).href);
  const proof = await runRootAcceptance(startTargetAcceptance);
  // No private content or raw error in stdout. Root verify:task owns the report.
  process.stdout.write(JSON.stringify({ task: proof.task, stage: proof.stage, acceptanceId: proof.acceptanceId, runId: proof.runId, ownerAcceptance: "PENDING" }) + "\n");
});
