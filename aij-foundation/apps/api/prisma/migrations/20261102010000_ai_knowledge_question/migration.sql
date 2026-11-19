-- CreateEnum
CREATE TYPE "AiKnowledgeQuestionStatus" AS ENUM ('queued', 'running', 'answered', 'refused', 'failed');

-- CreateTable
CREATE TABLE "ai_knowledge_question" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "query" TEXT NOT NULL,
    "status" "AiKnowledgeQuestionStatus" NOT NULL DEFAULT 'queued',
    "answer" TEXT,
    "citations" JSONB,
    "refusal_code" TEXT,
    "failure_code" TEXT,
    "runtime_job_id" TEXT,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ai_knowledge_question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_knowledge_question_runtime_job_id_key" ON "ai_knowledge_question"("runtime_job_id");

-- CreateIndex
CREATE INDEX "ai_knowledge_question_workspace_status_created_idx" ON "ai_knowledge_question"("workspace_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_knowledge_question_workspace_idempotency_key" ON "ai_knowledge_question"("workspace_id", "idempotency_key_hash");

-- AddForeignKey
ALTER TABLE "ai_knowledge_question" ADD CONSTRAINT "ai_knowledge_question_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "client_workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_question" ADD CONSTRAINT "ai_knowledge_question_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_knowledge_question" ADD CONSTRAINT "ai_knowledge_question_runtime_job_id_fkey" FOREIGN KEY ("runtime_job_id") REFERENCES "runtime_job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
