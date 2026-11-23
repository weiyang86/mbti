-- The configured catalog can expose the tier-2 product; its entitlement kind must be valid too.
ALTER TABLE "MbtiEntitlement" DROP CONSTRAINT "MbtiEntitlement_kind_check";
ALTER TABLE "MbtiEntitlement" ADD CONSTRAINT "MbtiEntitlement_kind_check"
  CHECK ("kind" IN ('studio_tier_1','studio_tier_2'));
