CREATE TYPE "PaymentRefundRequestStatus" AS ENUM ('pending_manual_review');

CREATE UNIQUE INDEX "payment_order_id_project_key" ON "payment_order"("id", "project_id");
CREATE UNIQUE INDEX "payment_transaction_id_order_key" ON "payment_transaction"("id", "order_id");

CREATE TABLE "payment_refund_request" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "payment_order_id" TEXT NOT NULL,
  "charge_transaction_id" TEXT NOT NULL,
  "requested_by_user_id" TEXT NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "currency_exponent" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "idempotency_key_hash" CHAR(64) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "status" "PaymentRefundRequestStatus" NOT NULL DEFAULT 'pending_manual_review',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_refund_request_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_refund_request_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "payment_refund_request_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "payment_refund_request_currency_exponent_check" CHECK ("currency_exponent" BETWEEN 0 AND 4),
  CONSTRAINT "payment_refund_request_reason_check" CHECK (length(btrim("reason")) BETWEEN 1 AND 500),
  CONSTRAINT "payment_refund_request_idempotency_hash_check" CHECK ("idempotency_key_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "payment_refund_request_fingerprint_check" CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "payment_refund_request_project_fkey" FOREIGN KEY ("project_id") REFERENCES "project_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_refund_request_order_project_fkey" FOREIGN KEY ("payment_order_id", "project_id") REFERENCES "payment_order"("id", "project_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_refund_request_charge_order_fkey" FOREIGN KEY ("charge_transaction_id", "payment_order_id") REFERENCES "payment_transaction"("id", "order_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_refund_request_requester_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "sys_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payment_refund_request_scope_idempotency_key" ON "payment_refund_request"("project_id", "requested_by_user_id", "idempotency_key_hash");
CREATE INDEX "payment_refund_request_order_status_created_idx" ON "payment_refund_request"("payment_order_id", "status", "created_at");
CREATE INDEX "payment_refund_request_project_created_idx" ON "payment_refund_request"("project_id", "created_at");
