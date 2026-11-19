CREATE TABLE "MbtiGuest" (
 "id" TEXT PRIMARY KEY, "tokenHash" TEXT NOT NULL UNIQUE, "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "MbtiQuestionBank" (
 "version" TEXT PRIMARY KEY, "payload" JSONB NOT NULL, "scoring" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "MbtiQuizSession" (
 "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "MbtiGuest"("id"),
 "bankVersion" TEXT NOT NULL REFERENCES "MbtiQuestionBank"("version"),
 "status" TEXT NOT NULL DEFAULT 'in_progress' CHECK ("status" IN ('in_progress','submitted')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "MbtiQuizSession_ownerId_createdAt_id_idx" ON "MbtiQuizSession"("ownerId", "createdAt", "id");
CREATE TABLE "MbtiAnswer" (
 "sessionId" TEXT NOT NULL REFERENCES "MbtiQuizSession"("id"), "questionId" TEXT NOT NULL,
 "optionId" TEXT NOT NULL, PRIMARY KEY ("sessionId", "questionId")
);
CREATE TABLE "MbtiResult" (
 "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL REFERENCES "MbtiGuest"("id"),
 "sessionId" TEXT UNIQUE REFERENCES "MbtiQuizSession"("id"), "source" TEXT NOT NULL,
 "typeCode" TEXT NOT NULL CHECK ("typeCode" ~ '^[EI][SN][TF][JP]$'),
 "bankVersion" TEXT NOT NULL, "dimensionCounts" JSONB, "lifeStage" TEXT, "recentStatus" TEXT,
 "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK (("source" = 'quiz' AND "sessionId" IS NOT NULL AND "dimensionCounts" IS NOT NULL) OR
        ("source" = 'self_select' AND "sessionId" IS NULL AND "dimensionCounts" IS NULL))
);
CREATE INDEX "MbtiResult_ownerId_submittedAt_id_idx" ON "MbtiResult"("ownerId", "submittedAt" DESC, "id" DESC);
-- Freeze published content and immutable snapshots, independently of HTTP handlers.
CREATE FUNCTION mbti_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'MBTI immutable record'; END $$;
CREATE TRIGGER mbti_bank_immutable BEFORE UPDATE OR DELETE ON "MbtiQuestionBank"
 FOR EACH ROW EXECUTE FUNCTION mbti_reject_update();
CREATE TRIGGER mbti_result_immutable BEFORE UPDATE ON "MbtiResult"
 FOR EACH ROW EXECUTE FUNCTION mbti_reject_update();
CREATE FUNCTION mbti_answer_open_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state TEXT;
BEGIN
 SELECT "status" INTO state FROM "MbtiQuizSession" WHERE "id" = COALESCE(NEW."sessionId", OLD."sessionId") FOR UPDATE;
 IF state IS DISTINCT FROM 'in_progress' THEN RAISE EXCEPTION 'MBTI session already submitted'; END IF;
 RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER mbti_answer_guard BEFORE INSERT OR UPDATE OR DELETE ON "MbtiAnswer"
 FOR EACH ROW EXECUTE FUNCTION mbti_answer_open_session();
CREATE FUNCTION mbti_session_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."ownerId" IS DISTINCT FROM NEW."ownerId" OR OLD."bankVersion" IS DISTINCT FROM NEW."bankVersion" OR
    OLD."status" = 'submitted' THEN RAISE EXCEPTION 'MBTI session is frozen'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER mbti_session_guard BEFORE UPDATE ON "MbtiQuizSession"
 FOR EACH ROW EXECUTE FUNCTION mbti_session_frozen();
