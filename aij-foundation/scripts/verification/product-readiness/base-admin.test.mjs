import assert from "node:assert/strict";
import test from "node:test";
import { verifyBaseAdmin } from "./base-admin.mjs";

// Live HTTP / strict Base DB preflight: coordinator only, after isolated rebuild.
test("AF-130 reusable Base reader: repeated API preparation, read-only access, direct write denials, relogin and targeted audit", { timeout: 240000 }, async () => {
  const evidence = await verifyBaseAdmin();
  assert.equal(evidence.completed, true);
  assert.equal(evidence.repeatPrepare.sameCredentials, true);
  assert.equal(evidence.denials.unchangedAfterEach, true);
  assert.equal(evidence.relogin.logoutRevokedPriorSession, true);
  assert.equal(evidence.audit.allDtoRejectionsAudited, false);
  assert.equal(evidence.browserObservation, "PENDING_COORDINATOR");
});
