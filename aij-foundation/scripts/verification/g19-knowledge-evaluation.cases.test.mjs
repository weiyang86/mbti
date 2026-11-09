import assert from "node:assert/strict";
import test from "node:test";
import { G19_KNOWLEDGE_EVALUATION, syntheticDocumentContent } from "./g19-knowledge-evaluation.cases.mjs";

test("G19-04 defines 20 unique synthetic cases with disjoint workspace evidence", () => {
  const { cases, answerableCases, unsupportedCases, caseCount, answerableThreshold } = G19_KNOWLEDGE_EVALUATION;
  assert.equal(cases.length, caseCount);
  assert.equal(answerableCases.length, 18);
  assert.equal(unsupportedCases.length, 2);
  assert.equal(answerableThreshold, 0.9);
  assert.equal(new Set(cases.map(item => item.id)).size, caseCount);
  assert.equal(new Set(answerableCases.map(item => item.documentCode)).size, answerableCases.length);
  assert.equal(answerableCases.filter(item => item.workspace === "alpha").length, 9);
  assert.equal(answerableCases.filter(item => item.workspace === "beta").length, 9);

  for (const item of answerableCases) {
    assert.equal(item.kind, "answerable");
    assert.equal(item.queryTokens.length, 3);
    assert.equal(new Set(item.queryTokens).size, 3);
    assert.match(item.answerMarker, /^SYNTHETIC_ANSWER_(ALPHA|BETA)_\d{2}$/);
    const content = syntheticDocumentContent(item);
    for (const token of item.queryTokens) assert.ok(content.includes(token), `${item.id} content contains ${token}`);
    assert.ok(content.includes(item.answerMarker), `${item.id} content contains its answer marker`);
    assert.doesNotMatch(content, /DeepSeek|customer|client email|real account/i);
  }

  for (const item of unsupportedCases) {
    assert.equal(item.kind, "unsupported-cross-workspace");
    assert.notEqual(item.workspace, item.foreignWorkspace);
    assert.ok(answerableCases.some(answer => answer.id === item.foreignCaseId && answer.workspace === item.foreignWorkspace));
    assert.equal(answerableCases.some(answer => answer.workspace === item.workspace && item.queryTokens.every(token => answer.queryTokens.includes(token))), false,
      `${item.id} tokens occur only in the foreign workspace`);
  }
});

test("the answer threshold is computed against supported cases and requires all evidence conditions", () => {
  const { answerableCases, answerableThreshold } = G19_KNOWLEDGE_EVALUATION;
  const score = passed => passed / answerableCases.length;
  assert.ok(score(16) < answerableThreshold);
  assert.ok(score(17) >= answerableThreshold);
  assert.ok(score(18) >= answerableThreshold);
  assert.equal(18 / 18, 1);
  // An answer without its sample-specific expected source must not be scored as correct.
  const scored = ({ status, answer, citations }, item) => status === "answered" && answer?.includes(item.answerMarker) && citations?.some(citation => citation.documentCode === item.documentCode);
  assert.equal(scored({ status: "answered", answer: "text without marker", citations: [{ documentCode: answerableCases[0].documentCode }] }, answerableCases[0]), false);
  assert.equal(scored({ status: "answered", answer: answerableCases[0].answerMarker, citations: [{ documentCode: "foreign-document" }] }, answerableCases[0]), false);
  assert.equal(scored({ status: "answered", answer: answerableCases[0].answerMarker, citations: [{ documentCode: answerableCases[0].documentCode }] }, answerableCases[0]), true);
});
