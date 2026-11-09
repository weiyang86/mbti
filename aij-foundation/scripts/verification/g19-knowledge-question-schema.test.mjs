import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const schemaPath = "apps/api/prisma/schema.prisma";
const migrationPath = "apps/api/prisma/migrations/20261102010000_ai_knowledge_question/migration.sql";
const baselinePath = ".artifacts/continuous/2026-11-02-to-G19/AF-110-base-schema.prisma";
const migration = readFileSync(migrationPath, "utf8");
const schema = readFileSync(schemaPath, "utf8");
const generated = execFileSync("pnpm", ["--filter", "@aij/api", "exec", "prisma", "migrate", "diff",
  "--from-schema-datamodel", "../../.artifacts/continuous/2026-11-02-to-G19/AF-110-base-schema.prisma",
  "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8", maxBuffer: 1024 * 1024 });

const normalize = sql => sql.replace(/\n+$/, "\n");

test("question migration is additive and matches the frozen pre-AF-110 schema diff", () => {
  assert.ok(readFileSync(baselinePath, "utf8").length > 0);
  assert.equal(normalize(migration), normalize(generated));
  assert.match(migration, /CREATE TYPE "AiKnowledgeQuestionStatus" AS ENUM \('queued', 'running', 'answered', 'refused', 'failed'\)/);
  assert.match(migration, /CREATE TABLE "ai_knowledge_question"/);
  assert.match(migration, /"workspace_id" CHAR\(64\)|"workspace_id" TEXT/);
  assert.match(migration, /"idempotency_key_hash" CHAR\(64\) NOT NULL/);
  assert.match(migration, /"request_fingerprint" CHAR\(64\) NOT NULL/);
  assert.match(migration, /"runtime_job_id" TEXT/);
  assert.match(migration, /"answer" TEXT/);
  assert.match(migration, /"citations" JSONB/);
  assert.match(migration, /UNIQUE INDEX "ai_knowledge_question_workspace_idempotency_key"/);
  assert.match(migration, /UNIQUE INDEX "ai_knowledge_question_runtime_job_id_key"/);
  assert.equal((migration.match(/ON DELETE RESTRICT/g) || []).length, 3);
  assert.doesNotMatch(migration, /^\s*(?:DROP\s+(?:TABLE|TYPE|INDEX)|TRUNCATE(?:\s|$)|DELETE\s+FROM|UPDATE\s+"[^"]+")/im);
  const questionModel = schema.slice(schema.indexOf("model AiKnowledgeQuestion {"), schema.indexOf("enum PluginInstallationStatus"));
  assert.ok(questionModel.length > 0, "AI question model exists in its scoped section");
  for (const forbidden of ["CompanyProfile", "PaymentOrder", "Diagnosis", "MerchantCredential", "BusinessPrompt"]) {
    assert.equal(questionModel.includes(forbidden), false, `question model excludes ${forbidden} business dependency`);
  }
  for (const forbidden of ["company_profile", "payment_order", "diagnosis", "merchant_credential", "business_prompt"]) {
    assert.equal(migration.toLowerCase().includes(forbidden), false, `migration excludes ${forbidden}`);
  }
});
