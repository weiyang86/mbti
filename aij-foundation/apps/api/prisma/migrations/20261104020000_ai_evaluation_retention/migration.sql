CREATE UNIQUE INDEX "ai_knowledge_question_id_workspace_key" ON "ai_knowledge_question"("id", "workspace_id");
CREATE TABLE "ai_evaluation_record" (
 "id" TEXT PRIMARY KEY, "project_id" TEXT NOT NULL, "workspace_id" TEXT NOT NULL, "question_id" TEXT NOT NULL,
 "run_key" TEXT NOT NULL, "case_key" TEXT NOT NULL, "status" TEXT NOT NULL,
 "input_text" TEXT, "output_text" TEXT, "content_purged_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("workspace_id", "run_key", "case_key"),
 FOREIGN KEY ("question_id", "workspace_id") REFERENCES "ai_knowledge_question"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ai_evaluation_record_created_at_content_purged_at_idx" ON "ai_evaluation_record"("created_at", "content_purged_at");
