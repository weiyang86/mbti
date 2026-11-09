// ROOT ONLY. This test uses actual HTTP, protected PostgreSQL and JobService.
// Worker validation is node --check/lint only; never run this file in a Worker.
import assert from "node:assert/strict";
import test from "node:test";
import { prepareClientAiWorkbenchLive } from "./client-ai-workbench-live.mjs";

test("AF-142 real client/workspace/Agent HTTP with synthetic upstream and protected lease", { timeout: 360000 }, async t => {
  const f = await prepareClientAiWorkbenchLive();
  const checks = [], runIds = [];
  const options = { workspaceId: f.workspaceIds.primary };
  const submit = async (idempotencyKey, agentCode = "general-text", input = { goal: "Complete a synthetic planning task" }, extra = {}) => {
    return (await f.request("POST", `client/ai/agents/${agentCode}/runs`, { ...options, body: { idempotencyKey, input }, status: 202, ...extra })).data;
  };
  const read = async id => (await f.request("GET", `client/ai/runs/${id}`, options)).data;
  const remember = run => { assert.ok(typeof run?.id === "string", "RUN_ID_REQUIRED"); runIds.push(run.id); return run; };
  try {
    await t.test("real session and membership context, two owner spaces and no visibility for another member", async () => {
      const me = (await f.request("GET", "client/auth/me")).data;
      assert.equal(me.id, f.memberIds.owner);
      const mine = (await f.request("GET", "client/workspaces?page=1&pageSize=100")).data;
      assert.ok(mine.items.some(item => item.workspace.id === f.workspaceIds.primary), "PRIMARY_SPACE_PRESENT");
      assert.ok(mine.items.some(item => item.workspace.id === f.workspaceIds.second), "SECOND_SPACE_PRESENT");
      assert.ok(!mine.items.some(item => item.workspace.id === f.workspaceIds.other), "OTHER_SPACE_HIDDEN");
      const other = (await f.request("GET", "client/workspaces?page=1&pageSize=100", { actor: "other" })).data;
      assert.ok(!other.items.some(item => item.workspace.id === f.workspaceIds.second), "SECOND_SPACE_HIDDEN_FROM_OTHER");
      const context = (await f.request("GET", "client/workspaces/context", options)).data;
      assert.equal(context.workspaceId, f.workspaceIds.primary);
      assert.ok(context.permissions.includes("workspace.ai.execute") && context.permissions.includes("workspace.ai.read"), "OWNER_AI_GRANTS");
      await f.request("GET", "client/workspaces/context", { actor: "other", workspaceId: f.workspaceIds.second, status: 403 });
      checks.push("REAL_AUTH_WORKSPACES");
    });
    await t.test("real Agent list, authentication, CSRF origin, input whitelist and fixture-only execution policy", async () => {
      const agents = (await f.request("GET", "client/ai/agents", options)).data;
      assert.ok(agents.length === 3 && agents.every(agent => agent.inputFields.length === 1 && agent.inputFields[0] === "goal"), "GENERAL_GOAL_AGENT_LIST");
      assert.ok(await f.verifyTransportFence(), "NON_SYNTHETIC_TRANSPORT_REJECTED_BEFORE_FETCH");
      await f.request("GET", "client/ai/agents", { ...options, actor: null, status: 401 });
      await submit("af142-origin-denied", undefined, undefined, { origin: "https://foreign.invalid", status: 403 });
      f.setExecutionEnabled(false);
      try { await submit("af142-policy-disabled", undefined, undefined, { status: 503 }); }
      finally { f.setExecutionEnabled(true); }
      await submit("af142-empty-goal", undefined, { goal: " " }, { status: 400 });
      await submit("af142-forged-field", undefined, { goal: "Synthetic", workspaceId: f.workspaceIds.second }, { status: 400 });
      await submit("af142-missing-agent", "missing-agent", undefined, { status: 404 });
      assert.equal(f.metrics().upstreamCalls, 0);
      assert.equal((await f.pumpJobs()).length, 0);
      checks.push("LIST_AUTH_ORIGIN_INPUT_POLICY");
    });
    let text;
    await t.test("202 admission and real JobService text execution; same key and replay never execute twice", async () => {
      const [one, two] = await Promise.all([submit("af142-text-idempotent"), submit("af142-text-idempotent")]);
      text = remember(one);
      assert.equal(one.id, two.id); assert.ok(one.status === "queued", "QUEUED_BEFORE_PUMP");
      assert.equal(f.metrics().upstreamCalls, 0);
      await submit("af142-text-idempotent", undefined, { goal: "A different synthetic goal" }, { status: 409 });
      assert.equal((await f.pumpJobs()).length, 1);
      const result = await read(text.id);
      assert.ok(result.status === "succeeded" && result.output === "Synthetic goal completed.", "REAL_TEXT_RESULT");
      assert.ok(result.budgetStatus === "settled" && BigInt(result.estimatedCostNanos) > 0n, "SERVER_BUDGET_SETTLED");
      const replay = await submit("af142-text-idempotent");
      assert.equal(replay.id, text.id); assert.equal((await f.pumpJobs()).length, 0);
      assert.equal(f.metrics().upstreamCalls, 1);
      checks.push("TEXT_JOB_IDEMPOTENT_RESULT");
    });
    await t.test("same member wrong space and another member with actual read-only membership cannot read original run", async () => {
      await f.request("GET", `client/ai/runs/${text.id}`, { workspaceId: f.workspaceIds.second, status: 404 });
      const reader = (await f.request("GET", "client/workspaces/context", { ...options, actor: "other" })).data;
      assert.ok(reader.permissions.includes("workspace.ai.read") && !reader.permissions.includes("workspace.ai.execute"), "SYNTHETIC_READER_IS_READ_ONLY");
      await f.request("GET", "client/ai/agents", { ...options, actor: "other", status: 403 });
      await submit("af142-reader-denied", undefined, undefined, { actor: "other", status: 403 });
      await f.request("GET", `client/ai/runs/${text.id}`, { ...options, actor: "other", status: 404 });
      await f.request("GET", `client/ai/runs/${text.id}`, { workspaceId: f.workspaceIds.second, actor: "other", status: 403 });
      checks.push("MEMBER_SPACE_READONLY_ISOLATION");
    });
    await t.test("real structured JSON output passes provider schema and is read through HTTP", async () => {
      const run = remember(await submit("af142-json-result", "general-json"));
      assert.equal((await f.pumpJobs()).length, 1);
      const result = await read(run.id);
      assert.ok(result.status === "succeeded" && result.output?.result === "Synthetic goal completed." && Object.keys(result.output).length === 1, "REAL_JSON_RESULT");
      checks.push("JSON_JOB_RESULT");
    });
    await t.test("real private image bytes are authenticated and rejected across workspace/member boundaries", async () => {
      const run = remember(await submit("af142-image-result", "general-image", { goal: "A synthetic abstract illustration" }));
      assert.equal((await f.pumpJobs()).length, 1);
      const result = await read(run.id);
      assert.ok(result.status === "succeeded" && typeof result.imageAssetId === "string", "IMAGE_ASSET_CREATED");
      const image = await f.image({ runId: run.id });
      assert.equal(image.status, 200);
      assert.ok(image.contentType === "image/png" && image.bytes.length >= 24 && image.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "AUTHENTICATED_PNG_BYTES");
      assert.equal((await f.image({ runId: run.id, workspaceId: f.workspaceIds.second })).status, 404);
      assert.equal((await f.image({ runId: run.id, actor: "other" })).status, 404);
      assert.equal((await f.image({ runId: run.id, actor: "other", workspaceId: f.workspaceIds.second })).status, 403);
      checks.push("PRIVATE_IMAGE_BYTES_ISOLATION");
    });
    await t.test("post-attempt upstream failure becomes unknown, retains reservation and same-key replay does not retry", async () => {
      const before = f.metrics().upstreamCalls;
      f.setMode("upstream-error");
      try {
        const run = remember(await submit("af142-unknown-result"));
        assert.equal((await f.pumpJobs()).length, 1);
        const result = await read(run.id);
        assert.ok(result.status === "unknown" && result.budgetStatus === "reserved" && BigInt(result.estimatedCostNanos) > 0n, "UNKNOWN_IS_NOT_FREE_FAILURE");
        assert.ok(result.failureCode === "UPSTREAM_RESULT_UNCERTAIN", "UNKNOWN_FROM_REAL_EXECUTION");
        const replay = await submit("af142-unknown-result");
        assert.equal(replay.id, run.id); assert.ok(replay.status === "unknown", "UNKNOWN_REPLAY_PRESERVED");
        assert.equal((await f.pumpJobs()).length, 0); assert.equal(f.metrics().upstreamCalls, before + 1);
      } finally { f.setMode("success"); }
      const recovered = remember(await submit("af142-explicit-new-task"));
      assert.equal((await f.pumpJobs()).length, 1);
      assert.ok((await read(recovered.id)).status === "succeeded", "EXPLICIT_NEW_TASK_RECOVERY");
      checks.push("UNKNOWN_NO_RETRY_EXPLICIT_RECOVERY");
    });
    assert.equal(checks.length, 7, "ALL_HTTP_GROUPS_REQUIRED");
    assert.equal(f.metrics().rejectedTransports, 1);
    // Whitelisted status/target IDs/references only, never payload or credentials.
    await f.saveHttpEvidence(checks, runIds);
  } finally { await f.close(); }
});
