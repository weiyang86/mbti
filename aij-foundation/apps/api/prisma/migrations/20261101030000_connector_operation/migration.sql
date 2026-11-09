CREATE TYPE "ConnectorOperationType" AS ENUM ('secret_reference_check');
CREATE TYPE "ConnectorOperationStatus" AS ENUM ('succeeded', 'failed');
CREATE TYPE "ConnectorOperationFailureCode" AS ENUM ('secret_unavailable');

CREATE TABLE "connector_operation" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "connector_code" TEXT NOT NULL,
    "type" "ConnectorOperationType" NOT NULL,
    "status" "ConnectorOperationStatus" NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "last_failure_code" "ConnectorOperationFailureCode",
    "installation_version" INTEGER NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "connector_operation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connector_operation_attempt_count_check" CHECK ("attempt_count" >= 1),
    CONSTRAINT "connector_operation_installation_version_check" CHECK ("installation_version" >= 1),
    CONSTRAINT "connector_operation_result_check" CHECK (("status" = 'succeeded' AND "last_failure_code" IS NULL) OR ("status" = 'failed' AND "last_failure_code" IS NOT NULL)),
    CONSTRAINT "connector_operation_installation_fkey" FOREIGN KEY ("project_id", "connector_code") REFERENCES "connector_installation"("project_id", "connector_code") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "connector_operation_attempt" (
    "id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "ConnectorOperationStatus" NOT NULL,
    "failure_code" "ConnectorOperationFailureCode",
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "connector_operation_attempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connector_operation_attempt_number_check" CHECK ("attempt" >= 1),
    CONSTRAINT "connector_operation_attempt_result_check" CHECK (("status" = 'succeeded' AND "failure_code" IS NULL) OR ("status" = 'failed' AND "failure_code" IS NOT NULL)),
    CONSTRAINT "connector_operation_attempt_operation_fkey" FOREIGN KEY ("operation_id") REFERENCES "connector_operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "connector_operation_attempt_number_key" ON "connector_operation_attempt"("operation_id", "attempt");
CREATE INDEX "connector_operation_project_created_idx" ON "connector_operation"("project_id", "connector_code", "created_at", "id");
CREATE INDEX "connector_operation_status_updated_idx" ON "connector_operation"("status", "updated_at");
CREATE INDEX "connector_operation_attempt_history_idx" ON "connector_operation_attempt"("operation_id", "attempt");
