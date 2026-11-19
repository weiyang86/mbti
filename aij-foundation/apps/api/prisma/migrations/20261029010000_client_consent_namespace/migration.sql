ALTER TABLE "client_consent_record" ADD COLUMN "namespace" TEXT;

-- Existing consent history has no trustworthy product/environment scope. Keep it
-- isolated as legacy data and never expose it to a newly configured client namespace.
UPDATE "client_consent_record" SET "namespace" = 'legacy-unscoped' WHERE "namespace" IS NULL;
ALTER TABLE "client_consent_record" ALTER COLUMN "namespace" SET NOT NULL;

DROP INDEX IF EXISTS "client_consent_member_type_captured_idx";
CREATE INDEX "client_consent_namespace_member_type_captured_idx"
  ON "client_consent_record"("namespace", "member_id", "consent_type", "captured_at");
