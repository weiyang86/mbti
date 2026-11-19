import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRuntimeFixture } from "./runtime-fixture.mjs";

const stringifyDatabaseValue = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);

test("AF-107 reconciles normalized synthetic traces in isolated PostgreSQL and loopback HTTP without changing payment truth", { timeout: 360000 }, async t => {
  const fixture = await createRuntimeFixture("AF-107", { enabledPlugins: ["aij-payment"], rbacFixture: true });
  t.after(async () => fixture.close());
  const { prisma } = fixture;
  const accounts = fixture.rbacFixture.accounts;
  const manager = accounts.find(account => account.username === "af107-reconciliation-manager");
  const reader = accounts.find(account => account.username === "af107-payment-reader");
  assert.ok(manager && reader, "fixture registers separate reconciliation manager and payment-only reader");
  const managerToken = await fixture.login(manager.username, JSON.parse(readFileSync(manager.initialPasswordFile, "utf8")).accounts.find(row => row.username === manager.username).password);
  const readerToken = await fixture.login(reader.username, JSON.parse(readFileSync(reader.initialPasswordFile, "utf8")).accounts.find(row => row.username === reader.username).password);
  const project = await fixture.prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" } });
  const managerUser = await prisma.sysUser.findUniqueOrThrow({ where: { username: manager.username }, select: { id: true } });
  await fixture.prisma.pluginInstallation.create({ data: {
    projectId: project.id, pluginCode: "aij-payment", version: "0.1.0", owner: "@aij/api", status: "enabled", installedAt: new Date(), enabledAt: new Date()
  } });

  const unique = randomUUID().replaceAll("-", "");
  const member = await fixture.prisma.memberUser.create({ data: {
    username: "af107-member-" + unique.slice(0, 16), email: `af107-${unique.slice(0, 16)}@example.test`, nickname: "AF-107 synthetic member"
  } });
  const workspace = await fixture.prisma.clientWorkspace.create({ data: {
    code: "af107-" + unique.slice(0, 24), name: "AF-107 synthetic workspace", createdByMemberId: member.id, creationIdempotencyKey: randomUUID()
  } });
  const role = await fixture.prisma.clientWorkspaceRole.create({ data: { workspaceId: workspace.id, code: "AF107_MEMBER", name: "AF-107 synthetic member role" } });
  await fixture.prisma.clientWorkspaceMembership.create({ data: { workspaceId: workspace.id, memberId: member.id, roleId: role.id } });

  async function createCharge({ projectId = project.id, amountMinor = 1200n, suffix = randomUUID() } = {}) {
    const id = suffix.replaceAll("-", "");
    const providerReference = "AF107_PROVIDER_" + id;
    const order = await fixture.prisma.paymentOrder.create({ data: {
      projectId, workspaceId: workspace.id, memberId: member.id, orderNo: "AF107-" + id.slice(0, 18),
      payableOwner: "af107.synthetic", payableReference: "synthetic-charge-" + id,
      amountMinor, currency: "CNY", currencyExponent: 2,
      idempotencyKeyHash: randomUUID().replaceAll("-", "").padEnd(64, "a").slice(0, 64),
      requestFingerprint: randomUUID().replaceAll("-", "").padEnd(64, "b").slice(0, 64), status: "succeeded"
    } });
    const attempt = await fixture.prisma.paymentAttempt.create({ data: {
      orderId: order.id, attemptNumber: 1, providerCode: "synthetic-offline", providerReference, credentialRef: "test-only:payment-fixture",
      status: "succeeded", submittedAt: new Date(), observedAt: new Date()
    } });
    const event = await fixture.prisma.paymentCallbackEvent.create({ data: {
      projectId, orderId: order.id, attemptId: attempt.id, providerCode: "synthetic-offline", eventId: "AF107_EVENT_" + id,
      payloadSha256: randomUUID().replaceAll("-", "").padEnd(64, "c").slice(0, 64), status: "accepted", processedAt: new Date()
    } });
    const transaction = await fixture.prisma.paymentTransaction.create({ data: {
      orderId: order.id, attemptId: attempt.id, callbackEventId: event.id, providerCode: "synthetic-offline",
      providerReference, kind: "charge", amountMinor, currency: "CNY", occurredAt: new Date()
    } });
    return { order, attempt, transaction, providerReference };
  }

  const matched = await createCharge();
  const amountMismatch = await createCharge();
  const currencyMismatch = await createCharge();
  const statusMismatch = await createCharge();
  const orderMismatch = await createCharge();
  const missingProvider = await createCharge();
  const foreignOrganization = await fixture.prisma.organizationProfile.create({ data: { code: "af107-org-" + unique.slice(0, 16), name: "AF-107 foreign synthetic organization" } });
  const foreignProject = await fixture.prisma.projectProfile.create({ data: {
    organizationId: foreignOrganization.id, code: "af107-project-" + unique.slice(0, 16), name: "AF-107 foreign synthetic project", environment: "test"
  } });
  const foreign = await createCharge({ projectId: foreignProject.id });
  const rawReferenceCanaries = new Set([matched, amountMismatch, currencyMismatch, statusMismatch, orderMismatch, missingProvider, foreign].map(row => row.providerReference));

  const request = async (path, { token, method = "GET", body, expected } = {}) => {
    const response = await fetch(fixture.baseUrl + path, {
      method,
      headers: { "x-correlation-id": "af107-reconciliation-http", ...(token ? { authorization: "Bearer " + token } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10000)
    });
    const text = await response.text();
    for (const secret of rawReferenceCanaries) assert.ok(!text.includes(secret), "raw provider references never appear in responses");
    assert.equal(response.status, expected, `${method} ${path} returns HTTP ${expected}, received ${response.status}`);
    if (path.startsWith("/admin/payments/reconciliations")) assert.equal(response.headers.get("cache-control"), "no-store");
    return { response, text, data: text ? JSON.parse(text).data : null };
  };

  const windowStart = new Date(Date.now() - 60_000).toISOString();
  const windowEnd = new Date(Date.now() + 60_000).toISOString();
  const record = (charge, changes = {}) => ({ providerReference: charge.providerReference, orderNo: charge.order.orderNo,
    amountMinor: charge.order.amountMinor.toString(), currency: "CNY", status: "succeeded", occurredAt: new Date().toISOString(), ...changes });
  const duplicateReference = "AF107_DUPLICATE_" + unique;
  const missingLocalReference = "AF107_NO_LOCAL_" + unique;
  const statement = [
    record(matched),
    record(amountMismatch, { amountMinor: "999" }),
    record(currencyMismatch, { currency: "USD" }),
    record(statusMismatch, { status: "failed" }),
    record(orderMismatch, { orderNo: "AF107-WRONG-ORDER" }),
    record(foreign),
    { providerReference: missingLocalReference, orderNo: "AF107-ORPHAN-" + unique.slice(0, 16), amountMinor: "50", currency: "CNY", status: "succeeded", occurredAt: new Date().toISOString() },
    { providerReference: duplicateReference, orderNo: "AF107-DUP-" + unique.slice(0, 16), amountMinor: "70", currency: "CNY", status: "succeeded", occurredAt: new Date().toISOString() },
    { providerReference: duplicateReference, orderNo: "AF107-DUP-" + unique.slice(0, 16), amountMinor: "70", currency: "CNY", status: "succeeded", occurredAt: new Date().toISOString() }
  ];
  const before = {
    orders: await prisma.paymentOrder.findMany({ where: { projectId: project.id }, select: { id: true, status: true } }),
    attempts: await prisma.paymentAttempt.findMany({ where: { order: { projectId: project.id } }, select: { id: true, status: true } }),
    transactions: await prisma.paymentTransaction.findMany({ where: { order: { projectId: project.id } }, select: { id: true, kind: true, amountMinor: true } })
  };

  await t.test("RBAC denies anonymous/payment-only readers; malformed windows and payloads fail closed", async () => {
    await request("/admin/payments/reconciliations", { expected: 401 });
    await request("/admin/payments/reconciliations", { token: readerToken, expected: 403 });
    await request("/admin/payments/reconciliations", { method: "POST", token: readerToken, body: {
      providerCode: "synthetic-offline", windowStart, windowEnd, idempotencyKey: "af107-reader-key-00001", records: []
    }, expected: 403 });
    await request("/admin/payments/reconciliations", { method: "POST", token: managerToken, body: {
      providerCode: "synthetic-offline", windowStart: windowEnd, windowEnd: windowStart, idempotencyKey: "af107-invalid-window-0001", records: []
    }, expected: 400 });
    await request("/admin/payments/reconciliations", { method: "POST", token: managerToken, body: {
      providerCode: "synthetic-offline", windowStart, windowEnd, idempotencyKey: "af107-extra-field-00001", unexpected: true, records: []
    }, expected: 400 });
    await request("/admin/payments/reconciliations", { method: "POST", token: managerToken, body: {
      providerCode: "synthetic-offline", windowStart, windowEnd, idempotencyKey: "af107-outside-window-01", records: [
        { providerReference: "AF107_OUTSIDE_WINDOW_01", orderNo: "AF107-OLD", amountMinor: "50", currency: "CNY", status: "succeeded", occurredAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }
      ]
    }, expected: 400 });
    assert.equal(await fixture.prisma.paymentReconciliationRun.count(), 0, "unauthorized or invalid attempts do not persist runs");
  });

  let created;
  await t.test("real loopback HTTP and PostgreSQL persist matched, missing, duplicate, amount, status, and order discrepancies", async () => {
    const result = await request("/admin/payments/reconciliations", { method: "POST", token: managerToken, body: {
      providerCode: "synthetic-offline", windowStart, windowEnd, idempotencyKey: "af107-recon-key-00000001", records: statement
    }, expected: 201 });
    created = result.data;
    assert.equal(created.sourceRecordCount, statement.length);
    assert.equal(created.matchedCount, 1);
    const types = created.discrepancies.map(item => item.type);
    assert.ok(types.includes("missing_local"));
    assert.ok(types.includes("missing_provider"));
    assert.equal(types.filter(type => type === "duplicate_provider").length, 2);
    assert.ok(types.includes("amount_mismatch"));
    assert.ok(types.includes("currency_mismatch"));
    assert.ok(types.includes("status_mismatch"));
    assert.ok(types.includes("order_mismatch"));
    assert.equal(created.discrepancyCount, types.length);
    const stored = await fixture.prisma.paymentReconciliationRun.findUniqueOrThrow({ where: { id: created.id }, include: { items: true } });
    assert.equal(stored.items.length, created.discrepancyCount, "discrepancy evidence is actually persisted");
    assert.ok(stored.items.every(item => [...rawReferenceCanaries, duplicateReference].every(secret => !stringifyDatabaseValue(item).includes(secret))), "database retains hashes and normalized fields, not raw provider references");
    const responseText = result.text;
    assert.ok(!responseText.includes("providerReferenceHash") && !responseText.includes("sourceRecordHash"), "hash internals are not part of the admin projection");
    const audits = await fixture.prisma.auditLog.findMany({ where: { module: "aij-payment", action: "payment_reconciliation_run_created", resourceId: created.id } });
    assert.equal(audits.length, 1);
    assert.ok([...rawReferenceCanaries, duplicateReference].every(secret => !stringifyDatabaseValue(audits).includes(secret)));
  });

  await t.test("same idempotency fingerprint replays; changed statement conflicts; project scope hides foreign runs", async () => {
    const replay = await request("/admin/payments/reconciliations", { method: "POST", token: managerToken, body: {
      providerCode: "synthetic-offline", windowStart, windowEnd, idempotencyKey: "af107-recon-key-00000001", records: statement
    }, expected: 201 });
    assert.equal(replay.data.id, created.id, "request replay does not make a duplicate reconciliation run");
    await request("/admin/payments/reconciliations", { method: "POST", token: managerToken, body: {
      providerCode: "synthetic-offline", windowStart, windowEnd, idempotencyKey: "af107-recon-key-00000001", records: statement.slice(0, 1)
    }, expected: 409 });
    const foreignRun = await fixture.prisma.paymentReconciliationRun.create({ data: {
      projectId: foreignProject.id, providerCode: "synthetic-offline", windowStart: new Date(windowStart), windowEnd: new Date(windowEnd),
      sourceRecordCount: 0, matchedCount: 0, discrepancyCount: 0,
      idempotencyKeyHash: "a".repeat(64), requestFingerprint: "b".repeat(64), createdByUserId: managerUser.id
    } });
    await request(`/admin/payments/reconciliations/${foreignRun.id}`, { token: managerToken, expected: 404 });
    const list = await request("/admin/payments/reconciliations?page=1&pageSize=10&reviewState=open", { token: managerToken, expected: 200 });
    assert.ok(list.data.items.some(item => item.id === created.id));
    assert.ok(!list.data.items.some(item => item.id === foreignRun.id));
  });

  await t.test("manual discrepancy disposition is separately authorized, audited, single-use, and never changes ledger facts", async () => {
    const open = created.discrepancies.find(item => item.type === "amount_mismatch");
    assert.ok(open);
    await request(`/admin/payments/reconciliations/${created.id}/discrepancies/${open.id}/review`, { method: "PATCH", token: readerToken, body: { decision: "acknowledged" }, expected: 403 });
    const reviewed = await request(`/admin/payments/reconciliations/${created.id}/discrepancies/${open.id}/review`, { method: "PATCH", token: managerToken, body: { decision: "escalated" }, expected: 200 });
    assert.equal(reviewed.data.reviewState, "escalated");
    assert.equal(reviewed.data.reviewer.username, manager.username);
    await request(`/admin/payments/reconciliations/${created.id}/discrepancies/${open.id}/review`, { method: "PATCH", token: managerToken, body: { decision: "acknowledged" }, expected: 409 });
    const after = {
      orders: await prisma.paymentOrder.findMany({ where: { projectId: project.id }, select: { id: true, status: true } }),
      attempts: await prisma.paymentAttempt.findMany({ where: { order: { projectId: project.id } }, select: { id: true, status: true } }),
      transactions: await prisma.paymentTransaction.findMany({ where: { order: { projectId: project.id } }, select: { id: true, kind: true, amountMinor: true } })
    };
    assert.deepEqual(after, before, "run and review do not mutate settled order, attempt, or immutable transaction facts");
    const reviewAudits = await fixture.prisma.auditLog.findMany({ where: { module: "aij-payment", action: "payment_reconciliation_discrepancy_reviewed", resourceId: open.id } });
    assert.equal(reviewAudits.length, 1);
    assert.ok([...rawReferenceCanaries, duplicateReference].every(secret => !stringifyDatabaseValue(reviewAudits).includes(secret)));
  });

  await t.test("GET projection returns the persisted queue without hashes or raw provider data", async () => {
    const detail = await request(`/admin/payments/reconciliations/${created.id}`, { token: managerToken, expected: 200 });
    assert.equal(detail.data.discrepancyCount, created.discrepancyCount);
    assert.ok(detail.data.discrepancies.some(item => item.reviewState === "escalated"));
    assert.ok(!detail.text.includes("providerReference") && !detail.text.includes("providerReferenceHash") && !detail.text.includes("sourceRecordHash"));
  });
});
