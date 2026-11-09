ALTER TABLE "plugin_operation"
  ADD COLUMN "previous_version" TEXT,
  ADD COLUMN "retry_of_operation_id" TEXT;

CREATE UNIQUE INDEX "plugin_operation_retry_of_key"
  ON "plugin_operation"("retry_of_operation_id");

ALTER TABLE "plugin_operation"
  ADD CONSTRAINT "plugin_operation_retry_of_fkey"
  FOREIGN KEY ("retry_of_operation_id")
  REFERENCES "plugin_operation"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
