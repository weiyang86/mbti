import { createHash } from "node:crypto";
import { loadSource, nest } from "./optimization-delta/source-loader.mjs";

// Legacy manual/CSV tests execute the real new source dependencies. Their
// network/parser boundaries deliberately fail if accidentally used; actual web
// parsing/HTTPS/DI has separate source and live acceptance, never these doubles.
export function loadKnowledgeWebImports() {
  const denyWebIo = () => { throw new Error("Unexpected web IO in legacy knowledge test"); };
  return {
    "./ai-knowledge-web-import.dto": loadSource("apps/api/src/plugins/aij-ai/ai-knowledge-web-import.dto.ts", { "@nestjs/common": nest }),
    "./knowledge-web-import": loadSource("apps/api/src/plugins/aij-ai/knowledge-web-import.ts", {
      "@nestjs/common": nest, "node:crypto": { createHash },
      "./knowledge-web-reader": { knowledgeWebReader: { read: denyWebIo }, normalizeKnowledgeWebUrl: denyWebIo },
      "./knowledge-web-extractor": { extractKnowledgeWebText: denyWebIo, KNOWLEDGE_WEB_EXTRACTION_VERSION: "aij-knowledge-web-text/1" }
    })
  };
}
