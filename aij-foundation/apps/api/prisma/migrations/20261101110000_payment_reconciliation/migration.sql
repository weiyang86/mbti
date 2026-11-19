-- CreateEnum
CREATE TYPE "PaymentReconciliationDiscrepancyType" AS ENUM ('missing_local', 'missing_provider', 'duplicate_provider', 'order_mismatch', 'amount_mismatch', 'currency_mismatch', 'status_mismatch');

-- CreateEnum
CREATE TYPE "PaymentReconciliationReviewState" AS ENUM ('open', 'acknowledged', 'escalated');

-- CreateTable
CREATE TABLE "payment_reconciliation_run" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "provider_code" VARCHAR(50) NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "source_record_count" INTEGER NOT NULL,
    "matched_count" INTEGER NOT NULL,
    "discrepancy_count" INTEGER NOT NULL,
    "idempotency_key_hash" CHAR(64) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reconciliation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reconciliation_discrepancy" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "PaymentReconciliationDiscrepancyType" NOT NULL,
    "review_state" "PaymentReconciliationReviewState" NOT NULL DEFAULT 'open',
    "order_id" TEXT,
    "transaction_id" TEXT,
    "observed_order_no" VARCHAR(100),
    "provider_reference_hash" CHAR(64),
    "source_record_hash" CHAR(64) NOT NULL,
    "local_amount_minor" BIGINT,
    "observed_amount_minor" BIGINT,
    "local_currency" CHAR(3),
    "observed_currency" CHAR(3),
    "local_status" VARCHAR(32),
    "observed_status" VARCHAR(32),
    "observed_at" TIMESTAMP(3),
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reconciliation_discrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_reconciliation_run_project_created_idx" ON "payment_reconciliation_run"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_reconciliation_run_provider_window_idx" ON "payment_reconciliation_run"("project_id", "provider_code", "window_start", "window_end");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reconciliation_run_id_project_key" ON "payment_reconciliation_run"("id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reconciliation_run_scope_idempotency_key" ON "payment_reconciliation_run"("project_id", "created_by_user_id", "idempotency_key_hash");

-- CreateIndex
CREATE INDEX "payment_reconciliation_discrepancy_project_review_idx" ON "payment_reconciliation_discrepancy"("project_id", "review_state", "created_at");

-- CreateIndex
CREATE INDEX "payment_reconciliation_discrepancy_run_type_idx" ON "payment_reconciliation_discrepancy"("run_id", "type", "review_state");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reconciliation_discrepancy_run_sequence_key" ON "payment_reconciliation_discrepancy"("run_id", "sequence");

-- AddForeignKey
ALTER TABLE "payment_reconciliation_run" ADD CONSTRAINT "payment_reconciliation_run_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reconciliation_run" ADD CONSTRAINT "payment_reconciliation_run_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "sys_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reconciliation_discrepancy" ADD CONSTRAINT "payment_reconciliation_discrepancy_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reconciliation_discrepancy" ADD CONSTRAINT "payment_reconciliation_discrepancy_run_id_project_id_fkey" FOREIGN KEY ("run_id", "project_id") REFERENCES "payment_reconciliation_run"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reconciliation_discrepancy" ADD CONSTRAINT "payment_reconciliation_discrepancy_order_id_project_id_fkey" FOREIGN KEY ("order_id", "project_id") REFERENCES "payment_order"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reconciliation_discrepancy" ADD CONSTRAINT "payment_reconciliation_discrepancy_transaction_id_order_id_fkey" FOREIGN KEY ("transaction_id", "order_id") REFERENCES "payment_transaction"("id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reconciliation_discrepancy" ADD CONSTRAINT "payment_reconciliation_discrepancy_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "sys_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
