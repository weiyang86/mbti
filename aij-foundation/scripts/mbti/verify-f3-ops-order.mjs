// Verify a specific existing Web-created test order through Foundation Auth/RBAC HTTP.
// Does not create an order, initialize a payment, restart a service or print credentials.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fixturePath, root, testContext } from "./test-context.mjs";
const [id, expectedAmount] = process.argv.slice(2);
assert.match(id || "", /^MBTI-[a-f0-9-]{36}$/);
assert.match(expectedAmount || "", /^[1-9][0-9]*$/);
assert.equal(process.argv.length, 4, "Usage: node scripts/mbti/verify-f3-ops-order.mjs <business-order-id> <amount-fen>");
const { db } = await testContext();
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
assert.equal(fixture.root, root); assert.equal(fixture.environment, "test");
const base = "http://192.168.0.200:4156/api";
const receipts = [];
let checks = 0;
async function call(method, path, expected, headers = {}, body, authentication = "none", capture = true) {
  const response = await fetch(base + path, { method, signal: AbortSignal.timeout(5000), headers: {
    ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: HTTP ${response.status}`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  if (capture) receipts.push({ method, url: base + path, request_authentication: authentication, status: response.status,
    content_type: response.headers.get("content-type"), observed_at: new Date().toISOString(), body: data });
  checks++; return data;
}
async function login(kind) {
  const user = fixture.users.find(u => u.kind === kind);
  const account = (await db.query('SELECT is_super_admin FROM sys_user WHERE id=$1 AND status=\'active\' AND deleted_at IS NULL', [user.id])).rows[0];
  assert.equal(account?.is_super_admin, false);
  return (await call("POST", "/auth/login", 200, {}, { username: user.username, password: user.password }, "Foundation password login [REDACTED]", false)).data.accessToken;
}
try {
  const ops = await login("ops"), denied = await login("no_permission");
  const order = await call("GET", "/admin/mbti/orders/" + id, 200, { Authorization: "Bearer " + ops }, undefined, "Existing Foundation non-super-admin ops session [REDACTED]");
  assert.equal(order.id, id); assert.equal(order.amount, Number(expectedAmount)); assert.equal(order.currency, "CNY");
  assert.equal(order.status, "pending"); assert.equal(order.unlocked, false); assert.equal(order.payment_availability, "unconfigured");
  assert.ok(!("pay_params" in order) && !("paid_at" in order));
  await call("GET", "/admin/mbti/orders/" + id, 401);
  await call("GET", "/admin/mbti/orders/" + id, 403, { Authorization: "Bearer " + denied }, undefined, "Existing Foundation authenticated role without mbti:orders:read [REDACTED]");
  const guest = (await call("POST", "/v1/auth/guest", 201, {}, undefined, "none", false)).guest_token;
  await call("GET", "/admin/mbti/orders/" + id, 401, { "X-Guest-Token": guest }, undefined, "Separate synthetic ordinary guest [REDACTED]");
  await call("GET", "/admin/mbti/orders/" + id, 401, { Authorization: "Bearer " + guest }, undefined, "Ordinary guest supplied as Bearer [REDACTED]");
  await call("GET", "/v1/orders/" + id, 404, { "X-Guest-Token": guest }, undefined, "Separate synthetic ordinary guest [REDACTED]");
  const report = { source: "Real LAN HTTP against the existing Web-created controlled test order; no SQL order lookup", api_base: base,
    run_id: "run_594d408d15de", task_id: "task_5672a0c22747", dispatch_id: "ctx_570f21fa3109", web_order_id: id,
    web_reference: { commit: "cfb02d32c089dbf3680cbf210b5e89e8149068a5", path: "web/F3-INTEGRATION.md", section: "Real H5 acceptance", expected_amount: Number(expectedAmount), expected_currency: "CNY" }, checks, receipts };
  const serialized = JSON.stringify(report, null, 2) + "\n";
  for (const secret of [ops, denied, guest, fixture.jwtSecret, fixture.paymentSecret, ...fixture.users.map(u => u.password)]) assert.ok(!serialized.includes(secret));
  mkdirSync(resolve(root, ".artifacts"), { recursive: true, mode: 0o700 });
  writeFileSync(resolve(root, ".artifacts/mbti-f3-web-order-ops-http.json"), serialized, { mode: 0o600 });
  console.log(`PASS Web-order operations HTTP checks=${checks}; ${order.id} amount=${order.amount} ${order.currency} pending/unlocked=false/unconfigured; ops200/no-auth401/no-permission403/guest401/cross-guest404; credentials redacted`);
} finally { await db.end(); }
