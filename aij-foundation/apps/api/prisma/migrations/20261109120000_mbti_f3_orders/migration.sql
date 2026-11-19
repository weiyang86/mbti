-- Additive MBTI business snapshots; no changes to existing Foundation payment facts.
CREATE TABLE "MbtiOrder" (
  "id" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "resultId" TEXT NOT NULL,
  "productCode" TEXT NOT NULL, "amount" INTEGER NOT NULL CHECK ("amount" > 0),
  "currency" CHAR(3) NOT NULL CHECK ("currency" = 'CNY'),
  "pricingMode" TEXT NOT NULL DEFAULT 'controlled_test_fixture' CHECK ("pricingMode" = 'controlled_test_fixture'),
  "idempotencyKeyHash" CHAR(64) NOT NULL, "requestFingerprint" CHAR(64) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','paid','failed')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "paidAt" TIMESTAMP(3), "paymentOrderId" TEXT,
  CONSTRAINT "MbtiOrder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "MbtiGuest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "MbtiOrder_paymentOrderId_fkey" FOREIGN KEY ("paymentOrderId") REFERENCES payment_order(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (("status"='paid') = ("paidAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "MbtiOrder_ownerId_idempotencyKeyHash_key" ON "MbtiOrder"("ownerId","idempotencyKeyHash");
CREATE UNIQUE INDEX "MbtiOrder_paymentOrderId_key" ON "MbtiOrder"("paymentOrderId");
CREATE INDEX "MbtiOrder_ownerId_createdAt_id_idx" ON "MbtiOrder"("ownerId","createdAt" DESC,"id" DESC);
CREATE TABLE "MbtiEntitlement" (
  "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL UNIQUE, "kind" TEXT NOT NULL CHECK (kind='studio_tier_1'),
  "scope" TEXT NOT NULL DEFAULT 'controlled_test' CHECK (scope='controlled_test'),
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MbtiEntitlement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "MbtiOrder"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE FUNCTION mbti_f3_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'MBTI financial snapshots cannot be deleted'; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW."ownerId",NEW."resultId",NEW."productCode",NEW.amount,NEW.currency,NEW."pricingMode",NEW."idempotencyKeyHash",NEW."requestFingerprint",NEW."createdAt")
    IS DISTINCT FROM ROW(OLD.id,OLD."ownerId",OLD."resultId",OLD."productCode",OLD.amount,OLD.currency,OLD."pricingMode",OLD."idempotencyKeyHash",OLD."requestFingerprint",OLD."createdAt")
    THEN RAISE EXCEPTION 'MBTI order snapshot is immutable'; END IF;
  IF TG_OP='INSERT' AND (NEW.status<>'pending' OR NEW."paidAt" IS NOT NULL OR NEW."paymentOrderId" IS NOT NULL)
    THEN RAISE EXCEPTION 'MBTI order must begin pending'; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.status<>'pending' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW."paidAt" IS DISTINCT FROM OLD."paidAt")
      THEN RAISE EXCEPTION 'MBTI order terminal state is immutable'; END IF;
    IF OLD."paymentOrderId" IS NOT NULL AND NEW."paymentOrderId" IS DISTINCT FROM OLD."paymentOrderId"
      THEN RAISE EXCEPTION 'MBTI payment link is immutable'; END IF;
    IF NEW."paymentOrderId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM payment_order p WHERE p.id=NEW."paymentOrderId" AND p.payable_owner='mbti-controlled-test'
      AND p.payable_reference=NEW.id AND p.amount_minor=NEW.amount AND p.currency=NEW.currency)
      THEN RAISE EXCEPTION 'MBTI payment link snapshot mismatch'; END IF;
    IF NEW.status='paid' AND NOT EXISTS (
      SELECT 1 FROM payment_order p JOIN payment_transaction t ON t.order_id=p.id
      WHERE p.id=NEW."paymentOrderId" AND p.status='succeeded' AND t.kind='charge'
      AND t.amount_minor=NEW.amount AND t.currency=NEW.currency)
      THEN RAISE EXCEPTION 'MBTI paid state requires verified Foundation charge'; END IF;
    IF NEW.status='failed' AND NOT EXISTS (SELECT 1 FROM payment_order WHERE id=NEW."paymentOrderId" AND status='failed')
      THEN RAISE EXCEPTION 'MBTI failed state requires verified Foundation state'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mbti_f3_order_guard BEFORE INSERT OR UPDATE OR DELETE ON "MbtiOrder" FOR EACH ROW EXECUTE FUNCTION mbti_f3_order_guard();
CREATE FUNCTION mbti_f3_entitlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'MBTI entitlement fact is immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "MbtiOrder" WHERE id=NEW."orderId" AND status='paid' AND "productCode"=NEW.kind)
    THEN RAISE EXCEPTION 'MBTI entitlement requires verified paid order'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER mbti_f3_entitlement_guard BEFORE INSERT OR UPDATE OR DELETE ON "MbtiEntitlement" FOR EACH ROW EXECUTE FUNCTION mbti_f3_entitlement_guard();
-- Permission catalog only; no production user/role/credential is created or granted here.
INSERT INTO sys_permission (id,permission_code,permission_name,resource_type,module,action,api_path,status,updated_at)
VALUES ('mbti-order-read','mbti:orders:read','MBTI订单只读','api','mbti','read','/api/admin/mbti/orders/:id','active',CURRENT_TIMESTAMP)
ON CONFLICT (permission_code) DO NOTHING;
