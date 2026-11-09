import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../database/connection.mjs";
import { createRuntimeFixture } from "./runtime-fixture.mjs";

const task = "AF-106";
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const hash = value => createHash("sha256").update(value).digest("hex");

test("AF-106 admin payment queries and manual refund requests use real PostgreSQL and protected loopback HTTP", { timeout: 360000 }, async t => {
  const fixture = await createRuntimeFixture(task, { enabledPlugins: ["aij-payment"], rbacFixture: true });
  t.after(async () => fixture.close());
  const { prisma, baseUrl } = fixture;
  const unique = randomUUID().replaceAll("-", "");
  const secrets = ["AF106_PROVIDER_REFERENCE_" + unique, "AF106_CREDENTIAL_REF_" + unique, "AF106_CALLBACK_EVENT_" + unique, "AF106_RAW_DIGEST_" + unique];
  secrets.push(hash(secrets[3]));
  const accounts = JSON.parse(readFileSync(fixture.rbacFixture.accounts[0].initialPasswordFile, "utf8")).accounts;
  const manager = accounts.find(account => account.username === "af106-payment-manager");
  const reader = accounts.find(account => account.username === "af106-payment-reader");
  assert.ok(manager && reader, "test fixture provides manager and read-only synthetic users");
  const managerToken = await fixture.login(manager.username, manager.password);
  const readerToken = await fixture.login(reader.username, reader.password);
  const project = await prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" } });
  await prisma.pluginInstallation.create({ data: {
    projectId: project.id, pluginCode: "aij-payment", version: "0.1.0", owner: "@aij/api", status: "enabled", installedAt: new Date(), enabledAt: new Date()
  } });

  const member = await prisma.memberUser.create({ data: {
    username: "af106-member-" + unique.slice(0, 16), email: `af106-${unique.slice(0, 16)}@example.test`, nickname: "AF-106 synthetic member"
  } });
  const workspace = await prisma.clientWorkspace.create({ data: {
    code: "af106-" + unique.slice(0, 24), name: "AF-106 synthetic workspace", createdByMemberId: member.id, creationIdempotencyKey: randomUUID()
  } });
  const role = await prisma.clientWorkspaceRole.create({ data: { workspaceId: workspace.id, code: "AF106_MEMBER", name: "AF-106 synthetic member role" } });
  await prisma.clientWorkspaceMembership.create({ data: { workspaceId: workspace.id, memberId: member.id, roleId: role.id } });

  async function createOrder({ projectId = project.id, status = "succeeded", amountMinor = 1000n, suffix = randomUUID() } = {}) {
    const providerReference = secrets[0] + "_" + suffix.replaceAll("-", "");
    const credentialReference = secrets[1] + "_" + suffix.replaceAll("-", "");
    secrets.push(providerReference, credentialReference);
    const order = await prisma.paymentOrder.create({ data: {
      projectId, workspaceId: workspace.id, memberId: member.id, orderNo: "AF106-" + suffix.replaceAll("-", "").slice(0, 24),
      payableOwner: "af106.synthetic", payableReference: "synthetic-charge-" + suffix,
      amountMinor, currency: "CNY", currencyExponent: 2,
      idempotencyKeyHash: hash("order-key:" + suffix), requestFingerprint: hash("order-fingerprint:" + suffix), status
    } });
    if (status !== "succeeded") return order;
    const attempt = await prisma.paymentAttempt.create({ data: {
      orderId: order.id, attemptNumber: 1, providerCode: "synthetic-offline", providerReference, credentialRef: credentialReference,
      status: "succeeded", submittedAt: new Date(), observedAt: new Date()
    } });
    const event = await prisma.paymentCallbackEvent.create({ data: {
      projectId, orderId: order.id, attemptId: attempt.id, providerCode: "synthetic-offline", eventId: secrets[2] + "_" + suffix.replaceAll("-", ""),
      payloadSha256: hash(secrets[3]), status: "accepted", processedAt: new Date()
    } });
    await prisma.paymentTransaction.create({ data: {
      orderId: order.id, attemptId: attempt.id, callbackEventId: event.id, providerCode: "synthetic-offline",
      providerReference, kind: "charge", amountMinor, currency: "CNY", occurredAt: new Date()
    } });
    return order;
  }

  const paidOrder = await createOrder();
  const pendingOrder = await createOrder({ status: "pending" });
  const foreignOrganization = await prisma.organizationProfile.create({ data: { code: "af106-org-" + unique.slice(0, 16), name: "AF-106 synthetic foreign organization" } });
  const foreignProject = await prisma.projectProfile.create({ data: {
    organizationId: foreignOrganization.id, code: "af106-project-" + unique.slice(0, 16), name: "AF-106 synthetic foreign project", environment: "test"
  } });
  const foreignOrder = await createOrder({ projectId: foreignProject.id });

  const request = async (path, { token, method = "GET", body, expected } = {}) => {
    const response = await fetch(baseUrl + path, {
      method,
      headers: { "x-correlation-id": "af106-real-http", ...(token ? { authorization: "Bearer " + token } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000)
    });
    const text = await response.text();
    for (const secret of secrets) assert.ok(!text.includes(secret), "API projection never exposes provider reference, credential reference, callback ID, or payload canary");
    assert.ok(Array.isArray(expected) ? expected.includes(response.status) : response.status === expected,
      `${method} ${path} returns expected HTTP status${Array.isArray(expected) ? ` (${expected.join(" or ")})` : ` (${expected})`}; received ${response.status}`);
    if (path.startsWith("/admin/payments/")) assert.equal(response.headers.get("cache-control"), "no-store");
    return { response, data: text ? JSON.parse(text)?.data : null, text };
  };

  await t.test("authentication, read permission, and separate refund permission are enforced server-side", async () => {
      await request("/admin/payments/orders", { expected: 401 });
      const page = await request("/admin/payments/orders?page=1&pageSize=10", { token: readerToken, expected: 200 });
      assert.ok(page.data.items.some(row => row.id === paidOrder.id));
      assert.ok(!page.text.includes("providerReference") && !page.text.includes("credentialRef") && !page.text.includes("payloadSha256") && !page.text.includes("eventId"));
      await request(`/admin/payments/orders/${paidOrder.id}/refund-requests`, { method: "POST", token: readerToken, body: { amountMinor: "100", reason: "synthetic review", idempotencyKey: "af106-reader-key-00000001" }, expected: 403 });
      assert.equal(await prisma.paymentRefundRequest.count(), 0, "read-only attempts never persist refund requests");
      await request("/admin/payments/orders?page=0", { token: readerToken, expected: 400 });
      await request("/admin/payments/orders?unexpected=1", { token: readerToken, expected: 400 });
  });

  await t.test("admin projections are paginated, project-scoped, sanitized, and keep detail lookup opaque", async () => {
      const page = await request("/admin/payments/orders?page=1&pageSize=1", { token: readerToken, expected: 200 });
      assert.equal(page.data.items.length, 1);
      assert.ok(page.data.total >= 2);
      const detail = await request(`/admin/payments/orders/${paidOrder.id}`, { token: readerToken, expected: 200 });
      assert.equal(detail.data.id, paidOrder.id);
      assert.equal(detail.data.currencyExponent, 2);
      assert.ok(!detail.text.includes(secrets[0]) && !detail.text.includes(secrets[1]) && !detail.text.includes(secrets[2]));
      await request(`/admin/payments/orders/${foreignOrder.id}`, { token: readerToken, expected: 404 });
      await request(`/admin/payments/orders/${foreignOrder.id}/refund-requests`, { method: "POST", token: managerToken, body: { amountMinor: "10", reason: "foreign project", idempotencyKey: "af106-foreign-key-00000001" }, expected: 404 });
      const ids = (await prisma.paymentOrder.findMany({ select: { id: true, projectId: true } }));
      assert.ok(ids.some(row => row.id === foreignOrder.id && row.projectId === foreignProject.id), "foreign synthetic order exists in database but is not projected into current project");
  });

  await t.test("manual refund request persists only a pending review record, is idempotent, and never creates refund transactions", async () => {
      const body = { amountMinor: "400", reason: "Synthetic AF-106 manual review", idempotencyKey: "af106-idem-key-0000000000001" };
      const created = await request(`/admin/payments/orders/${paidOrder.id}/refund-requests`, { method: "POST", token: managerToken, body, expected: 201 });
      assert.equal(created.data.status, "pending_manual_review");
      assert.equal(created.data.amountMinor, "400");
      assert.equal(created.data.currencyExponent, 2);
      const replay = await request(`/admin/payments/orders/${paidOrder.id}/refund-requests`, { method: "POST", token: managerToken, body, expected: 201 });
      assert.equal(replay.data.id, created.data.id, "same key and fingerprint return the existing request");
      await request(`/admin/payments/orders/${paidOrder.id}/refund-requests`, { method: "POST", token: managerToken, body: { ...body, amountMinor: "401" }, expected: 409 });
      await request(`/admin/payments/orders/${paidOrder.id}/refund-requests`, { method: "POST", token: managerToken, body: { ...body, idempotencyKey: "af106-over-key-00000000000001", amountMinor: "601" }, expected: 409 });
      const requests = await prisma.paymentRefundRequest.findMany({ where: { paymentOrderId: paidOrder.id } });
      assert.equal(requests.length, 1);
      assert.equal(requests[0].status, "pending_manual_review");
      assert.equal(requests[0].idempotencyKeyHash, hash(body.idempotencyKey));
      assert.notEqual(requests[0].idempotencyKeyHash, body.idempotencyKey, "raw idempotency key is not stored");
      assert.equal(await prisma.paymentTransaction.count({ where: { orderId: paidOrder.id, kind: { in: ["refund", "reversal"] } } }), 0, "request registration does not create a financial ledger fact");
      const audits = await prisma.auditLog.findMany({ where: { module: "aij-payment", action: "payment_refund_requested", resourceId: created.data.id } });
      assert.equal(audits.length, 1, "one idempotent request has one audit record");
      const auditText = JSON.stringify(audits);
      assert.ok(!auditText.includes(body.idempotencyKey) && !secrets.some(value => auditText.includes(value)));
      const listing = await request("/admin/payments/refund-requests?page=1&pageSize=20", { token: readerToken, expected: 200 });
      assert.ok(listing.data.items.some(row => row.id === created.data.id));
  });

  await t.test("invalid DTO, unpaid order, and concurrent over-reservation fail closed", async () => {
      await request(`/admin/payments/orders/${paidOrder.id}/refund-requests`, { method: "POST", token: managerToken, body: { amountMinor: "0", reason: "invalid", idempotencyKey: "af106-invalid-key-0000000001" }, expected: 400 });
      await request(`/admin/payments/orders/${paidOrder.id}/refund-requests`, { method: "POST", token: managerToken, body: { amountMinor: "1", reason: "invalid", idempotencyKey: "bad" }, expected: 400 });
      await request(`/admin/payments/orders/${pendingOrder.id}/refund-requests`, { method: "POST", token: managerToken, body: { amountMinor: "1", reason: "not settled", idempotencyKey: "af106-pending-key-0000000001" }, expected: 409 });
      const raceOrder = await createOrder({ amountMinor: 1000n });
      const race = await Promise.all(["af106-race-key-0000000001", "af106-race-key-0000000002"].map(idempotencyKey => request(`/admin/payments/orders/${raceOrder.id}/refund-requests`, { method: "POST", token: managerToken, body: { amountMinor: "700", reason: "concurrent synthetic request", idempotencyKey }, expected: [201, 409] })));
      assert.equal(race.filter(item => item.response.status === 201).length, 1, "order advisory lock permits only one request within remaining charge balance");
      assert.equal(await prisma.paymentRefundRequest.count({ where: { paymentOrderId: raceOrder.id } }), 1);
      const provider = fixture.app.get(require(join(repositoryRoot, "apps/api/dist/plugins/aij-payment/payment-provider.js")).PaymentProviderRegistry);
      assert.equal(provider.get("synthetic-test").calls.length, 0, "admin refund requests never call a payment Provider");
  });

  await t.test("disabling the plugin closes all admin payment endpoints", async () => {
      await prisma.pluginInstallation.update({ where: { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-payment" } }, data: { status: "installed", disabledAt: new Date() } });
      await request("/admin/payments/orders", { token: managerToken, expected: 404 });
      await request("/admin/payments/refund-requests", { token: readerToken, expected: 404 });
  });
});
