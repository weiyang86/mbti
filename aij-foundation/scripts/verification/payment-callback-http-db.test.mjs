import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { clientEnvironment, prepareClientFixture } from "./client-auth-fixture.mjs";

const task = "AF-105";
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const requireApi = file => require(join(repositoryRoot, "apps/api/dist", file));
const syntheticCredential = "synthetic-only-no-provider-secret";

test("payment callbacks are signed, project-scoped, replay-safe, transactional and audited against real PostgreSQL/HTTP", { timeout: 300000 }, async t => {
  const lease = await createAcceptance("test", task);
  const deployed = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  assert.equal(deployed.exitCode, 0, "fresh AF-105-owned acceptance DB applies all local migrations");
  const status = await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
  assert.equal(status.exitCode, 0, "the acceptance DB migration ledger is up to date");
  const fixture = await prepareClientFixture(lease.id, task);
  const accounts = JSON.parse(readFileSync(fixture.accounts[0].initialPasswordFile, "utf8")).accounts;
  const [ownerAccount, readerAccount] = accounts;
  const environment = clientEnvironment(lease.id, task);
  const original = { ...process.env };
  const replaceEnvironment = values => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, values);
  };
  let app;

  try {
    replaceEnvironment({ ...environment, ENABLED_PLUGINS: "aij-payment" });
    const { createApplication } = requireApi("bootstrap.js");
    const { PrismaService } = requireApi("prisma/prisma.service.js");
    const { PaymentProviderRegistry } = requireApi("plugins/aij-payment/payment-provider.js");
    const { PAYMENT_CREDENTIAL_RESOLVER } = requireApi("plugins/aij-payment/payment-payable-source.js");
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0, "Nest API listens on an OS-selected loopback port");
    const base = `http://127.0.0.1:${address.port}/api`;
    const prisma = app.get(PrismaService);
    assert.equal((await prisma.readiness()).ready, true, "Prisma reports the isolated AF-105 database ready");
    const providerRows = await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN ('payment_callback_event','payment_transaction')`;
    const indexNames = new Set(providerRows.map(row => row.indexname));
    for (const name of ["payment_callback_project_provider_event_key", "payment_transaction_callback_event_key", "payment_transaction_provider_reference_kind_key"]) {
      assert.ok(indexNames.has(name), `actual PostgreSQL unique index exists: ${name}`);
    }
    const checks = await prisma.$queryRaw`SELECT conname FROM pg_constraint WHERE conname IN ('payment_callback_event_identity_check','payment_callback_event_digest_check','payment_callback_event_processed_check','payment_transaction_amount_positive','payment_transaction_currency_check')`;
    assert.equal(checks.length, 5, "actual PostgreSQL has callback identity/digest/finalization and transaction amount/currency checks");
    const fks = await prisma.$queryRaw`SELECT conname, confdeltype::text AS delete_behavior FROM pg_constraint WHERE conname IN ('payment_callback_event_project_fkey','payment_callback_event_order_fkey','payment_callback_event_attempt_fkey','payment_transaction_order_fkey','payment_transaction_attempt_fkey','payment_transaction_callback_event_fkey')`;
    assert.equal(fks.length, 6, "actual PostgreSQL callback/transaction owner foreign keys exist");
    assert.ok(fks.every(row => row.delete_behavior === "r"), "ledger facts prevent destructive owner deletes");

    await prisma.clientWorkspacePermission.createMany({ data: [
      { code: "workspace.context.read", name: "Workspace context read" },
      { code: "workspace.payment.create", name: "Workspace payment create" },
      { code: "workspace.payment.read", name: "Workspace payment read" }
    ], skipDuplicates: true });
    const permissions = await prisma.clientWorkspacePermission.findMany({ where: { code: { in: ["workspace.context.read", "workspace.payment.create", "workspace.payment.read"] } } });
    const permissionByCode = new Map(permissions.map(row => [row.code, row]));
    assert.equal(permissionByCode.size, 3);
    const workspace = await prisma.clientWorkspace.create({ data: {
      code: "af105-" + randomUUID().replaceAll("-", "").slice(0, 24), name: "AF-105 synthetic workspace",
      createdByMemberId: ownerAccount.id, creationIdempotencyKey: randomUUID()
    } });
    const ownerRole = await prisma.clientWorkspaceRole.create({ data: { workspaceId: workspace.id, code: "AF105_OWNER", name: "AF-105 payment owner" } });
    const readerRole = await prisma.clientWorkspaceRole.create({ data: { workspaceId: workspace.id, code: "AF105_READER", name: "AF-105 payment reader" } });
    await prisma.clientWorkspaceRolePermission.createMany({ data: [
      { roleId: ownerRole.id, permissionId: permissionByCode.get("workspace.context.read").id },
      { roleId: ownerRole.id, permissionId: permissionByCode.get("workspace.payment.create").id },
      { roleId: ownerRole.id, permissionId: permissionByCode.get("workspace.payment.read").id },
      { roleId: readerRole.id, permissionId: permissionByCode.get("workspace.context.read").id }
    ] });
    await prisma.clientWorkspaceMembership.createMany({ data: [
      { workspaceId: workspace.id, memberId: ownerAccount.id, roleId: ownerRole.id },
      { workspaceId: workspace.id, memberId: readerAccount.id, roleId: readerRole.id }
    ] });
    const project = await prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" } });
    await prisma.pluginInstallation.create({ data: {
      projectId: project.id, pluginCode: "aij-payment", version: "0.1.0", owner: "@aij/api", status: "enabled",
      installedAt: new Date(), enabledAt: new Date()
    } });

    const login = async account => {
      const response = await fetch(base + "/client/auth/login", {
        method: "POST", headers: { connection: "close", origin: environment.WEB_URL, "content-type": "application/json" },
        body: JSON.stringify({ email: account.email, password: account.password }), signal: AbortSignal.timeout(10000)
      });
      assert.equal(response.status, 200, "synthetic client login uses the isolated DB");
      return response.headers.get("set-cookie").split(";")[0];
    };
    const ownerCookie = await login(ownerAccount);
    const readerCookie = await login(readerAccount);
    const createOrder = async (cookie, idempotencyKey) => {
      const response = await fetch(base + "/client/payments/orders", {
        method: "POST", headers: { connection: "close", origin: environment.WEB_URL, cookie, "x-aij-workspace-id": workspace.id, "content-type": "application/json" },
        body: JSON.stringify({ payableReference: "synthetic-plan-fee", idempotencyKey }), signal: AbortSignal.timeout(10000)
      });
      const text = await response.text();
      assert.equal(response.status, 201, "authorized synthetic order is created before callback");
      assert.ok(!text.includes(syntheticCredential));
      return JSON.parse(text).data;
    };
    const firstOrder = await createOrder(ownerCookie, "af105-order-" + randomUUID().replaceAll("-", ""));
    const firstAttempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { orderId: firstOrder.id } });
    assert.equal(firstAttempt.credentialRef, "test-only:payment-fixture", "only the SecretRef is persisted for callback resolution");
    const provider = app.get(PaymentProviderRegistry).get("synthetic-test");
    assert.equal(provider.calls.length, 1, "synthetic fixture adapter only; no external Provider call");

    const signAndSend = async ({ projectCode = "aij-foundation-test", providerCode = "synthetic-test", payload, timestampSeconds = Math.floor(Date.now() / 1000), badSignature = false, extraRaw = false }) => {
      const rawBody = Buffer.from(JSON.stringify(payload));
      const timestamp = String(timestampSeconds);
      const digest = createHmac("sha256", syntheticCredential).update(Buffer.concat([
        Buffer.from(`v1\n${projectCode}\n${providerCode}\n${timestamp}\n${payload.eventId}\n`, "utf8"), rawBody
      ])).digest("hex");
      const response = await fetch(`${base}/payments/callbacks/${projectCode}/${providerCode}`, {
        method: "POST", headers: { connection: "close", "content-type": "application/json", "x-aij-payment-timestamp": timestamp,
          "x-aij-payment-event-id": payload.eventId, "x-aij-payment-signature": "v1=" + (badSignature ? "0".repeat(64) : digest),
          ...(extraRaw ? { "x-aij-test-marker": "should-not-be-persisted" } : {}) },
        body: rawBody, signal: AbortSignal.timeout(10000)
      });
      const text = await response.text();
      assert.ok(!text.includes(syntheticCredential) && !text.includes("v1="), "callback response does not disclose secret or signature");
      return { status: response.status, text };
    };
    const event = (order, attempt, status, eventId, overrides = {}) => ({
      eventId, orderNo: order.orderNo, providerReference: attempt.providerReference, status,
      amountMinor: "2599", currency: "CNY", occurredAt: new Date().toISOString(), ...overrides
    });

    await t.test("unauthenticated workspace member cannot create payable order", async () => {
      const response = await fetch(base + "/client/payments/orders", { method: "POST", headers: {
        connection: "close", origin: environment.WEB_URL, cookie: readerCookie, "x-aij-workspace-id": workspace.id, "content-type": "application/json"
      }, body: JSON.stringify({ payableReference: "synthetic-plan-fee", idempotencyKey: "af105-reader-" + randomUUID().replaceAll("-", "") }) });
      assert.equal(response.status, 403, "reader is denied before an order exists");
    });

    await t.test("valid signature with forged amount is durably rejected and audited without a transaction", async () => {
      const bad = event(firstOrder, firstAttempt, "succeeded", "af105-amount-mismatch-0001", { amountMinor: "1" });
      assert.equal((await signAndSend({ payload: bad })).status, 409);
      const receipt = await prisma.paymentCallbackEvent.findFirstOrThrow({ where: { eventId: bad.eventId } });
      assert.equal(receipt.status, "rejected");
      assert.equal(receipt.failureCode, "amount_mismatch");
      assert.equal(await prisma.paymentTransaction.count({ where: { orderId: firstOrder.id } }), 0);
      assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: firstOrder.id } })).status, "pending");
    });

    const successful = event(firstOrder, firstAttempt, "succeeded", "af105-success-" + randomUUID().replaceAll("-", ""));
    await t.test("valid callback atomically advances order/attempt, appends charge fact and sanitized audit", async () => {
      const accepted = await signAndSend({ payload: successful });
      assert.equal(accepted.status, 200);
      assert.deepEqual(JSON.parse(accepted.text).data, { accepted: true });
      assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: firstOrder.id } })).status, "succeeded");
      assert.equal((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: firstAttempt.id } })).status, "succeeded");
      const transaction = await prisma.paymentTransaction.findFirstOrThrow({ where: { orderId: firstOrder.id } });
      assert.equal(transaction.kind, "charge");
      assert.equal(transaction.amountMinor, 2599n);
      assert.equal(transaction.currency, "CNY");
      assert.equal((await prisma.paymentCallbackEvent.findUniqueOrThrow({ where: { projectId_providerCode_eventId: { projectId: project.id, providerCode: "synthetic-test", eventId: successful.eventId } } })).status, "accepted");
      const audit = await prisma.auditLog.findMany({ where: { module: "aij-payment", action: "payment_callback_accepted", resourceId: firstOrder.id } });
      assert.equal(audit.length, 1);
      const stringifyDatabaseValue = value => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
      const auditSerialized = stringifyDatabaseValue(audit);
      for (const secret of [syntheticCredential, "test-only:payment-fixture", successful.providerReference, JSON.stringify(successful)]) {
        assert.ok(!auditSerialized.includes(secret), "audit excludes credential, SecretRef, provider reference and raw payload");
      }
      assert.ok(!stringifyDatabaseValue(transaction).includes(syntheticCredential), "transaction fact excludes credential values");
    });

    await t.test("credential rotation during signature verification is durably rejected and audited", async () => {
      const order = await createOrder(ownerCookie, "af105-rotation-race-" + randomUUID().replaceAll("-", ""));
      const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { orderId: order.id } });
      const payload = event(order, attempt, "pending", "af105-rotation-race-" + randomUUID().replaceAll("-", ""));
      const resolver = app.get(PAYMENT_CREDENTIAL_RESOLVER);
      const previousResolve = resolver.resolve;
      const resolveWithRotation = previousResolve.bind(resolver);
      resolver.resolve = async reference => {
        if (reference === attempt.credentialRef) {
          await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { credentialRef: "test-only:rotated-payment-fixture" } });
        }
        return resolveWithRotation(reference);
      };
      try {
        assert.equal((await signAndSend({ payload })).status, 409);
        const receipt = await prisma.paymentCallbackEvent.findUniqueOrThrow({
          where: { projectId_providerCode_eventId: { projectId: project.id, providerCode: "synthetic-test", eventId: payload.eventId } }
        });
        assert.equal(receipt.status, "rejected");
        assert.equal(receipt.failureCode, "state_conflict");
        assert.equal(await prisma.auditLog.count({ where: { module: "aij-payment", action: "payment_callback_rejected", resourceId: order.id } }), 1);
        assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: order.id } })).status, "pending");
      } finally {
        resolver.resolve = previousResolve;
        await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { credentialRef: attempt.credentialRef } });
      }
    });

    await t.test("same event is rejected as replay; no duplicate transaction or receipt is created", async () => {
      assert.equal((await signAndSend({ payload: successful })).status, 409);
      assert.equal(await prisma.paymentCallbackEvent.count({ where: { eventId: successful.eventId } }), 1);
      assert.equal(await prisma.paymentTransaction.count({ where: { orderId: firstOrder.id } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { module: "aij-payment", action: "payment_callback_replay_rejected", resourceId: firstOrder.id } }), 1);
    });

    await t.test("bad signature, expired timestamp, extra provider fields and cross-project order references are rejected", async () => {
      const before = await prisma.paymentCallbackEvent.count();
      const badSignaturePayload = event(firstOrder, firstAttempt, "pending", "af105-bad-signature-0001");
      assert.equal((await signAndSend({ payload: badSignaturePayload, badSignature: true })).status, 401);
      const expiredPayload = event(firstOrder, firstAttempt, "pending", "af105-expired-time-0001");
      assert.equal((await signAndSend({ payload: expiredPayload, timestampSeconds: Math.floor(Date.now() / 1000) - 301 })).status, 401);
      const withExtra = { ...event(firstOrder, firstAttempt, "pending", "af105-extra-field-0001"), privateField: "must-not-persist" };
      assert.equal((await signAndSend({ payload: withExtra })).status, 400);
      const foreignProject = await prisma.projectProfile.create({ data: { organizationId: project.organizationId,
        code: "af105-foreign-" + randomUUID().replaceAll("-", "").slice(0, 20), name: "AF-105 foreign synthetic project", environment: "test" } });
      const crossProject = event(firstOrder, firstAttempt, "pending", "af105-cross-project-0001");
      assert.equal((await signAndSend({ projectCode: foreignProject.code, payload: crossProject })).status, 404);
      assert.equal(await prisma.paymentCallbackEvent.count(), before, "unauthenticated/malformed/cross-project callbacks create no receipts");
      assert.equal(await prisma.paymentTransaction.count({ where: { orderId: firstOrder.id } }), 1);
    });

    await t.test("a failed callback is terminal and later success is rejected with audit", async () => {
      const second = await createOrder(ownerCookie, "af105-order-" + randomUUID().replaceAll("-", ""));
      const attempt = await prisma.paymentAttempt.findFirstOrThrow({ where: { orderId: second.id } });
      const failed = event(second, attempt, "failed", "af105-failed-" + randomUUID().replaceAll("-", ""));
      assert.equal((await signAndSend({ payload: failed })).status, 200);
      assert.equal((await prisma.paymentOrder.findUniqueOrThrow({ where: { id: second.id } })).status, "failed");
      const late = event(second, attempt, "succeeded", "af105-late-success-" + randomUUID().replaceAll("-", ""));
      assert.equal((await signAndSend({ payload: late })).status, 409);
      assert.equal(await prisma.paymentTransaction.count({ where: { orderId: second.id } }), 0);
      assert.equal((await prisma.paymentCallbackEvent.findFirstOrThrow({ where: { eventId: late.eventId } })).failureCode, "state_conflict");
    });
  } finally {
    if (app) await app.close();
    replaceEnvironment(original);
  }
});
