CREATE TABLE "connector_inbound_event" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "connector_code" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "payload_sha256" CHAR(64) NOT NULL,
    "event_timestamp" TIMESTAMP(3) NOT NULL,
    "installation_version" INTEGER NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_inbound_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connector_inbound_event_installation_version_check" CHECK ("installation_version" > 0)
);

CREATE UNIQUE INDEX "connector_inbound_event_idempotency_key"
    ON "connector_inbound_event"("project_id", "connector_code", "idempotency_key");
CREATE INDEX "connector_inbound_event_received_idx"
    ON "connector_inbound_event"("project_id", "connector_code", "received_at");

ALTER TABLE "connector_inbound_event"
    ADD CONSTRAINT "connector_inbound_event_installation_fkey"
    FOREIGN KEY ("project_id", "connector_code")
    REFERENCES "connector_installation"("project_id", "connector_code")
    ON DELETE RESTRICT ON UPDATE CASCADE;
