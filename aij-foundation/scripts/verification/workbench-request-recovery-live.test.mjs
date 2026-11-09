// ROOT ONLY / Worker status: NOT_RUN. Needs root's AF149 allowlists and shared
// prepareClientAiWorkbenchLive({ task: 'AF-149', browserOrigin }) extension.
// Run only from the main worktree, serial DB/build lease, after real API build.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { createAiClient, createAiRunRecoveryClient } from "../../packages/sdk/dist/index.mjs";
import { createWorkbench } from "../../apps/web/app/components/client-ai-workbench-state.mjs";
import { prepareClientAiWorkbenchLive } from "./client-ai-workbench-live.mjs";

assert.equal(process.env.AIJ_AF149_ROOT_ACCEPTANCE, "true", "AF149_ROOT_ACCEPTANCE_NOT_ENABLED");
const gitPath = flag => resolve(execFileSync("git", ["rev-parse", flag], { encoding: "utf8" }).trim());
assert.equal(gitPath("--git-dir"), gitPath("--git-common-dir"), "AF149_MAIN_WORKTREE_REQUIRED");

test("AF149 opt-in does not authorize default AF142; AF142 opt-in does not authorize explicit AF149", async () => {
  const prior142 = process.env.AIJ_AF142_ROOT_ACCEPTANCE, prior149 = process.env.AIJ_AF149_ROOT_ACCEPTANCE;
  try {
    delete process.env.AIJ_AF142_ROOT_ACCEPTANCE;
    process.env.AIJ_AF149_ROOT_ACCEPTANCE = "true";
    await assert.rejects(prepareClientAiWorkbenchLive(), /AF142_ROOT_ACCEPTANCE_NOT_ENABLED/);
    delete process.env.AIJ_AF149_ROOT_ACCEPTANCE;
    process.env.AIJ_AF142_ROOT_ACCEPTANCE = "true";
    await assert.rejects(prepareClientAiWorkbenchLive({ task: "AF-149" }), /AF149_ROOT_ACCEPTANCE_NOT_ENABLED/);
  } finally {
    if (prior142 === undefined) delete process.env.AIJ_AF142_ROOT_ACCEPTANCE; else process.env.AIJ_AF142_ROOT_ACCEPTANCE = prior142;
    if (prior149 === undefined) delete process.env.AIJ_AF149_ROOT_ACCEPTANCE; else process.env.AIJ_AF149_ROOT_ACCEPTANCE = prior149;
  }
});

test("AF149 admitted POST response withheld from actual workbench; reload real GET recovers without POST and executes once", { timeout: 360000 }, async t => {
  const f = await prepareClientAiWorkbenchLive({ task: "AF-149", browserOrigin: process.env.AIJ_AF149_BROWSER_ORIGIN ?? "http://127.0.0.1:41783" });
  const workspaceId = f.workspaceIds.primary, journal = new Map(), calls = [], stores = [];
  const runIds = [], checks = [];
  let lost = false, admittedId;
  const lock = (() => { let tail = Promise.resolve(); return (_name, fn) => { const next = tail.then(fn); tail = next.catch(() => {}); return next; }; })();
  // f.request performs actual authenticated HTTP with the fresh fixture's
  // private Cookie. Both compiled SDK clients use this same HTTP adapter.
  // The admitted response is deliberately never delivered to the state store.
  const request = async (path, options = {}) => {
    const method = options.method ?? "GET"; calls.push({ method, path });
    const response = await f.request(method, path.replace(/^\//, ""), { workspaceId: options.workspaceId,
      ...(options.body === undefined ? {} : { body: JSON.parse(options.body) }), status: method === "POST" ? 202 : 200 });
    if (method === "POST" && !lost) {
      lost = true; admittedId = response.data.id; runIds.push(admittedId);
      throw new TypeError("AF149_ADMITTED_RESPONSE_WITHHELD");
    }
    return response.data;
  };
  const mount = () => {
    const store = createWorkbench({ request, aiClientFactory: createAiClient, aiRecoveryClientFactory: createAiRunRecoveryClient,
      journalStorage: () => ({ getItem: key => journal.get(key) ?? null, setItem: (key, value) => journal.set(key, value) }),
      withRecoveryLock: lock, makeKey: () => "af149-lost-response-original-key", schedule: () => 1, unschedule: () => {} });
    stores.push(store); return store;
  };
  try {
    let originalKey;
    await t.test("real admission stores only the opaque original journal while response remains unknown to state", async () => {
      assert.equal(f.metrics().upstreamCalls, 0);
      const store = mount(); await store.start(workspaceId); store.setInput("goal", "AF149 synthetic lost response task"); await store.submit();
      assert.ok(admittedId); assert.equal(store.getSnapshot().run, null); assert.equal(store.getSnapshot().submissionUnconfirmed, true);
      assert.equal(store.getSnapshot().recovery.runId, null); originalKey = store.getSnapshot().recovery.key;
      const saved = JSON.parse([...journal.values()][0])[0];
      assert.deepEqual(Object.keys(saved).sort(), ["agentCode", "digest", "key", "memberId", "runId", "status", "workspaceId"]);
      assert.ok(!JSON.stringify(saved).includes("synthetic lost response task"));
      store.dispose(); assert.deepEqual(store.getSnapshot().input, {});
      assert.equal(f.metrics().upstreamCalls, 0); checks.push("ADMITTED_RESPONSE_WITHHELD_FROM_STATE");
    });
    const store = mount();
    await t.test("reload and explicit GET restore the original reference with no prompt and no replacement POST", async () => {
      await store.start(workspaceId); assert.deepEqual(store.getSnapshot().input, {}); await store.recoverRequest();
      assert.equal(store.getSnapshot().issue, null); assert.equal(store.getSnapshot().recoveryReference.id, admittedId);
      assert.equal(store.getSnapshot().recovery.runId, admittedId); assert.equal(store.getSnapshot().recovery.key, originalKey);
      assert.equal(store.getSnapshot().run, null);
      assert.equal(calls.filter(c => c.method === "POST").length, 1);
      assert.equal(calls.filter(c => c.path === `/client/ai/run-requests/${originalKey}` && c.method === "GET").length, 1);
      assert.equal(f.metrics().upstreamCalls, 0); checks.push("RELOAD_REAL_GET_ORIGINAL_REFERENCE_NO_POST");
    });
    await t.test("actual JobService executes exactly once; normal result read loads actual output, metadata never fabricates it", async () => {
      assert.equal((await f.pumpJobs()).length, 1); assert.equal(f.metrics().upstreamCalls, 1);
      await store.readRun(); assert.equal(store.getSnapshot().run.id, admittedId);
      assert.equal(store.getSnapshot().run.status, "succeeded"); assert.equal(store.getSnapshot().run.budgetStatus, "settled");
      assert.equal(store.getSnapshot().run.output, "Synthetic goal completed.");
      assert.equal(store.getSnapshot().recovery, null);
      assert.equal((await f.pumpJobs()).length, 0); assert.equal(f.metrics().upstreamCalls, 1);
      assert.equal(calls.filter(c => c.method === "POST").length, 1); checks.push("ONE_EXECUTION_ONE_UPSTREAM_ACTUAL_RESULT");
    });
    assert.equal(checks.length, 3); await f.saveHttpEvidence(checks, runIds);
  } finally { for (const store of stores) store.dispose(); await f.close(); }
});
