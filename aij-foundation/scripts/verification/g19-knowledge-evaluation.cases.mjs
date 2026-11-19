const tokenPrefix = alias => alias === "alpha" ? "g19alpha" : "g19beta";

const answerableCases = Array.from({ length: 18 }, (_, index) => {
  const workspace = index < 9 ? "alpha" : "beta";
  const ordinal = String(index < 9 ? index + 1 : index - 8).padStart(2, "0");
  const key = `${workspace}-${ordinal}`;
  const prefix = tokenPrefix(workspace) + ordinal;
  const queryTokens = [`q${prefix}`, `i${prefix}`, `t${prefix}`];
  return Object.freeze({
    id: `answer-${key}`,
    kind: "answerable",
    workspace,
    documentCode: `g19-${workspace}-${ordinal}`,
    queryTokens,
    query: queryTokens.join(" "),
    answerMarker: `SYNTHETIC_ANSWER_${workspace.toUpperCase()}_${ordinal}`
  });
});

const unsupportedCases = Object.freeze([
  Object.freeze({
    id: "unsupported-alpha-asks-beta-only",
    kind: "unsupported-cross-workspace",
    workspace: "alpha",
    foreignWorkspace: "beta",
    foreignCaseId: "answer-beta-09",
    queryTokens: answerableCases[17].queryTokens,
    query: answerableCases[17].queryTokens.join(" ")
  }),
  Object.freeze({
    id: "unsupported-beta-asks-alpha-only",
    kind: "unsupported-cross-workspace",
    workspace: "beta",
    foreignWorkspace: "alpha",
    foreignCaseId: "answer-alpha-01",
    queryTokens: answerableCases[0].queryTokens,
    query: answerableCases[0].queryTokens.join(" ")
  })
]);

export const G19_KNOWLEDGE_EVALUATION = Object.freeze({
  caseCount: 20,
  answerableThreshold: 0.9,
  answerableCases: Object.freeze(answerableCases),
  unsupportedCases,
  cases: Object.freeze([...answerableCases, ...unsupportedCases])
});

export function syntheticDocumentContent(evaluationCase) {
  if (evaluationCase.kind !== "answerable") throw new TypeError("Only answerable synthetic cases own a document");
  return `Synthetic knowledge ${evaluationCase.id} records tokens ${evaluationCase.queryTokens.join(" ")} and the verified answer marker is ${evaluationCase.answerMarker}.`;
}
