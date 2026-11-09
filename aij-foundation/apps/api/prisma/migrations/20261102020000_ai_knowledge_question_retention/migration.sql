ALTER TABLE "ai_knowledge_question"
ADD COLUMN "content_purged_at" TIMESTAMP(3);

CREATE INDEX "ai_knowledge_question_created_at_idx"
ON "ai_knowledge_question"("created_at");
