// Real HTTP acceptance against the owned project test DB. Only creates synthetic fixture records.
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { root, fixturePath, testContext } from "./test-context.mjs";
const { db } = await testContext();
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
assert.equal(fixture.root, root);
const base = "http://127.0.0.1:4156/api";
const statePath = resolve(root, ".artifacts/mbti-f3-restart.json");
const evidencePath = resolve(root, ".artifacts/mbti-f3-http-evidence.json");
const mode = process.argv[2] || "verify";
assert.ok(["verify", "prepare-restart", "verify-restart"].includes(mode));
let checks = 0;
const evidence = [];
async function call(method, path, expected, token, body, headers = {}, record = false) {
  const response = await fetch(base + path, { method, headers: { ...(token ? { "X-Guest-Token": token } : {}),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(), data = text ? JSON.parse(text) : null;
  assert.ok([expected].flat().includes(response.status), `${method} ${path}: expected ${expected}, received ${response.status} ${text}`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  if (path.startsWith("/v1/") && response.status >= 400) { assert.equal(typeof data.code, "string"); assert.equal(typeof data.message, "string"); }
  if (record) evidence.push({ method, path, request_authentication: token ? "X-Guest-Token: [REDACTED synthetic guest]" : headers.Authorization ? "Authorization: [REDACTED Foundation session]" : headers["x-aij-payment-signature"] ? "HMAC signature/timestamp/event-id: [REDACTED]" : "none",
    status: response.status, content_type: response.headers.get("content-type"), body: data });
  checks++; return { status: response.status, data };
}
async function login(kind) {
  const user = fixture.users.find(u => u.kind === kind);
  return (await call("POST", "/auth/login", 200, undefined, { username: user.username, password: user.password })).data.data.accessToken;
}
const bearer = token => ({ Authorization: "Bearer " + token });
const guest = async () => (await call("POST", "/v1/auth/guest", 201)).data.guest_token;
const result = async token => (await call("POST", "/v1/results", 201, token, { source: "self_select", type_code: "INFP" })).data;
const newKey = () => "f3_" + randomBytes(20).toString("hex");
const create = async (token, resultId, key = newKey(), expected = 201, code = "studio_tier_1", extra = {}, record = false) =>
  call("POST", "/v1/orders", expected, token, { result_id: resultId, product_code: code, ...extra }, { "Idempotency-Key": key }, record);
async function signed(payload, expected, signatureOverride, timestampOverride, record = false) {
  const raw = JSON.stringify(payload), timestamp = timestampOverride ?? String(Math.floor(Date.now() / 1000));
  const bytes = Buffer.concat([Buffer.from("v1\nmbti-foundation-test\nsynthetic-test\n" + timestamp + "\n" + payload.eventId + "\n"), Buffer.from(raw)]);
  const signature = signatureOverride ?? "v1=" + createHmac("sha256", fixture.paymentSecret).update(bytes).digest("hex");
  const result = await call("POST", "/v1/payments/controlled-test/callback", expected, undefined, payload,
    { "x-aij-payment-timestamp": timestamp, "x-aij-payment-event-id": payload.eventId, "x-aij-payment-signature": signature }, record);
  if (record) evidence.at(-1).request_summary = { orderNo: payload.orderNo, amountMinor: payload.amountMinor, currency: payload.currency, status: payload.status };
  return result;
}
try {
  if (mode === "verify-restart") {
    const s = JSON.parse(readFileSync(statePath, "utf8"));
    const ops = await login("ops");
    assert.deepEqual((await call("GET", "/v1/orders/" + s.pending.id, 200, s.a)).data,
      { order_id: s.pending.id, status: "pending", unlocked: false, payment_availability: "unconfigured" });
    assert.deepEqual((await create(s.a, s.pending.result_id, s.key)).data, s.pending);
    await call("GET", "/v1/results/" + s.pending.result_id, 404, s.a);
    assert.deepEqual((await call("GET", "/admin/mbti/orders/" + s.pending.id, 200, undefined, undefined, bearer(ops))).data, s.pending);
    assert.equal((await call("GET", "/v1/orders/" + s.paidId, 200, s.a)).data.unlocked, true);
    assert.deepEqual((await call("GET", "/v1/entitlements/me", 200, s.a)).data, s.entitlements);
    await call("GET", "/v1/orders/" + s.pending.id, 404, s.b);
    await call("GET", "/v1/orders/" + s.paidId, 404, s.b);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "MbtiOrder" WHERE "ownerId"=$1 AND "idempotencyKeyHash"=encode(sha256($2::bytea),\'hex\')', [s.ownerId, s.key])).rows[0].n, 1);
    console.log(`PASS F3 restart checks=${checks}: pending business number, deleted-result reference, original key replay, ops same amount, verified entitlement and cross-guest 404 survived`);
  } else {
    const a = await guest(), b = await guest();
    const ops = await login("ops"), denied = await login("no_permission"), tester = await login("payment_tester");
    for (const [method, path] of [["GET", "/v1/products"], ["POST", "/v1/orders"], ["GET", "/v1/orders"], ["GET", "/v1/orders/missing"], ["GET", "/v1/entitlements/me"]]) {
      await call(method, path, 401); await call(method, path, 401, "invalid-token");
    }
    const products = (await call("GET", "/v1/products", 200, a, undefined, {}, true)).data;
    assert.deepEqual(products.items.map(p => [p.code, p.amount, p.currency, p.saleable, p.pricing_mode]),
      [["studio_tier_1", 990, "CNY", true, "controlled_test_fixture"], ["studio_tier_2", 1990, "CNY", false, "controlled_test_fixture"]]);
    assert.deepEqual((await call("GET", "/v1/orders", 200, a)).data, { items: [], next_cursor: null });
    assert.deepEqual((await call("GET", "/v1/entitlements/me", 200, a, undefined, {}, true)).data, { items: [] });
    const r = await result(a), other = await result(a), rb = await result(b), key = newKey();
    await create(b, r.id, newKey(), 404, "studio_tier_1", {}, true);
    await create(a, rb.id, newKey(), 404);
    await create(a, "missing", newKey(), 404);
    await create(a, r.id, newKey(), 409, "studio_tier_2", {}, true);
    await create(a, r.id, newKey(), 409, "not-a-product");
    for (const invalid of [undefined, "short", " ".repeat(20), "x".repeat(129)]) {
      await call("POST", "/v1/orders", 422, a, { result_id: r.id, product_code: "studio_tier_1" }, invalid ? { "Idempotency-Key": invalid } : {});
    }
    for (const injected of [{ amount: 1 }, { currency: "USD" }, { status: "paid" }, { unlocked: true }, { ownerId: "other" }, { paid_at: new Date().toISOString() }]) await create(a, r.id, newKey(), 422, "studio_tier_1", injected);
    const order = (await create(a, r.id, key, 201, "studio_tier_1", {}, true)).data;
    assert.match(order.id, /^MBTI-[a-f0-9-]{36}$/); assert.equal(order.amount, 990); assert.equal(order.currency, "CNY");
    assert.equal(order.status, "pending"); assert.equal(order.unlocked, false); assert.equal(order.payment_availability, "unconfigured");
    assert.ok(!("pay_params" in order) && !("paid_at" in order));
    assert.deepEqual((await create(a, r.id, key)).data, order);
    const same = await Promise.all(Array.from({ length: 6 }, () => create(a, r.id, key)));
    assert.ok(same.every(v => v.data.id === order.id));
    const freshKey = newKey();
    const raced = await Promise.all(Array.from({ length: 6 }, () => create(a, r.id, freshKey)));
    assert.equal(new Set(raced.map(v => v.data.id)).size, 1);
    const collisionKey = newKey();
    const collided = await Promise.all([create(a, r.id, collisionKey, [201, 409]), create(a, other.id, collisionKey, [201, 409])]);
    assert.deepEqual(collided.map(v => v.status).sort(), [201, 409]);
    await create(a, other.id, key, 409, "studio_tier_1", {}, true);
    await create(a, r.id, key, 409, "studio_tier_2");
    assert.notEqual((await create(b, rb.id, key)).data.id, order.id); // key scope is per guest.
    await call("GET", "/v1/orders/" + order.id, 404, b, undefined, {}, true);
    await call("GET", "/v1/orders/missing", 404, a);
    const status = (await call("GET", "/v1/orders/" + order.id, 200, a, undefined, {}, true)).data;
    assert.deepEqual(status, { order_id: order.id, status: "pending", unlocked: false, payment_availability: "unconfigured" });
    await call("GET", "/admin/mbti/orders/" + order.id, 401, undefined, undefined, {}, true);
    await call("GET", "/admin/mbti/orders/" + order.id, 401, a, undefined, {}, true);
    await call("GET", "/admin/mbti/orders/" + order.id, 401, undefined, undefined, bearer(a));
    await call("GET", "/admin/mbti/orders/" + order.id, 403, undefined, undefined, bearer(denied), true);
    const opOrder = (await call("GET", "/admin/mbti/orders/" + order.id, 200, undefined, undefined, bearer(ops), true)).data;
    assert.deepEqual(opOrder, order); // two independent HTTP receipts share durable number AND frozen amount.
    await call("GET", "/admin/mbti/orders/missing", 404, undefined, undefined, bearer(ops));
    // Current DB permissions remain authoritative even for an already-issued session.
    const role = (await db.query('SELECT id FROM sys_role WHERE role_code=$1', ["mbti-f3-ops"])).rows[0];
    try { await db.query('UPDATE sys_role SET status=$1 WHERE id=$2', ["disabled", role.id]);
      await call("GET", "/admin/mbti/orders/" + order.id, 403, undefined, undefined, bearer(ops));
    } finally { await db.query('UPDATE sys_role SET status=$1 WHERE id=$2', ["active", role.id]); }
    const page = (await call("GET", "/v1/orders?limit=1", 200, a)).data;
    assert.equal(page.items.length, 1); assert.equal(typeof page.next_cursor, "string");
    const next = (await call("GET", "/v1/orders?limit=1&cursor=" + page.next_cursor, 200, a)).data;
    assert.notEqual(page.items[0].id, next.items[0].id);
    await call("GET", "/v1/orders?cursor=" + page.next_cursor, 422, b);
    for (const query of ["limit=0", "limit=101", "limit=abc", "limit=1&limit=2", "cursor=bad"]) await call("GET", "/v1/orders?" + query, 422, a);
    for (const origin of ["http://127.0.0.1:4155", "http://192.168.0.200:4155", "http://unapproved.invalid"]) {
      const response = await fetch(base + "/v1/orders", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-guest-token,idempotency-key" } });
      assert.equal(response.status, 204); assert.equal(response.headers.get("access-control-allow-origin"), origin.includes("unapproved") ? null : origin);
      if (!origin.includes("unapproved")) assert.match(response.headers.get("access-control-allow-headers"), /idempotency-key/i);
      evidence.push({ method: "OPTIONS", path: "/api/v1/orders", origin, status: response.status, allow_origin: response.headers.get("access-control-allow-origin"), allow_headers: response.headers.get("access-control-allow-headers") }); checks++;
    }
    // F2 may delete the result, but financial references and safe retries must survive.
    await call("DELETE", "/v1/results/" + r.id, 204, a);
    await call("GET", "/v1/results/" + r.id, 404, a);
    assert.deepEqual((await create(a, r.id, key)).data, order);
    assert.deepEqual((await call("GET", "/admin/mbti/orders/" + order.id, 200, undefined, undefined, bearer(ops))).data, order);
    await create(a, r.id, newKey(), 404);
    const ownerId = (await db.query('SELECT "ownerId" FROM "MbtiOrder" WHERE id=$1', [order.id])).rows[0].ownerId;
    for (const query of ['UPDATE "MbtiOrder" SET amount=1 WHERE id=$1', 'UPDATE "MbtiOrder" SET status=\'paid\',"paidAt"=now() WHERE id=$1', 'DELETE FROM "MbtiOrder" WHERE id=$1']) await assert.rejects(db.query(query, [order.id]));
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "MbtiOrder" WHERE "ownerId"=$1 AND "idempotencyKeyHash"=encode(sha256($2::bytea),\'hex\')', [ownerId, key])).rows[0].n, 1);
    assert.deepEqual((await call("GET", "/v1/entitlements/me", 200, a)).data, { items: [] });
    // Only explicit payment-tester role can initialize the offline Foundation adapter.
    const paid = (await create(a, other.id)).data;
    await call("POST", "/admin/mbti/test-payments/" + paid.id, 401, a, {});
    await call("POST", "/admin/mbti/test-payments/" + paid.id, 403, undefined, {}, bearer(ops));
    await call("POST", "/admin/mbti/test-payments/" + paid.id, 403, undefined, {}, bearer(denied));
    const prepared = (await call("POST", "/admin/mbti/test-payments/" + paid.id, 200, undefined, {}, bearer(tester))).data;
    assert.equal(prepared.order.payment_availability, "controlled_test"); assert.equal(prepared.order.unlocked, false);
    const callback = { eventId: "f3-event-" + randomBytes(16).toString("hex"), orderNo: prepared.callback.orderNo,
      providerReference: prepared.callback.providerReference, status: "succeeded", amountMinor: "990", currency: "CNY", occurredAt: new Date().toISOString() };
    await signed(callback, 401, "v1=" + "0".repeat(64), undefined, true);
    await signed(callback, 401, undefined, String(Math.floor(Date.now() / 1000) - 600));
    await signed({ ...callback, orderNo: "wrong-order" }, 404);
    await signed({ ...callback, amountMinor: "989" }, 409, undefined, undefined, true);
    await signed({ ...callback, eventId: "f3-currency-" + randomBytes(16).toString("hex"), currency: "USD" }, 409, undefined, undefined, true);
    assert.equal((await call("GET", "/v1/orders/" + paid.id, 200, a)).data.status, "pending");
    assert.deepEqual((await call("GET", "/v1/entitlements/me", 200, a)).data, { items: [] });
    // The rejected amount event cannot later be reused with altered bytes.
    await signed(callback, 409);
    const accepted = { ...callback, eventId: "f3-valid-" + randomBytes(16).toString("hex") };
    const callbacks = await Promise.all(Array.from({ length: 5 }, () => signed(accepted, [200, 409], undefined, undefined, true)));
    assert.equal(callbacks.filter(v => v.status === 200).length, 1);
    assert.equal(callbacks.filter(v => v.status === 409).length, 4);
    await signed(accepted, 409, undefined, undefined, true);
    const paidStatus = (await call("GET", "/v1/orders/" + paid.id, 200, a, undefined, {}, true)).data;
    assert.equal(paidStatus.status, "paid"); assert.equal(paidStatus.unlocked, true); assert.ok(paidStatus.paid_at);
    await call("GET", "/v1/orders/" + paid.id, 404, b);
    const entitlements = (await call("GET", "/v1/entitlements/me", 200, a, undefined, {}, true)).data;
    assert.equal(entitlements.items.length, 1); assert.equal(entitlements.items[0].order_id, paid.id); assert.equal(entitlements.items[0].scope, "controlled_test");
    assert.deepEqual((await call("GET", "/v1/entitlements/me", 200, b)).data, { items: [] });
    const stored = (await db.query('SELECT "paymentOrderId" FROM "MbtiOrder" WHERE id=$1', [paid.id])).rows[0];
    assert.equal((await db.query('SELECT count(*)::int AS n FROM payment_transaction WHERE order_id=$1', [stored.paymentOrderId])).rows[0].n, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "MbtiEntitlement" WHERE "orderId"=$1', [paid.id])).rows[0].n, 1);
    await call("DELETE", "/v1/results/" + other.id, 204, a);
    assert.deepEqual((await call("GET", "/v1/entitlements/me", 200, a)).data, entitlements);
    // Terminal failure is a real verified adapter fact, never a client status update.
    const failedResult = await result(a), failedOrder = (await create(a, failedResult.id)).data;
    const failSetup = (await call("POST", "/admin/mbti/test-payments/" + failedOrder.id, 200, undefined, {}, bearer(tester))).data;
    const failure = { ...callback, eventId: "f3-failed-" + randomBytes(16).toString("hex"), orderNo: failSetup.callback.orderNo,
      providerReference: failSetup.callback.providerReference, status: "failed" };
    await signed(failure, 200, undefined, undefined, true);
    const failedStatus = (await call("GET", "/v1/orders/" + failedOrder.id, 200, a, undefined, {}, true)).data;
    assert.equal(failedStatus.status, "failed"); assert.equal(failedStatus.unlocked, false); assert.ok(!("paid_at" in failedStatus));
    await signed({ ...failure, eventId: "f3-reverse-failed-" + randomBytes(16).toString("hex"), status: "succeeded" }, 409);
    await signed({ ...accepted, eventId: "f3-reverse-paid-" + randomBytes(16).toString("hex"), status: "failed" }, 409);
    assert.deepEqual((await call("GET", "/v1/entitlements/me", 200, a)).data, entitlements);
    const expired = await guest();
    await db.query(`UPDATE "MbtiGuest" SET "expiresAt"=now()-interval '1 minute' WHERE "tokenHash"=encode(sha256($1::bytea),'hex')`, [expired]);
    for (const path of ["/v1/products", "/v1/orders", "/v1/orders/" + order.id, "/v1/entitlements/me"]) await call("GET", path, 401, expired);
    const lan = await fetch("http://192.168.0.200:4156/api/v1/orders/" + order.id, { headers: { "X-Guest-Token": a } });
    assert.equal(lan.status, 200); assert.equal((await lan.json()).order_id, order.id); checks++;
    if (mode === "prepare-restart") writeFileSync(statePath, JSON.stringify({ a, b, ownerId, key, pending: order, paidId: paid.id, entitlements }), { mode: 0o600 });
    mkdirSync(resolve(root, ".artifacts"), { recursive: true, mode: 0o700 });
    writeFileSync(evidencePath, JSON.stringify({ source: "Real HTTP; synthetic project test identities only; no real provider charging", evidence }, null, 2) + "\n", { mode: 0o600 });
    console.log(`PASS F3 checks=${checks}: real orders/status/ops/entitlements, same-number ${order.id} amount=${order.amount} ${order.currency}; intent replay and concurrent uniqueness, 401/403/404/409/422, CORS, deleted-result retention, Foundation signed callback 200+4x409, exact one charge and entitlement; real provider blocked_external`);
  }
} finally { await db.end(); }
