CREATE TABLE "connector_installation" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "connector_code" TEXT NOT NULL,
    "manifest_version" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "secret_ref" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'configured',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "connector_installation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "connector_installation_status_check" CHECK ("status" IN ('configured', 'enabled', 'disabled', 'failed')),
    CONSTRAINT "connector_installation_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "connector_installation_project_connector_key"
    ON "connector_installation"("project_id", "connector_code");
CREATE INDEX "connector_installation_project_status_idx"
    ON "connector_installation"("project_id", "status");
CREATE INDEX "connector_installation_connector_status_idx"
    ON "connector_installation"("connector_code", "status");

ALTER TABLE "connector_installation"
    ADD CONSTRAINT "connector_installation_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "project_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "connector_installation"
    ADD CONSTRAINT "connector_installation_secret_ref_fkey"
    FOREIGN KEY ("secret_ref") REFERENCES "secret_reference"("ref") ON DELETE RESTRICT ON UPDATE CASCADE;
