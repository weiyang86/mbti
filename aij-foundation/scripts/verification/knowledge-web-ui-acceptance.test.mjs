import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
assert.equal(process.cwd(), "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation");
mkdirSync(".artifacts/af-182", { recursive: true });
writeFileSync(".artifacts/af-182/web-live-adapter.mjs", 'import { createFixture as original } from "../../scripts/verification/knowledge-web-import-fixture.mjs";\nexport const createFixture = options => original({ ...options, task: "AF-182" });\n');
process.env.AIJ_AF179_LIVE_ADAPTER = ".artifacts/af-182/web-live-adapter.mjs";
process.env.AIJ_KNOWLEDGE_WEB_LIVE_TASK = "AF-182";
await import("./knowledge-web-import-live.test.mjs");
