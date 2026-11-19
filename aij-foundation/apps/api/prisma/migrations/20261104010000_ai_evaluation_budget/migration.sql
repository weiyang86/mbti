CREATE TABLE "ai_evaluation_budget_run" (
 "id" TEXT PRIMARY KEY, "project_id" TEXT NOT NULL, "run_key" TEXT NOT NULL,
 "policy_hash" CHAR(64) NOT NULL, "used_nanos" BIGINT NOT NULL DEFAULT 0 CHECK ("used_nanos" BETWEEN 0 AND 10000000000),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("project_id", "run_key")
);
CREATE TABLE "ai_evaluation_budget_reservation" (
 "id" TEXT PRIMARY KEY, "run_id" TEXT NOT NULL REFERENCES "ai_evaluation_budget_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "reserved_nanos" BIGINT NOT NULL CHECK ("reserved_nanos" > 0),
 "charged_nanos" BIGINT NOT NULL CHECK ("charged_nanos" >= 0 AND "charged_nanos" <= "reserved_nanos"),
 "status" TEXT NOT NULL DEFAULT 'reserved' CHECK ("status" IN ('reserved', 'settled')),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "settled_at" TIMESTAMP(3)
);
CREATE INDEX "ai_evaluation_budget_reservation_run_id_status_idx" ON "ai_evaluation_budget_reservation"("run_id", "status");
