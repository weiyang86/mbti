import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { extractKnowledgeWebText, KNOWLEDGE_WEB_EXTRACTION_VERSION } from "./knowledge-web-extractor";
import { knowledgeWebReader, normalizeKnowledgeWebUrl, type KnowledgeWebReader } from "./knowledge-web-reader";

export const KNOWLEDGE_WEB_IMPORT_TRANSPORT = Symbol("AIJ_KNOWLEDGE_WEB_IMPORT_TRANSPORT");
export const KNOWLEDGE_WEB_SOURCE_FILENAME = "web-import";
export type KnowledgeWebDocumentSource = Readonly<{
  filename: typeof KNOWLEDGE_WEB_SOURCE_FILENAME;
  checksum: string;
  sourceUrl: string;
  sourceFinalUrl: string;
  sourceTextChecksum: string;
  sourceExtractionVersion: typeof KNOWLEDGE_WEB_EXTRACTION_VERSION;
}>;
export type KnowledgeDocumentSource = Readonly<{ filename: string; checksum: string }> | KnowledgeWebDocumentSource;
export function isKnowledgeWebSource(source: KnowledgeDocumentSource): source is KnowledgeWebDocumentSource {
  return "sourceUrl" in source;
}
export const knowledgeWebTextChecksum = (body: string): string => createHash("sha256").update(body, "utf8").digest("hex");

/** Internal composition seam only; production always uses AF171 reader and AF174 parser defaults. */
export class KnowledgeWebImportTransport {
  constructor(private readonly reader: Pick<KnowledgeWebReader, "read"> = knowledgeWebReader) {}
  async extract(input: string): Promise<{ content: string; source: KnowledgeWebDocumentSource }> {
    try {
      const sourceUrl = normalizeKnowledgeWebUrl(input).href;
      const fetched = await this.reader.read(sourceUrl); // no caller/cache/header/TLS options
      const extracted = await extractKnowledgeWebText(fetched);
      if (extracted.textByteLength > 64 * 1024) throw new PayloadTooLargeException("WEB_IMPORT_TOO_LARGE");
      return { content: extracted.text, source: {
        filename: KNOWLEDGE_WEB_SOURCE_FILENAME, checksum: extracted.sourceChecksum,
        sourceUrl, sourceFinalUrl: normalizeKnowledgeWebUrl(fetched.sourceUrl).href,
        sourceTextChecksum: extracted.textChecksum, sourceExtractionVersion: extracted.extractionVersion
      } };
    } catch (error) {
      if (error instanceof PayloadTooLargeException) throw new PayloadTooLargeException("WEB_IMPORT_TOO_LARGE");
      throw new BadRequestException("WEB_IMPORT_REJECTED");
    }
  }
}

/** Defense in depth on the sole writer's trusted internal option, including exact persisted body. */
export function assertKnowledgeWebSource(source: KnowledgeWebDocumentSource, content: string): void {
  try {
    if (source.filename !== KNOWLEDGE_WEB_SOURCE_FILENAME || !/^[a-f0-9]{64}$/.test(source.checksum)
      || source.sourceExtractionVersion !== KNOWLEDGE_WEB_EXTRACTION_VERSION
      || source.sourceTextChecksum !== knowledgeWebTextChecksum(content)
      || normalizeKnowledgeWebUrl(source.sourceUrl).href !== source.sourceUrl
      || normalizeKnowledgeWebUrl(source.sourceFinalUrl).href !== source.sourceFinalUrl) throw new Error();
  } catch { throw new BadRequestException("WEB_IMPORT_REJECTED"); }
}
