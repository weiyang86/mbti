CREATE TABLE "MbtiGenerationJob" (
  "id" TEXT PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "recipe" TEXT NOT NULL DEFAULT 'balanced' CHECK ("recipe" IN ('portrait','balanced','style')),
  "status" TEXT NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued','running','succeeded','failed')),
  "attempt" INTEGER NOT NULL DEFAULT 0 CHECK ("attempt" >= 0),
  "lastErrorClass" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MbtiGenerationJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MbtiOrder"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "MbtiGenerationJob_status_updatedAt_id_idx" ON "MbtiGenerationJob"("status", "updatedAt" DESC, "id" DESC);
CREATE INDEX "MbtiGenerationJob_orderId_createdAt_idx" ON "MbtiGenerationJob"("orderId", "createdAt" DESC);

CREATE TABLE "MbtiModerationCase" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('report','block_appeal')),
  "subjectType" TEXT NOT NULL CHECK ("subjectType" IN ('card','user')),
  "subjectRef" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL CHECK ("reasonCode" IN ('false_profile','unwanted_contact','inappropriate','other')),
  "status" TEXT NOT NULL DEFAULT 'open' CHECK ("status" IN ('open','closed')),
  "decision" TEXT CHECK ("decision" IS NULL OR "decision" IN ('restrict','dismiss')),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "closedByUserId" TEXT,
  CHECK (("status" = 'closed') = ("closedAt" IS NOT NULL)),
  CHECK (("status" = 'open') OR ("decision" IS NOT NULL))
);
CREATE INDEX "MbtiModerationCase_status_createdAt_id_idx" ON "MbtiModerationCase"("status", "createdAt" DESC, "id" DESC);
CREATE INDEX "MbtiModerationCase_kind_status_idx" ON "MbtiModerationCase"("kind", "status");

CREATE TABLE "MbtiGrowthEvent" (
  "id" TEXT PRIMARY KEY,
  "channel" TEXT NOT NULL CHECK ("channel" IN ('wechat','mp','douyin','xhs')),
  "eventType" TEXT NOT NULL CHECK ("eventType" IN ('visit','preview','share_invoke','attributed_return')),
  "dayKey" CHAR(10) NOT NULL,
  "actorHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MbtiGrowthEvent_channel_dayKey_eventType_idx" ON "MbtiGrowthEvent"("channel", "dayKey", "eventType");
CREATE INDEX "MbtiGrowthEvent_dayKey_eventType_idx" ON "MbtiGrowthEvent"("dayKey", "eventType");

INSERT INTO sys_permission (id, permission_code, permission_name, resource_type, module, action, api_path, status, updated_at)
VALUES
  ('mbti-ops-generation-retry', 'mbti:ops:generation:retry', 'MBTI生成任务重试', 'api', 'mbti', 'write', '/api/admin/mbti/generation-jobs/:id/retry', 'active', CURRENT_TIMESTAMP),
  ('mbti-ops-moderation-read', 'mbti:ops:moderation:read', 'MBTI匿名工单只读', 'api', 'mbti', 'read', '/api/admin/mbti/moderation/cases', 'active', CURRENT_TIMESTAMP)
ON CONFLICT (permission_code) DO NOTHING;
