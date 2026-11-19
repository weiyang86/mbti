import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("payment admin route is permission-gated and the page only consumes safe read/manual-request APIs", () => {
  const route = readFileSync("apps/web/app/auth/payments/page.tsx", "utf8");
  const consumer = readFileSync("apps/web/app/components/admin-payments.tsx", "utf8");
  assert.match(route, /<AdminShell\s+permission="admin\.payment\.read">/);
  assert.match(consumer, /useAdmin\(\)/);
  for (const path of ["/admin/payments/orders", "/admin/payments/refund-requests", "/refund-requests"]) assert.ok(consumer.includes(path), `consumer calls ${path}`);
  assert.match(consumer, /admin\.payment\.refund\.request/);
  assert.match(consumer, /pending_manual_review/);
  assert.match(consumer, /不会向 Provider 发起退款/);
  assert.doesNotMatch(consumer, /credentialRef|providerReference|payloadSha256|callbackEventId|signature|rawPayload/i, "UI projection does not consume provider credentials, event payload, or signatures");
  assert.doesNotMatch(consumer, /\/provider|\/refunds\/execute|\/capture/,
    "the UI has no Provider execution or real-money command endpoint");
});
