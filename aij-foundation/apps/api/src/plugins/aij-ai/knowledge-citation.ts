import { BadRequestException, ConflictException, GoneException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { retrieveKnowledgeEvidence } from "./ai-knowledge-retrieval";

export const KNOWLEDGE_CITATION_MAX_BYTES = 64 * 1024;
export const KNOWLEDGE_CITATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type CitationQuestion = Readonly<{
  id: string; workspaceId: string; memberId: string; status: string; query: string;
  citations: unknown; createdAt: Date; updatedAt: Date; deletedAt: Date | null; contentPurgedAt: Date | null;
}>;
export type CitationDocument = Readonly<{
  id: string; workspaceId: string; documentCode: string; title: string; content: string;
  status: string; updatedAt: Date; deletedAt: Date | null;
}>;
export type CurrentKnowledgeCitation = Readonly<{
  questionId: string; documentId: string; documentCode: string; title: string;
  content: string; excerpt: string; updatedAt: string; checksum: string; sourceState: "CURRENT";
}>;

export function knowledgeCitationId(raw: unknown): string {
  if (typeof raw !== "string" || !/^[a-z0-9]{20,32}$/.test(raw)) throw new BadRequestException("CITATION_INVALID");
  return raw;
}
const unavailable = (): never => { throw new NotFoundException("CITATION_UNAVAILABLE"); };
const changed = (): never => { throw new ConflictException("SOURCE_CHANGED"); };
function validText(raw: unknown): raw is string {
  return typeof raw === "string" && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(raw);
}
const date = (value: Date): number => value instanceof Date ? value.getTime() : NaN;

/** Pure projection only. The original owner MUST lock and authorize in its transaction,
 * then pass clock_timestamp() obtained after all potentially waiting operations.
 * This never reads a URL, repairs a question, or writes another owner's state.
 */
export function currentKnowledgeCitation(input: {
  memberId: string; workspaceId: string; questionId: string; documentId: string;
  question: CitationQuestion | null; document: CitationDocument | null; now: Date;
}): CurrentKnowledgeCitation {
  const { memberId, workspaceId, question, document, now } = input;
  const questionId = knowledgeCitationId(input.questionId), documentId = knowledgeCitationId(input.documentId);
  if (!question || question.id !== questionId || question.memberId !== memberId || question.workspaceId !== workspaceId || question.deletedAt !== null) return unavailable();
  if (![date(question.createdAt), date(question.updatedAt), date(now)].every(Number.isFinite)) return unavailable();
  if (date(now) >= date(question.createdAt) + KNOWLEDGE_CITATION_RETENTION_MS) throw new GoneException("CITATION_EXPIRED");
  if (question.status !== "answered" || question.contentPurgedAt !== null || !validText(question.query)
    || !Array.isArray(question.citations) || question.citations.length > 5) return unavailable();
  const matches = question.citations.filter((value: unknown) => value && typeof value === "object"
    && !Array.isArray(value) && (value as Record<string, unknown>).documentId === documentId);
  if (matches.length !== 1) return unavailable();
  const citation = matches[0] as Record<string, unknown>;
  if (!validText(citation.documentCode) || !validText(citation.title) || !validText(citation.excerpt)
    || !citation.excerpt || Array.from(citation.excerpt).length > 400) return unavailable();
  if (!document || document.id !== documentId || document.workspaceId !== workspaceId || document.status !== "active"
    || document.deletedAt !== null || !validText(document.content) || !document.content.trim()
    || Buffer.byteLength(document.content, "utf8") > KNOWLEDGE_CITATION_MAX_BYTES || !Number.isFinite(date(document.updatedAt))) return unavailable();
  if (document.title !== citation.title || document.documentCode !== citation.documentCode
    || date(document.updatedAt) > date(question.updatedAt)) return changed();
  // Use the original extraction algorithm. Excerpts can join separate matching
  // sentences, so substring containment would reject valid stored citations.
  const current = retrieveKnowledgeEvidence(question.query, [document]).citations[0];
  if (!current || current.excerpt !== citation.excerpt) return changed();
  return {
    questionId, documentId, documentCode: citation.documentCode, title: citation.title,
    content: document.content, excerpt: citation.excerpt, updatedAt: document.updatedAt.toISOString(),
    checksum: createHash("sha256").update(document.content, "utf8").digest("hex"), sourceState: "CURRENT"
  };
}
