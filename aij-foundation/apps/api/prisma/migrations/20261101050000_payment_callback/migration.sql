CREATE TYPE "PaymentCallbackEventStatus" AS ENUM ('received', 'accepted', 'rejected');
CREATE TYPE "PaymentTransactionKind" AS ENUM ('charge', 'refund', 'reversal');

ALTER TABLE "payment_attempt" ADD COLUMN "credential_ref" TEXT;

CREATE TABLE "payment_callback_event" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "attempt_id" TEXT NOT NULL,
  "provider_code" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "payload_sha256" CHAR(64) NOT NULL,
  "status" "PaymentCallbackEventStatus" NOT NULL DEFAULT 'received',
  "failure_code" TEXT,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  CONSTRAINT "payment_callback_event_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_callback_event_identity_check" CHECK ("provider_code" ~ '^[a-z][a-z0-9-]{0,49}$' AND "event_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  CONSTRAINT "payment_callback_event_digest_check" CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "payment_callback_event_processed_check" CHECK (("status" = 'received' AND "processed_at" IS NULL) OR ("status" <> 'received' AND "processed_at" IS NOT NULL)),
  CONSTRAINT "payment_callback_event_project_fkey" FOREIGN KEY ("project_id") REFERENCES "project_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_callback_event_order_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_callback_event_attempt_fkey" FOREIGN KEY ("attempt_id") REFERENCES "payment_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "payment_transaction" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "attempt_id" TEXT NOT NULL,
  "callback_event_id" TEXT NOT NULL,
  "provider_code" TEXT NOT NULL,
  "provider_reference" TEXT NOT NULL,
  "kind" "PaymentTransactionKind" NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_transaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_transaction_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "payment_transaction_provider_identity_check" CHECK ("provider_code" ~ '^[a-z][a-z0-9-]{0,49}$' AND "provider_reference" ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT "payment_transaction_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "payment_transaction_order_fkey" FOREIGN KEY ("order_id") REFERENCES "payment_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_transaction_attempt_fkey" FOREIGN KEY ("attempt_id") REFERENCES "payment_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_transaction_callback_event_fkey" FOREIGN KEY ("callback_event_id") REFERENCES "payment_callback_event"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "payment_callback_project_provider_event_key" ON "payment_callback_event"("project_id", "provider_code", "event_id");
CREATE INDEX "payment_callback_order_received_idx" ON "payment_callback_event"("order_id", "received_at");
CREATE UNIQUE INDEX "payment_transaction_callback_event_key" ON "payment_transaction"("callback_event_id");
CREATE UNIQUE INDEX "payment_transaction_provider_reference_kind_key" ON "payment_transaction"("provider_code", "provider_reference", "kind");
CREATE INDEX "payment_transaction_order_recorded_idx" ON "payment_transaction"("order_id", "recorded_at");
