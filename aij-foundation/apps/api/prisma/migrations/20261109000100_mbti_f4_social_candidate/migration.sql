-- Additive MBTI-only F4 candidate; no changes to F1/F2/F3 or Foundation ledgers.
CREATE TABLE "MbtiCard" (
 "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL UNIQUE REFERENCES "MbtiGuest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "nickname" TEXT NOT NULL DEFAULT '', "typeCode" TEXT NOT NULL DEFAULT '', "declaration" TEXT NOT NULL DEFAULT '',
 "interests" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "style" TEXT NOT NULL DEFAULT 'illustration',
 "discoverable" BOOLEAN NOT NULL DEFAULT false,
 "visibilityName" BOOLEAN NOT NULL DEFAULT false, "visibilityInterests" BOOLEAN NOT NULL DEFAULT false,
 "visibilityDeclaration" BOOLEAN NOT NULL DEFAULT false, "visibilityManual" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "MbtiCard_type_check" CHECK ("typeCode" IN ('','INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP')),
 CONSTRAINT "MbtiCard_public_type_check" CHECK (NOT "discoverable" OR "typeCode" <> ''),
 CONSTRAINT "MbtiCard_style_check" CHECK ("style" IN ('illustration','editorial','game'))
);
CREATE INDEX "MbtiCard_discoverable_updatedAt_id_idx" ON "MbtiCard"("discoverable","updatedAt" DESC,"id" DESC);
CREATE TABLE "MbtiSocialBlock" (
 "blockerId" TEXT NOT NULL REFERENCES "MbtiGuest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "blockedId" TEXT NOT NULL REFERENCES "MbtiGuest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "active" BOOLEAN NOT NULL DEFAULT true, "lastBlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY ("blockerId","blockedId"), CONSTRAINT "MbtiSocialBlock_not_self" CHECK ("blockerId" <> "blockedId")
);
CREATE INDEX "MbtiSocialBlock_blockedId_active_idx" ON "MbtiSocialBlock"("blockedId","active");
CREATE TABLE "MbtiCardExchange" (
 "id" TEXT PRIMARY KEY, "pairKey" TEXT NOT NULL,
 "senderId" TEXT NOT NULL REFERENCES "MbtiGuest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "recipientId" TEXT NOT NULL REFERENCES "MbtiGuest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "status" TEXT NOT NULL DEFAULT 'pending', "respondedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "MbtiCardExchange_not_self" CHECK ("senderId" <> "recipientId"),
 CONSTRAINT "MbtiCardExchange_canonical_pair" CHECK ("pairKey" = LEAST("senderId","recipientId") || ':' || GREATEST("senderId","recipientId")),
 CONSTRAINT "MbtiCardExchange_status_check" CHECK ("status" IN ('pending','accepted','declined','revoked'))
);
CREATE INDEX "MbtiCardExchange_pairKey_createdAt_id_idx" ON "MbtiCardExchange"("pairKey","createdAt" DESC,"id" DESC);
CREATE INDEX "MbtiCardExchange_senderId_createdAt_id_idx" ON "MbtiCardExchange"("senderId","createdAt" DESC,"id" DESC);
CREATE INDEX "MbtiCardExchange_recipientId_createdAt_id_idx" ON "MbtiCardExchange"("recipientId","createdAt" DESC,"id" DESC);
CREATE UNIQUE INDEX "MbtiCardExchange_one_active_pair" ON "MbtiCardExchange"("pairKey") WHERE "status" IN ('pending','accepted');
