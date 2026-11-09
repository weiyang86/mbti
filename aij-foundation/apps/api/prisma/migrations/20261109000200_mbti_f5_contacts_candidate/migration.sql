-- Additive F5 candidate: references/epochs only; NO contact plaintext/JSON/public FileAsset.
CREATE TABLE "MbtiPrivateContacts" (
 "ownerId" TEXT PRIMARY KEY REFERENCES "MbtiGuest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "epoch" BIGINT NOT NULL DEFAULT 0 CHECK ("epoch" >= 0), "objectKey" TEXT UNIQUE, "checksum" TEXT,
 "size" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "MbtiPrivateContacts_reference_check" CHECK (("objectKey" IS NULL AND "checksum" IS NULL AND "size" = 0) OR
 ("objectKey" IS NOT NULL AND "checksum" ~ '^[a-f0-9]{64}$' AND "size" > 0))
);
CREATE TABLE "MbtiContactRequest" (
 "id" TEXT PRIMARY KEY,
 "senderId" TEXT NOT NULL REFERENCES "MbtiGuest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "recipientId" TEXT NOT NULL REFERENCES "MbtiGuest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "exchangeId" TEXT NOT NULL REFERENCES "MbtiCardExchange"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "contactEpoch" BIGINT NOT NULL CHECK ("contactEpoch" > 0), "channels" TEXT[] NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending', "respondedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "MbtiContactRequest_not_self" CHECK ("senderId" <> "recipientId"),
 CONSTRAINT "MbtiContactRequest_status_check" CHECK ("status" IN ('pending','accepted','declined','revoked')),
 CONSTRAINT "MbtiContactRequest_channels_check" CHECK (
 "channels" IN (ARRAY['wechat'], ARRAY['qq'], ARRAY['phone'], ARRAY['wechat','qq'], ARRAY['wechat','phone'], ARRAY['qq','phone'], ARRAY['wechat','qq','phone']))
);

CREATE INDEX "MbtiContactRequest_senderId_createdAt_id_idx" ON "MbtiContactRequest"("senderId","createdAt" DESC,"id" DESC);
CREATE INDEX "MbtiContactRequest_recipientId_createdAt_id_idx" ON "MbtiContactRequest"("recipientId","createdAt" DESC,"id" DESC);
CREATE INDEX "MbtiContactRequest_exchangeId_idx" ON "MbtiContactRequest"("exchangeId");
CREATE UNIQUE INDEX "MbtiContactRequest_one_active_direction" ON "MbtiContactRequest"("senderId","recipientId") WHERE "status" IN ('pending','accepted');
