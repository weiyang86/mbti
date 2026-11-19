CREATE TABLE "MbtiShareAsset" (
  "key" TEXT PRIMARY KEY CHECK ("key" ~ '^[a-f0-9]{64}$'),
  "resultId" TEXT NOT NULL REFERENCES "MbtiResult"("id") ON DELETE CASCADE,
  "bytes" BYTEA NOT NULL CHECK (octet_length("bytes") BETWEEN 1 AND 65536),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MbtiShareAsset_resultId_idx" ON "MbtiShareAsset"("resultId");
CREATE TRIGGER mbti_share_asset_immutable BEFORE UPDATE ON "MbtiShareAsset"
  FOR EACH ROW EXECUTE FUNCTION mbti_reject_update();
