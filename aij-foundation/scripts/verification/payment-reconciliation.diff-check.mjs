import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = [
  "apps/api/prisma/schema.prisma",
  "apps/api/prisma/migrations/20261101110000_payment_reconciliation/migration.sql",
  "apps/api/src/plugins/aij-payment/payment-reconciliation.controller.ts",
  "apps/api/src/plugins/aij-payment/payment-reconciliation.dto.ts",
  "apps/api/src/plugins/aij-payment/payment-reconciliation.service.ts",
  "apps/api/src/plugins/aij-payment/payment-runtime.module.ts",
  "scripts/database/migration.mjs",
  "scripts/database/seed.mjs",
  "scripts/payment-admin-policy.cjs",
  "scripts/payment-admin-policy.d.cts",
  "scripts/runtime-environment.cjs",
  "scripts/verification/auth-support.mjs",
  "scripts/verification/payment-reconciliation.diff-check.mjs",
  "scripts/verification/payment-reconciliation.preflight.mjs",
  "scripts/verification/payment-reconciliation-schema.test.mjs",
  "scripts/verification/payment-reconciliation-http-db.test.mjs",
  "scripts/verification/rbac-fixture.mjs",
  "scripts/verification/registry.mjs",
  "scripts/verification/runtime-fixture.mjs",
  "docs/current/CURRENT_STATE.md",
  "docs/development/PAYMENT_PROVIDER_CONTRACT.md",
  "docs/execution/AF-107.md",
  "docs/generated/PRISMA_MODEL_OWNERSHIP.csv",
  "docs/planning/CODING_QUEUE.json"
];

for (const path of files) {
  const source = readFileSync(path, "utf8");
  assert.ok(!/[\t ]+$/m.test(source), `${path} has trailing whitespace`);
  assert.ok(!/^<<<<<<< |^=======\s*$|^>>>>>>> /m.test(source), `${path} has conflict markers`);
}
const migration = readFileSync("apps/api/prisma/migrations/20261101110000_payment_reconciliation/migration.sql", "utf8");
assert.ok(!/\n{2}$/.test(migration), "AF-107 migration must not end with an extra blank line");
execFileSync("git", ["--no-optional-locks", "diff", "--check", "HEAD", "--", ...files], { stdio: "pipe" });
console.log(`AF-107 whitespace/conflict check passed for ${files.length} registered paths, including untracked files; the ordinary index was not used.`);
