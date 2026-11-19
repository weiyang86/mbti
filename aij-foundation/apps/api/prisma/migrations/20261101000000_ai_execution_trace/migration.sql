CREATE TYPE "AiExecutionTraceStatus" AS ENUM ('running', 'succeeded', 'failed');

CREATE TYPE "AiExecutionFailureCategory" AS ENUM (
  'configuration_unavailable',
  'capability_unavailable',
  'budget_denied',
  'credential_unavailable',
  'provider_unavailable',
  'invalid_provider_response',
  'provider_error',
  'timeout',
  'execution_error'
);

CREATE TYPE "AiTraceCostSource" AS ENUM ('unreported', 'provider_reported');

CREATE TABLE "ai_execution_trace" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "project_id" TEXT NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "capability_code" TEXT NOT NULL,
  "provider_code" TEXT,
  "model_code" TEXT,
  "status" "AiExecutionTraceStatus" NOT NULL DEFAULT 'running',
  "failure_category" "AiExecutionFailureCategory",
  "input_shape" JSONB NOT NULL,
  "output_shape" JSONB,
  "prompt_tokens" INTEGER,
  "completion_tokens" INTEGER,
  "cached_tokens" INTEGER,
  "cost_amount_nanos" BIGINT,
  "cost_currency" CHAR(3),
  "cost_source" "AiTraceCostSource" NOT NULL DEFAULT 'unreported',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_execution_trace_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_execution_trace_attempt_positive" CHECK ("attempt" > 0),
  CONSTRAINT "ai_execution_trace_failure_state" CHECK (("status" = 'failed') = ("failure_category" IS NOT NULL)),
  CONSTRAINT "ai_execution_trace_token_counts_nonnegative" CHECK (
    ("prompt_tokens" IS NULL OR "prompt_tokens" >= 0) AND
    ("completion_tokens" IS NULL OR "completion_tokens" >= 0) AND
    ("cached_tokens" IS NULL OR "cached_tokens" >= 0)
  ),
  CONSTRAINT "ai_execution_trace_cost_source_consistent" CHECK (
    ("cost_source" = 'unreported' AND "cost_amount_nanos" IS NULL AND "cost_currency" IS NULL) OR
    ("cost_source" = 'provider_reported' AND "cost_amount_nanos" IS NOT NULL AND "cost_amount_nanos" >= 0 AND "cost_currency" ~ '^[A-Z]{3}$')
  )
);

CREATE INDEX "ai_execution_trace_project_created_idx" ON "ai_execution_trace"("project_id", "created_at");
CREATE INDEX "ai_execution_trace_correlation_idx" ON "ai_execution_trace"("correlation_id");
CREATE INDEX "ai_execution_trace_status_created_idx" ON "ai_execution_trace"("status", "created_at");
CREATE UNIQUE INDEX "ai_execution_trace_job_attempt_key" ON "ai_execution_trace"("job_id", "attempt");

ALTER TABLE "ai_execution_trace"
ADD CONSTRAINT "ai_execution_trace_job_id_fkey"
FOREIGN KEY ("job_id") REFERENCES "runtime_job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_execution_trace"
ADD CONSTRAINT "ai_execution_trace_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "project_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
