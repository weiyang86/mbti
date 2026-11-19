import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(join(process.cwd(), "apps/api/package.json"));
const { AI_KNOWLEDGE_RETRIEVAL_POLICY, knowledgeTerms, retrieveKnowledgeEvidence } = require(join(process.cwd(), "apps/api/dist/plugins/aij-ai/ai-knowledge-retrieval.js"));

test("AF-109 deterministic retrieval policy enforces evidence threshold and bounded citations", async t => {
  await t.test("normalizes English and creates stable Han bigrams", () => {
    assert.deepEqual(knowledgeTerms("AIJ 退款期限"), ["退款", "款期", "期限", "aij"]);
    assert.deepEqual(knowledgeTerms("aij 退款期限"), knowledgeTerms("ＡＩＪ 退款期限"));
  });

  await t.test("requires at least two matching terms and fifty percent query coverage", () => {
    const question = "退款期限是多少";
    const terms = knowledgeTerms(question);
    assert.equal(terms.length, 6);
    const enough = retrieveKnowledgeEvidence(question, [{ id: "doc-a", documentCode: "a", title: "A", content: "退款期限为30天。" }]);
    assert.equal(enough.result, "EVIDENCE_FOUND");
    assert.equal(enough.evidenceCoverage, 0.5);
    const weak = retrieveKnowledgeEvidence(question, [{ id: "doc-b", documentCode: "b", title: "B", content: "退款申请要联系合成服务台。" }]);
    assert.equal(weak.result, "REFUSED");
    assert.equal(weak.refusalCode, "INSUFFICIENT_EVIDENCE");
    assert.deepEqual(weak.citations, []);
  });

  await t.test("refuses one-term and unsupported questions without leaking candidate text", () => {
    const oneTerm = retrieveKnowledgeEvidence("退款", [{ id: "doc-a", documentCode: "a", title: "A", content: "退款期限为30天。" }]);
    assert.equal(oneTerm.result, "REFUSED");
    const unsupported = retrieveKnowledgeEvidence("量子传送原理", [{ id: "secret", documentCode: "secret", title: "Never expose", content: "Secret document text." }]);
    assert.equal(unsupported.result, "REFUSED");
    assert.equal(JSON.stringify(unsupported).includes("Secret document text"), false);
  });

  await t.test("citation order is deterministic and excerpts are bounded source text", () => {
    const documents = Array.from({ length: 8 }, (_, index) => ({
      id: `doc-${String(index).padStart(2, "0")}`,
      documentCode: `doc-${String(index).padStart(2, "0")}`,
      title: `Synthetic ${index}`,
      content: "退款期限为30天。" + "甲乙丙丁戊己庚辛壬癸。".repeat(80)
    }));
    const result = retrieveKnowledgeEvidence("退款期限是多少", documents);
    assert.equal(result.result, "EVIDENCE_FOUND");
    assert.equal(result.citations.length, AI_KNOWLEDGE_RETRIEVAL_POLICY.maximumCitations);
    assert.deepEqual(result.citations.map(item => item.documentId), ["doc-00", "doc-01", "doc-02", "doc-03", "doc-04"]);
    assert.ok(Array.from(result.citations[0].excerpt).length <= AI_KNOWLEDGE_RETRIEVAL_POLICY.maximumExcerptCharacters);
    assert.match(result.citations[0].excerpt, /退款期限为30天/);
  });
});
