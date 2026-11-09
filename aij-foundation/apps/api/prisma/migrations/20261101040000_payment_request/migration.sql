CREATE TYPE "PaymentOrderStatus" AS ENUM ('created', 'pending', 'succeeded', 'failed', 'closed');
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('created', 'submitting', 'pending', 'succeeded', 'failed', 'unknown', 'cancelled');

CREATE TABLE "payment_order" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "order_no" TEXT NOT NULL,
  "payable_owner" TEXT NOT NULL,
  "payable_reference" TEXT NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "currency_exponent" INTEGER NOT NULL,
  "idempotency_key_hash" CHAR(64) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "status" "PaymentOrderStatus" NOT NULL DEFAULT 'created',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "payment_order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_order_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "payment_order_currency_exponent_range" CHECK ("currency_exponent" BETWEEN 0 AND 6),
  CONSTRAINT "payment_order_project_fkey" FOREIGN KEY ("project_id") REFERENCES "project_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_order_workspace_member_fkey" FOREIGN KEY ("workspace_id", "member_id") REFERENCES "client_workspace_membership"("workspace_id", "member_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "payment_attempt" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "provider_code" TEXT NOT NULL,
  "provider_reference" TEXT,
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'created',
  "submitted_at" TIMESTAMP(3),
  "observed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_attempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_attempt_number_positive" CHECK ("attempt_number" > 0),
  CONSTRAINT "payment_attempt_order_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payment_order_order_no_key" ON "payment_order"("order_no");
CREATE UNIQUE INDEX "payment_order_scope_idempotency_key" ON "payment_order"("project_id", "workspace_id", "member_id", "idempotency_key_hash");
CREATE INDEX "payment_order_member_scope_created_idx" ON "payment_order"("project_id", "workspace_id", "member_id", "created_at");
CREATE INDEX "payment_order_status_created_idx" ON "payment_order"("status", "created_at");
CREATE UNIQUE INDEX "payment_attempt_order_number_key" ON "payment_attempt"("order_id", "attempt_number");
CREATE UNIQUE INDEX "payment_attempt_provider_reference_key" ON "payment_attempt"("provider_code", "provider_reference");
CREATE INDEX "payment_attempt_status_created_idx" ON "payment_attempt"("status", "created_at");
