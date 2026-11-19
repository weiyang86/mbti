-- MBTI ops redeem ledger candidate: hash-only storage; plaintext only in create response.
CREATE TABLE "MbtiRedeemCode" (
  "id" TEXT PRIMARY KEY,
  "codeHash" CHAR(64) NOT NULL,
  "productCode" TEXT NOT NULL,
  "maxRedemptions" INTEGER NOT NULL DEFAULT 1 CHECK ("maxRedemptions" >= 1 AND "maxRedemptions" <= 1),
  "redeemedCount" INTEGER NOT NULL DEFAULT 0 CHECK ("redeemedCount" >= 0),
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'disabled')),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabledAt" TIMESTAMP(3),
  CHECK (("status" = 'disabled') = ("disabledAt" IS NOT NULL)),
  CHECK ("redeemedCount" <= "maxRedemptions")
);
CREATE UNIQUE INDEX "MbtiRedeemCode_codeHash_key" ON "MbtiRedeemCode"("codeHash");
CREATE INDEX "MbtiRedeemCode_status_createdAt_id_idx" ON "MbtiRedeemCode"("status", "createdAt" DESC, "id" DESC);
CREATE INDEX "MbtiRedeemCode_productCode_status_idx" ON "MbtiRedeemCode"("productCode", "status");

INSERT INTO sys_permission (id, permission_code, permission_name, resource_type, module, action, api_path, status, updated_at)
VALUES
  ('mbti-ops-redemption-write', 'mbti:ops:redemption:write', 'MBTI体验兑换码写入', 'api', 'mbti', 'write', '/api/admin/mbti/redeem-codes', 'active', CURRENT_TIMESTAMP)
ON CONFLICT (permission_code) DO NOTHING;
