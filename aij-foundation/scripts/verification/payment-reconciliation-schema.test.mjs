import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const migration = "apps/api/prisma/migrations/20261101110000_payment_reconciliation/migration.sql";
const generated = execFileSync("pnpm", ["--filter", "@aij/api", "exec", "prisma", "migrate", "diff",
  "--from-schema-datamodel", "../../.artifacts/continuous/2026-11-01-to-G19/AF-107-schema-before.prisma",
  "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8", maxBuffer: 1024 * 1024 });
const normalizeTerminalBlankLines = (sql) => sql.replace(/\n+$/, "\n");
assert.equal(normalizeTerminalBlankLines(readFileSync(migration, "utf8")), normalizeTerminalBlankLines(generated),
  "checked-in migration must equal the read-only diff from the frozen pre-AF-107 schema, ignoring only terminal blank lines");
for (const name of ["PaymentReconciliationRun", "PaymentReconciliationDiscrepancy"]) assert.ok(generated.includes(`CREATE TABLE "${name === "PaymentReconciliationRun" ? "payment_reconciliation_run" : "payment_reconciliation_discrepancy"}"`));
for (const forbidden of ["company_profile", "diagnosis", "business_order", "merchant_credential"]) assert.ok(!generated.includes(forbidden), `migration excludes unrelated model ${forbidden}`);
assert.ok(generated.includes("ON DELETE RESTRICT"), "reconciliation evidence and reviewer relations are retained, not cascade-deleted");
console.log("AF-107 migration matches the schema-only Prisma diff; only project-scoped reconciliation tables/enums and restrictive relations are present.");
