export const AI_KNOWLEDGE_RETRIEVAL_POLICY = Object.freeze({
  minimumMatchedTerms: 2,
  minimumQueryCoverage: 0.5,
  maximumQueryTerms: 128,
  maximumCandidates: 500,
  maximumCitations: 5,
  maximumExcerptCharacters: 400
});

export interface KnowledgeCandidate {
  id: string;
  documentCode: string;
  title: string;
  content: string;
}

export interface KnowledgeCitation {
  documentId: string;
  documentCode: string;
  title: string;
  excerpt: string;
  evidenceCoverage: number;
}

export interface KnowledgeRetrievalResult {
  result: "EVIDENCE_FOUND" | "REFUSED";
  refusalCode: "INSUFFICIENT_EVIDENCE" | null;
  evidenceCoverage: number;
  citations: KnowledgeCitation[];
}

/**
 * Produces stable lexical units without external tokenizers or model calls.
 * Han text uses adjacent bigrams; other letters/numbers use normalized words.
 */
export function knowledgeTerms(input: string): string[] {
  const normalized = input.normalize("NFKC").toLowerCase();
  const terms = new Set<string>();
  const hanRuns = normalized.match(/\p{Script=Han}+/gu) ?? [];
  for (const run of hanRuns) {
    const codePoints = Array.from(run);
    if (codePoints.length === 1) terms.add(codePoints[0]);
    for (let index = 0; index < codePoints.length - 1; index += 1) {
      terms.add(codePoints.slice(index, index + 2).join(""));
    }
  }
  const withoutHan = normalized.replace(/\p{Script=Han}+/gu, " ");
  for (const match of withoutHan.matchAll(/[\p{L}\p{N}]+/gu)) {
    const term = match[0];
    if (Array.from(term).length >= 2) terms.add(term);
  }
  return [...terms];
}

function truncateCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}

function evidenceExcerpt(content: string, matchedTerms: readonly string[]): string {
  const sentences = content.split(/(?<=[。.!?！？;；\n])/u).map(value => value.trim()).filter(Boolean);
  const matching = sentences.filter(sentence => {
    const normalized = sentence.normalize("NFKC").toLowerCase();
    return matchedTerms.some(term => normalized.includes(term));
  }).slice(0, 3);
  return truncateCodePoints((matching.length ? matching.join(" ") : content).trim(), AI_KNOWLEDGE_RETRIEVAL_POLICY.maximumExcerptCharacters);
}

export function retrieveKnowledgeEvidence(question: string, candidates: readonly KnowledgeCandidate[]): KnowledgeRetrievalResult {
  const terms = knowledgeTerms(question);
  if (terms.length < AI_KNOWLEDGE_RETRIEVAL_POLICY.minimumMatchedTerms || terms.length > AI_KNOWLEDGE_RETRIEVAL_POLICY.maximumQueryTerms) {
    return { result: "REFUSED", refusalCode: "INSUFFICIENT_EVIDENCE", evidenceCoverage: 0, citations: [] };
  }

  const ranked = candidates.map(candidate => {
    const normalized = candidate.content.normalize("NFKC").toLowerCase();
    const matchedTerms = terms.filter(term => normalized.includes(term));
    const coverage = matchedTerms.length / terms.length;
    return { candidate, matchedTerms, coverage };
  }).filter(item => item.matchedTerms.length >= AI_KNOWLEDGE_RETRIEVAL_POLICY.minimumMatchedTerms
      && item.coverage >= AI_KNOWLEDGE_RETRIEVAL_POLICY.minimumQueryCoverage)
    .sort((left, right) => right.coverage - left.coverage
      || right.matchedTerms.length - left.matchedTerms.length
      || left.candidate.documentCode.localeCompare(right.candidate.documentCode)
      || left.candidate.id.localeCompare(right.candidate.id));

  const citations = ranked.slice(0, AI_KNOWLEDGE_RETRIEVAL_POLICY.maximumCitations).map(({ candidate, matchedTerms, coverage }) => ({
    documentId: candidate.id,
    documentCode: candidate.documentCode,
    title: candidate.title,
    excerpt: evidenceExcerpt(candidate.content, matchedTerms),
    evidenceCoverage: Number(coverage.toFixed(4))
  }));
  return {
    result: citations.length ? "EVIDENCE_FOUND" : "REFUSED",
    refusalCode: citations.length ? null : "INSUFFICIENT_EVIDENCE",
    evidenceCoverage: citations[0]?.evidenceCoverage ?? 0,
    citations
  };
}
