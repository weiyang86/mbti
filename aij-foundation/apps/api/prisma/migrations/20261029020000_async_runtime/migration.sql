-- CreateEnum
CREATE TYPE "RuntimeOutboxStatus" AS ENUM ('pending', 'processing', 'retry', 'processed', 'dead');

-- CreateEnum
CREATE TYPE "RuntimeJobStatus" AS ENUM ('pending', 'running', 'retry', 'completed', 'failed', 'dead', 'cancelled');

-- CreateEnum
CREATE TYPE "RuntimeIdempotencyStatus" AS ENUM ('processing', 'completed');

-- CreateTable
CREATE TABLE "runtime_outbox" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "producer" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "correlation_id" TEXT,
    "causation_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "RuntimeOutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 8,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "runtime_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_job" (
    "id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "job_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "scope" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "plugin_code" TEXT NOT NULL DEFAULT '',
    "workspace_id" TEXT,
    "status" "RuntimeJobStatus" NOT NULL DEFAULT 'pending',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "timeout_ms" INTEGER NOT NULL DEFAULT 30000,
    "dedupe_key" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "correlation_id" TEXT,
    "result_reference" JSONB,
    "last_error" TEXT,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "runtime_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_scheduler_lock" (
    "id" TEXT NOT NULL,
    "schedule_code" TEXT NOT NULL,
    "lease_owner" TEXT NOT NULL,
    "lease_expires_at" TIMESTAMP(3) NOT NULL,
    "last_enqueued_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "runtime_scheduler_lock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runtime_idempotency" (
    "id" TEXT NOT NULL,
    "request_scope" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "plugin_code" TEXT NOT NULL DEFAULT '',
    "owner" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "RuntimeIdempotencyStatus" NOT NULL DEFAULT 'processing',
    "result_reference" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "runtime_idempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "runtime_outbox_status_next_attempt_at_idx" ON "runtime_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "runtime_outbox_lease_expires_at_idx" ON "runtime_outbox"("lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_outbox_event_type_idempotency_key_key" ON "runtime_outbox"("event_type", "idempotency_key");

-- CreateIndex
CREATE INDEX "runtime_job_status_run_at_priority_idx" ON "runtime_job"("status", "run_at", "priority");

-- CreateIndex
CREATE INDEX "runtime_job_lease_expires_at_idx" ON "runtime_job"("lease_expires_at");

-- CreateIndex
CREATE INDEX "runtime_job_workspace_status_run_idx" ON "runtime_job"("workspace_id", "status", "run_at");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_job_scope_scope_id_job_type_dedupe_key_key" ON "runtime_job"("scope", "scope_id", "job_type", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_job_scope_scope_id_job_type_idempotency_key_key" ON "runtime_job"("scope", "scope_id", "job_type", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_scheduler_lock_schedule_code_key" ON "runtime_scheduler_lock"("schedule_code");

-- CreateIndex
CREATE INDEX "runtime_scheduler_lock_lease_expires_at_idx" ON "runtime_scheduler_lock"("lease_expires_at");

-- CreateIndex
CREATE INDEX "runtime_idempotency_status_expires_at_idx" ON "runtime_idempotency"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "runtime_idempotency_scope_owner_key" ON "runtime_idempotency"("request_scope", "scope", "scope_id", "plugin_code", "owner", "idempotency_key");
