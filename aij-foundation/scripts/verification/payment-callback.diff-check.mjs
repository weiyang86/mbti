import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const files = [
  "apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/20261101050000_payment_callback/migration.sql",
  "apps/api/src/plugins/aij-payment/payment.service.ts", "apps/api/src/plugins/aij-payment/payment-runtime.module.ts",
  "apps/api/src/plugins/aij-payment/payment-callback.controller.ts", "apps/api/src/plugins/aij-payment/payment-callback.service.ts",
  "apps/api/src/plugins/aij-payment/payment-callback.dto.ts", "apps/api/src/plugins/aij-payment/payment-callback-signature.ts",
  "scripts/database/migration.mjs", "scripts/database/seed.mjs", "scripts/runtime-environment.cjs", "scripts/verification/auth-support.mjs",
  "scripts/verification/client-auth-fixture.mjs", "scripts/verification/payment-callback.preflight.mjs",
  "scripts/verification/payment-callback.diff-check.mjs", "scripts/verification/payment-callback-contract.test.mjs",
  "scripts/verification/payment-callback-http-db.test.mjs", "scripts/verification/registry.mjs",
  "docs/generated/PRISMA_MODEL_OWNERSHIP.csv", "docs/development/PAYMENT_PROVIDER_CONTRACT.md",
  "docs/execution/AF-105.md", "docs/current/CURRENT_STATE.md", "docs/current/ARCHITECTURE.md",
  "docs/planning/CODING_QUEUE.json"
];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  assert.equal(text.includes("\0"), false, `${file} is text`);
  assert.equal(/(?:^|\n)[^\n]*[\t ]+(?:\r?\n|$)/.test(text), false, `${file} has no trailing whitespace`);
}
execFileSync("git", ["--no-optional-locks", "diff", "--check", "--", ...files], { stdio: "inherit" });
console.log(`AF-105 whitespace/diff check covered ${files.length} registered files, including untracked sources.`);
