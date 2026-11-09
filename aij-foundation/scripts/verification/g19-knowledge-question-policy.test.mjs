import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(join(process.cwd(), "apps/api/package.json"));
const { OfflineKnowledgeTestBudgetAdmission, OfflineKnowledgeTestProvider, offlineKnowledgeTestMode } =
  require(join(process.cwd(), "apps/api/dist/plugins/aij-ai/offline-test-ai-provider.js"));

test("offline provider is enabled only by both test environments and the explicit switch", () => {
  const previous = process.env.AIJ_TEST_AI_PROVIDER_MODE;
  const config = values => ({ get: key => values[key] });
  try {
    process.env.AIJ_TEST_AI_PROVIDER_MODE = "offline-knowledge";
    assert.equal(offlineKnowledgeTestMode(config({ nodeEnv: "test", environment: "test" })), true);
    assert.equal(offlineKnowledgeTestMode(config({ nodeEnv: "production", environment: "test" })), false);
    assert.equal(offlineKnowledgeTestMode(config({ nodeEnv: "test", environment: "production" })), false);
    delete process.env.AIJ_TEST_AI_PROVIDER_MODE;
    assert.equal(offlineKnowledgeTestMode(config({ nodeEnv: "test", environment: "test" })), false);
  } finally {
    if (previous === undefined) delete process.env.AIJ_TEST_AI_PROVIDER_MODE;
    else process.env.AIJ_TEST_AI_PROVIDER_MODE = previous;
  }
});

test("offline adapter returns only server supplied evidence and no fabricated provider usage", async () => {
  const provider = new OfflineKnowledgeTestProvider();
  const result = await provider.invoke({ payload: { query: "synthetic", evidence: [{ excerpt: "合成来源片段" }] } }, "synthetic-credential-value-123");
  assert.deepEqual(result, { output: { answer: "合成来源片段" } });
  await assert.rejects(() => provider.invoke({ payload: { query: "synthetic", evidence: [] } }, "synthetic-credential-value-123"));
  await assert.rejects(() => provider.invoke({ payload: { query: "synthetic provider failure", evidence: [{ excerpt: "合成来源片段" }] } }, "synthetic-credential-value-123"));
  await assert.rejects(() => provider.invoke({ payload: { query: "synthetic", evidence: [{ excerpt: "合成来源片段" }] } }, "short"));
});

test("offline budget admission accepts only the offline synthetic provider and model", async () => {
  const admission = new OfflineKnowledgeTestBudgetAdmission();
  await admission.assertWithinBudget({}, { providerCode: "offline-knowledge", modelCode: "synthetic-qa-v1" });
  await assert.rejects(() => admission.assertWithinBudget({}, { providerCode: "deepseek", modelCode: "deepseek-chat" }));
});
