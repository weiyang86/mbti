-- Extend the existing internal budget owner; no second provider-cost ledger.
ALTER TABLE "ai_evaluation_budget_run" ADD COLUMN "limit_nanos" BIGINT NOT NULL DEFAULT 10000000000,
 ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'evaluation';
ALTER TABLE "ai_evaluation_budget_run" DROP CONSTRAINT "ai_evaluation_budget_run_used_nanos_check";
ALTER TABLE "ai_evaluation_budget_run" ADD CONSTRAINT "ai_budget_limit_check" CHECK (
 "limit_nanos" > 0 AND "limit_nanos" <= 999999999999999 AND "used_nanos" BETWEEN 0 AND "limit_nanos"
 AND "kind" IN ('evaluation','application') AND ("kind" <> 'evaluation' OR "limit_nanos" = 10000000000));
CREATE TABLE "ai_agent_run" (
 "id" TEXT PRIMARY KEY, "project_id" TEXT NOT NULL, "workspace_id" TEXT NOT NULL,
 "member_id" TEXT NOT NULL, "agent_code" TEXT NOT NULL, "agent_revision" INTEGER NOT NULL,
 "catalog_version" INTEGER NOT NULL, "job_id" TEXT NOT NULL UNIQUE REFERENCES "runtime_job"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "idempotency_key" TEXT NOT NULL, "request_hash" CHAR(64) NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued','running','succeeded','failed','unknown')),
 "snapshot" JSONB, "input" JSONB, "output" JSONB,
 "estimated_cost_nanos" BIGINT NOT NULL CHECK ("estimated_cost_nanos" >= 0),
 "budget_status" TEXT NOT NULL DEFAULT 'reserved' CHECK ("budget_status" IN ('reserved','settled','released')),
 "image_asset_id" TEXT REFERENCES "file_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "failure_code" TEXT, "attempted_at" TIMESTAMP(3), "completed_at" TIMESTAMP(3),
 "expires_at" TIMESTAMP(3) NOT NULL, "content_purged_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("workspace_id") REFERENCES "client_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("member_id") REFERENCES "member_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 UNIQUE ("project_id","workspace_id","member_id","idempotency_key")
);
CREATE INDEX "ai_agent_run_project_id_created_at_idx" ON "ai_agent_run"("project_id","created_at");
CREATE INDEX "ai_agent_run_project_id_workspace_id_created_at_idx" ON "ai_agent_run"("project_id","workspace_id","created_at");
CREATE INDEX "ai_agent_run_expires_at_content_purged_at_idx" ON "ai_agent_run"("expires_at","content_purged_at");

ALTER TABLE "ai_execution_trace" ADD COLUMN "image_count" INTEGER CHECK ("image_count" >= 0);

INSERT INTO "client_workspace_permission" ("id","code","name","status","created_at","updated_at") VALUES
 ('aij_workspace_ai_execute','workspace.ai.execute','Workspace AI execute','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('aij_workspace_ai_read','workspace.ai.read','Workspace own AI results read','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "client_workspace_role_permission" ("id","role_id","permission_id","created_at","updated_at")
 SELECT 'aij_ai_' || md5(role."id" || ':' || permission."id"),role."id",permission."id",CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
 FROM "client_workspace_role" AS role JOIN "client_workspace_permission" AS permission ON permission."code" IN ('workspace.ai.execute','workspace.ai.read')
 WHERE role."code"='OWNER' AND role."is_system"=TRUE AND role."deleted_at" IS NULL AND role."status"='active' AND permission."status"='active' AND permission."deleted_at" IS NULL
ON CONFLICT ("role_id","permission_id") DO NOTHING;
