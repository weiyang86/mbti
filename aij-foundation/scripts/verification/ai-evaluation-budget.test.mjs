import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createRuntimeFixture } from "./runtime-fixture.mjs";
const require = createRequire(join(process.cwd(), "apps/api/package.json"));
test("AF-116 durable evaluation budget enforces concurrent hard cap and conservative failures", { timeout: 240000 }, async t => {
  const f = await createRuntimeFixture("AF-116");
  try {
    const { AiEvaluationBudgetService } = require("../../apps/api/dist/plugins/aij-ai/ai-evaluation-budget.service.js");
    const project = await f.prisma.projectProfile.findFirstOrThrow();
    const p = { projectId: project.id, runKey: "synthetic-evaluation-run", modelCode: "deepseek-flash", modelVersion: "DeepSeek-V4.1-Flash-1017", priceVersion: "deepseek-flash-2026-11-04", usdCnyMicros: "7200000", maxOutputTokens: 2048, expiresAt: new Date(Date.now()+86400000).toISOString() };
    let raw = JSON.stringify(p);
    const service = new AiEvaluationBudgetService(f.prisma, { get: () => raw });
    const scope = { projectId: p.projectId, providerCode: "deepseek", modelCode: p.modelCode };
    await t.test("missing, expired, incorrect scope and price configuration fail closed", async () => {
      raw = "{}"; assert.throws(()=>service.policy()); raw = JSON.stringify(p);
      await assert.rejects(service.reserve({...scope, projectId:"foreign-project"}, "foreign-call"));
      raw=JSON.stringify({...p, expiresAt:new Date(Date.now()-1).toISOString()});assert.throws(()=>service.policy());
      raw=JSON.stringify({...p, priceVersion:"unknown"});assert.throws(()=>service.policy());raw=JSON.stringify(p);
      assert.equal(await f.prisma.aiEvaluationBudgetRun.count(),0);
    });
    const amount=service.estimate(p,1048576,2048);
    await t.test("concurrent reservations cannot exceed CNY10 across processes", async () => {
      const results=await Promise.allSettled(Array.from({length:12},(_,i)=>service.reserve(scope,`synthetic-call-${i}`)));
      const ok=results.filter(x=>x.status==='fulfilled');assert.equal(ok.length,Number(10000000000n/amount));
      assert.equal(results.filter(x=>x.status==='rejected').every(x=>x.reason.getStatus()===429),true);
      const run=await f.prisma.aiEvaluationBudgetRun.findFirstOrThrow();assert.equal(run.usedNanos,amount*BigInt(ok.length));assert.ok(run.usedNanos<=10000000000n);
    });
    const row=await f.prisma.aiEvaluationBudgetReservation.findFirstOrThrow();
    await t.test("reservation survives reconstruction and duplicate invocation is denied", async () => {
      const restarted=new AiEvaluationBudgetService(f.prisma,{get:()=>raw});await assert.rejects(restarted.reserve(scope,row.id));
      assert.equal((await f.prisma.aiEvaluationBudgetReservation.findUniqueOrThrow({where:{id:row.id}})).chargedNanos,amount);
    });
    await t.test("usage settlement is idempotent, immutable and releases only known unused estimate", async () => {
      await service.settle(row.id,p,100,20);await service.settle(row.id,p,100,20);
      await assert.rejects(service.settle(row.id,p,101,20));
      await assert.rejects(service.settle(row.id,p,1048577,20));
      const after=await f.prisma.aiEvaluationBudgetReservation.findUniqueOrThrow({where:{id:row.id}});assert.equal(after.status,'settled');assert.equal(after.chargedNanos,service.estimate(p,100,20));
      assert.equal(await f.prisma.aiExecutionTrace.count(),0,'internal estimate never writes Provider cost truth');
    });
    await t.test("same run cannot change exchange rate or bypass persisted cap", async () => {
      raw=JSON.stringify({...p,usdCnyMicros:'7100000'});await assert.rejects(service.reserve(scope,'changed-policy-call'));raw=JSON.stringify(p);
      await f.prisma.$transaction(tx=>service.assertWithinBudget(tx,scope));
      assert.equal((await f.request('/health')).body.data.status,'ok');
    });
  } finally { await f.close(); }
});
