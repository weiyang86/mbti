import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
assert.equal(process.cwd(), "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation");
mkdirSync(".artifacts/af179", { recursive: true });
writeFileSync(".artifacts/af179/live-adapter.mjs", 'export { createFixture } from "../../scripts/verification/knowledge-web-import-fixture.mjs";\n');
process.env.AIJ_AF179_LIVE_ADAPTER = ".artifacts/af179/live-adapter.mjs";
await import("./knowledge-web-import-live.test.mjs");
