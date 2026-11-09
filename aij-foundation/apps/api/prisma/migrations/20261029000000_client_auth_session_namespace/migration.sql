ALTER TABLE "client_auth_session" ADD COLUMN "namespace" TEXT;

-- Existing sessions do not carry a trustworthy project/environment owner. Fail closed and
-- require a fresh login instead of assigning them to an arbitrary new project namespace.
UPDATE "client_auth_session" SET "namespace" = 'legacy-unscoped' WHERE "namespace" IS NULL;
ALTER TABLE "client_auth_session" ALTER COLUMN "namespace" SET NOT NULL;

DROP INDEX IF EXISTS "client_auth_session_member_status_seen_idx";
CREATE INDEX "client_auth_session_namespace_member_status_seen_idx"
  ON "client_auth_session"("namespace", "member_id", "status", "last_seen_at");
