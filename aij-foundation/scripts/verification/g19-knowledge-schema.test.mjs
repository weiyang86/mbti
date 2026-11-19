import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const migration = "apps/api/prisma/migrations/20261102000000_ai_knowledge_document/migration.sql";
const generated = execFileSync("pnpm", ["--filter", "@aij/api", "exec", "prisma", "migrate", "diff",
  "--from-schema-datamodel", "../../.artifacts/continuous/2026-11-02-to-G19/G19-01-base-schema.prisma",
  "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8", maxBuffer: 1024 * 1024 });
const normalize = sql => sql.replace(/\n+$/, "\n");
const migrationText = readFileSync(migration, "utf8");
const marker = "-- G19: register the knowledge permissions once and grant them only to existing active system OWNER roles.\n";
const markerIndex = migrationText.indexOf(marker);
assert.notEqual(markerIndex, -1, "migration includes the narrowly scoped owner permission backfill");
const ddl = migrationText.slice(0, markerIndex);
const backfill = migrationText.slice(markerIndex);
assert.equal(normalize(ddl), normalize(generated), "DDL equals Prisma's read-only diff from the captured pre-AF-108 schema");
assert.ok(generated.includes('CREATE TABLE "ai_knowledge_document"'));
assert.ok(generated.includes('"workspace_id", "document_code"'));
assert.equal((generated.match(/ON DELETE RESTRICT/g) || []).length, 2, "workspace and author foreign keys both restrict deletion");
assert.match(backfill, /role\."code" = 'OWNER' AND role\."is_system" = TRUE/);
assert.match(backfill, /ON CONFLICT \("role_id", "permission_id"\) DO NOTHING/);
assert.doesNotMatch(backfill, /DELETE\s+FROM|UPDATE\s+"client_workspace_membership"/i, "backfill grants only active system owners and does not remove/change memberships");
for (const forbidden of ["company_profile", "diagnosis", "business_order", "merchant_credential", "customer_email"]) {
  assert.equal(generated.toLowerCase().includes(forbidden), false, `generated migration excludes ${forbidden}`);
}
console.log("AF-108 migration matches the frozen schema diff and contains only workspace knowledge documents with restrictive owner FKs.");
