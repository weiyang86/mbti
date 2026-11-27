-- Add the refunded terminal state to the MBTI controlled-test order projection.
-- Refund still requires a previously paid order; the fake-provider ledger stays the only charge fact.
ALTER TABLE "MbtiOrder" DROP CONSTRAINT "MbtiOrder_status_check";
ALTER TABLE "MbtiOrder" ADD CONSTRAINT "MbtiOrder_status_check"
  CHECK ("status" IN ('pending','paid','failed','refunded'));

ALTER TABLE "MbtiOrder" DROP CONSTRAINT "MbtiOrder_check";
ALTER TABLE "MbtiOrder" ADD CONSTRAINT "MbtiOrder_paid_at_check"
  CHECK (("status" IN ('paid','refunded')) = ("paidAt" IS NOT NULL));

CREATE OR REPLACE FUNCTION mbti_f3_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'MBTI financial snapshots cannot be deleted'; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW."ownerId",NEW."resultId",NEW."productCode",NEW.amount,NEW.currency,NEW."pricingMode",NEW."idempotencyKeyHash",NEW."requestFingerprint",NEW."createdAt")
    IS DISTINCT FROM ROW(OLD.id,OLD."ownerId",OLD."resultId",OLD."productCode",OLD.amount,OLD.currency,OLD."pricingMode",OLD."idempotencyKeyHash",OLD."requestFingerprint",OLD."createdAt")
    THEN RAISE EXCEPTION 'MBTI order snapshot is immutable'; END IF;
  IF TG_OP='INSERT' AND (NEW.status<>'pending' OR NEW."paidAt" IS NOT NULL OR NEW."paymentOrderId" IS NOT NULL)
    THEN RAISE EXCEPTION 'MBTI order must begin pending'; END IF;
  IF TG_OP='UPDATE' THEN
    -- Terminal states are immutable; the only allowed terminal transition is paid -> refunded.
    IF OLD.status<>'pending' AND NEW.status IS DISTINCT FROM OLD.status
      AND NOT (OLD.status='paid' AND NEW.status='refunded')
      THEN RAISE EXCEPTION 'MBTI order terminal state is immutable'; END IF;
    IF OLD.status<>'pending' AND NEW."paidAt" IS DISTINCT FROM OLD."paidAt"
      THEN RAISE EXCEPTION 'MBTI paid timestamp is immutable'; END IF;
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
    -- A pending order that never obtained a payment link may be closed as failed.
    IF NEW.status='failed' AND NEW."paymentOrderId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM payment_order WHERE id=NEW."paymentOrderId" AND status='failed')
      THEN RAISE EXCEPTION 'MBTI failed state requires verified Foundation state'; END IF;
    IF NEW.status='refunded' AND OLD.status<>'paid'
      THEN RAISE EXCEPTION 'MBTI refund requires a paid order'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mbti_f3_entitlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Refund is the only path that removes a granted entitlement.
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM "MbtiOrder" WHERE id=OLD."orderId" AND status='refunded') THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'MBTI entitlement fact is immutable';
  END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'MBTI entitlement fact is immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "MbtiOrder" WHERE id=NEW."orderId" AND status='paid' AND "productCode"=NEW.kind)
    THEN RAISE EXCEPTION 'MBTI entitlement requires verified paid order'; END IF;
  RETURN NEW;
END $$;
