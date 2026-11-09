import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { repositoryRoot } from "../database/connection.mjs";
import { clientEnvironment, prepareClientFixture } from "./client-auth-fixture.mjs";

const task = "AF-104";
const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const requireApi = file => require(join(repositoryRoot, "apps/api/dist", file));

test("payment request is real HTTP/PostgreSQL, workspace-scoped, server-priced, and idempotent without live payment", { timeout: 240000 }, async t => {
  const lease = await createAcceptance("test", task);
  const deployed = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  assert.equal(deployed.exitCode, 0, "a fresh AF-104-owned logical database applies the local migration chain");
  const status = await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
  assert.equal(status.exitCode, 0, "the isolated database migration ledger is up to date");
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
    app = await createApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address === "object" && address.port > 0, "API uses an OS-selected loopback port");
    const base = `http://127.0.0.1:${address.port}/api`;
    const prisma = app.get(PrismaService);
    assert.equal((await prisma.readiness()).ready, true, "Prisma reports the isolated task DB ready");
    const indexRows = await prisma.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('payment_order', 'payment_attempt')`;
    const indexNames = new Set(indexRows.map(row => row.indexname));
    for (const name of ["payment_order_scope_idempotency_key", "payment_attempt_order_number_key", "payment_attempt_provider_reference_key"]) {
      assert.ok(indexNames.has(name), `actual migrated PostgreSQL index exists: ${name}`);
    }
    const foreignKeys = await prisma.$queryRaw`SELECT conname, confdeltype::text AS delete_behavior FROM pg_constraint WHERE conname IN ('payment_order_project_fkey', 'payment_order_workspace_member_fkey', 'payment_attempt_order_fkey')`;
    assert.equal(foreignKeys.length, 3, "actual migration has project, membership and order foreign keys");
    assert.ok(foreignKeys.every(row => row.delete_behavior === "r"), "payment rows prevent deleting their owning project, membership and order");
    const checks = await prisma.$queryRaw`SELECT conname FROM pg_constraint WHERE conname IN ('payment_order_amount_positive', 'payment_order_currency_exponent_range', 'payment_attempt_number_positive')`;
    assert.equal(checks.length, 3, "actual migration enforces positive amount/attempt and supported currency exponent");

    const permissionRows = await prisma.clientWorkspacePermission.createMany({ data: [
      { code: "workspace.context.read", name: "Workspace context read" },
      { code: "workspace.payment.create", name: "Workspace payment create" },
      { code: "workspace.payment.read", name: "Workspace payment read" }
    ], skipDuplicates: true });
    assert.ok(permissionRows.count >= 0);
    const permissions = await prisma.clientWorkspacePermission.findMany({ where: { code: { in: ["workspace.context.read", "workspace.payment.create", "workspace.payment.read"] } } });
    const permissionByCode = new Map(permissions.map(row => [row.code, row]));
    assert.equal(permissionByCode.size, 3, "all server permission codes are in the fixture catalog");
    assert.ok(permissions.every(row => row.status === "active" && row.deletedAt === null));

    const workspace = await prisma.clientWorkspace.create({ data: {
      code: "af104-" + randomUUID().replaceAll("-", "").slice(0, 24), name: "AF-104 synthetic workspace",
      createdByMemberId: ownerAccount.id, creationIdempotencyKey: randomUUID()
    } });
    const ownerRole = await prisma.clientWorkspaceRole.create({ data: { workspaceId: workspace.id, code: "AF104_OWNER", name: "AF-104 synthetic payment owner" } });
    const readerRole = await prisma.clientWorkspaceRole.create({ data: { workspaceId: workspace.id, code: "AF104_READER", name: "AF-104 context-only reader" } });
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
    const foreignWorkspace = await prisma.clientWorkspace.create({ data: {
      code: "af104-" + randomUUID().replaceAll("-", "").slice(0, 24), name: "AF-104 foreign synthetic workspace",
      createdByMemberId: readerAccount.id, creationIdempotencyKey: randomUUID()
    } });
    const foreignRole = await prisma.clientWorkspaceRole.create({ data: { workspaceId: foreignWorkspace.id, code: "AF104_FOREIGN", name: "AF-104 foreign role" } });
    await prisma.clientWorkspaceMembership.create({ data: { workspaceId: foreignWorkspace.id, memberId: readerAccount.id, roleId: foreignRole.id } });

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
      assert.equal(response.status, 200, "synthetic client login succeeds against the task DB");
      const cookie = response.headers.get("set-cookie");
      assert.ok(cookie?.includes("HttpOnly") && cookie.includes("SameSite=Strict"));
      return cookie.split(";")[0];
    };
    const ownerCookie = await login(ownerAccount);
    const readerCookie = await login(readerAccount);
    const orderCount = () => prisma.paymentOrder.count({ where: { workspaceId: workspace.id } });
    const idemA = "af104-idem-" + randomUUID().replaceAll("-", "");
    const idemB = "af104-failure-" + randomUUID().replaceAll("-", "");
    const secrets = [idemA, idemB, "synthetic-only-no-provider-secret", "synthetic provider timeout detail"];

    const request = async (path, { cookie, workspaceId = workspace.id, method = "GET", body, origin, expected } = {}) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          connection: "close",
          ...(cookie ? { cookie } : {}),
          ...(workspaceId ? { "x-aij-workspace-id": workspaceId } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(origin !== undefined ? { origin } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10000)
      });
      const text = await response.text();
      for (const secret of secrets) assert.ok(!text.includes(secret), "response omits raw idempotency and provider error values");
      assert.equal(response.status, expected, "HTTP status for " + path.split("?")[0]);
      const data = text ? JSON.parse(text) : null;
      return { response, data };
    };

    await t.test("anonymous, missing workspace, untrusted identity and unauthorized role are rejected", async () => {
      await request("/client/payments/orders", { method: "POST", body: { payableReference: "synthetic-plan-fee", idempotencyKey: idemA }, origin: environment.WEB_URL, expected: 401 });
      await request("/client/payments/orders", { cookie: ownerCookie, workspaceId: null, method: "POST", body: { payableReference: "synthetic-plan-fee", idempotencyKey: idemA }, origin: environment.WEB_URL, expected: 400 });
      await request("/client/payments/orders", { cookie: readerCookie, method: "POST", body: { payableReference: "synthetic-plan-fee", idempotencyKey: idemA }, origin: environment.WEB_URL, expected: 403 });
      await request("/client/payments/orders", { cookie: readerCookie, method: "POST", body: { payableReference: "synthetic-plan-fee", idempotencyKey: idemA }, workspaceId: foreignWorkspace.id, origin: environment.WEB_URL, expected: 403 });
      assert.equal(await orderCount(), 0, "rejected identity and permission paths create no ledger rows");
    });

    await t.test("DTO rejects client-owned amount, currency, provider and workspace identity; cross-site write is denied", async () => {
      for (const extra of [
        { amountMinor: "1" }, { currency: "USD" }, { currencyExponent: 0 }, { providerCode: "synthetic-test" },
        { workspaceId: foreignWorkspace.id }, { memberId: readerAccount.id }, { projectId: "forged" }
      ]) await request("/client/payments/orders", {
        cookie: ownerCookie, method: "POST", body: { payableReference: "synthetic-plan-fee", idempotencyKey: idemA, ...extra },
        origin: environment.WEB_URL, expected: 400
      });
      await request("/client/payments/orders", { cookie: ownerCookie, method: "POST", body: { payableReference: "synthetic-plan-fee", idempotencyKey: idemA }, origin: "https://outside.invalid", expected: 403 });
      await request("/client/payments/orders", { cookie: ownerCookie, method: "POST", body: { payableReference: "synthetic-plan-fee", idempotencyKey: "bad" }, origin: environment.WEB_URL, expected: 400 });
      assert.equal(await orderCount(), 0, "invalid payloads and origins do not reach the provider or persist an order");
    });

    let orderId;
    await t.test("trusted payable source owns the price, create is idempotent under concurrent retries, and status is workspace/member scoped", async () => {
      const payload = { payableReference: "synthetic-plan-fee", idempotencyKey: idemA };
      const created = await request("/client/payments/orders", { cookie: ownerCookie, method: "POST", body: payload, origin: environment.WEB_URL, expected: 201 });
      assert.equal(created.data.data.amountMinor, "2599");
      assert.equal(created.data.data.currency, "CNY");
      assert.equal(created.data.data.currencyExponent, 2);
      assert.equal(created.data.data.status, "pending");
      assert.equal(created.data.data.latestAttempt.status, "pending");
      orderId = created.data.data.id;
      const registry = app.get(PaymentProviderRegistry);
      const provider = registry.get("synthetic-test");
      assert.equal(provider.calls.length, 1, "first request dispatches one offline provider create call");
      const retries = await Promise.all(Array.from({ length: 3 }, () => request("/client/payments/orders", {
        cookie: ownerCookie, method: "POST", body: payload, origin: environment.WEB_URL, expected: 201
      })));
      assert.ok(retries.every(result => result.data.data.id === orderId), "concurrent same-key calls return the same order");
      assert.equal(await orderCount(), 1, "database unique scope contains exactly one order");
      assert.equal(provider.calls.length, 1, "idempotent replays do not redispatch provider creation");
      assert.ok(provider.calls[0].idempotencyKey === created.data.data.orderNo, "provider receives only a server-generated stable key");
      assert.ok(!JSON.stringify(provider.calls[0]).includes(idemA));

      const read = await request("/client/payments/orders/" + orderId, { cookie: ownerCookie, expected: 200 });
      assert.equal(read.data.data.id, orderId);
      assert.equal(read.data.data.amountMinor, "2599");
      await request("/client/payments/orders/" + orderId, { cookie: readerCookie, expected: 403 });
      await request("/client/payments/orders/" + orderId, { cookie: ownerCookie, workspaceId: foreignWorkspace.id, expected: 403 });
      const stored = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId }, include: { attempts: true } });
      assert.equal(stored.amountMinor, 2599n);
      assert.equal(stored.idempotencyKeyHash, createHash("sha256").update(idemA).digest("hex"));
      assert.ok(stored.attempts.length === 1);
      assert.ok(!JSON.stringify(stored, (_key, value) => typeof value === "bigint" ? value.toString() : value).includes(idemA));
    });

    await t.test("same key cannot silently switch payable snapshot and unknown payable is rejected", async () => {
      await request("/client/payments/orders", {
        cookie: ownerCookie, method: "POST", body: { payableReference: "synthetic-other-fee", idempotencyKey: idemA },
        origin: environment.WEB_URL, expected: 409
      });
      await request("/client/payments/orders", {
        cookie: ownerCookie, method: "POST", body: { payableReference: "not-owned-by-any-business", idempotencyKey: "af104-invalid-" + randomUUID().replaceAll("-", "") },
        origin: environment.WEB_URL, expected: 404
      });
      assert.equal(await orderCount(), 1, "changed payable fingerprint and unknown reference do not add rows");
    });

    await t.test("provider timeout is sanitized and keeps an ambiguous payment pending for G18-03 reconciliation", async () => {
      const provider = app.get(PaymentProviderRegistry).get("synthetic-test");
      provider.failNext = true;
      const failed = await request("/client/payments/orders", {
        cookie: ownerCookie, method: "POST", body: { payableReference: "synthetic-other-fee", idempotencyKey: idemB },
        origin: environment.WEB_URL, expected: 503
      });
      assert.ok(!JSON.stringify(failed.data).includes("timeout detail"));
      const row = await prisma.paymentOrder.findFirstOrThrow({ where: { workspaceId: workspace.id, memberId: ownerAccount.id, idempotencyKeyHash: createHash("sha256").update(idemB).digest("hex") }, include: { attempts: true } });
      assert.equal(row.status, "pending");
      assert.equal(row.attempts[0].status, "unknown");
      assert.equal(await orderCount(), 2);
    });

    await t.test("disabled plugin lifecycle closes the route; audit and storage omit raw idempotency and credential values", async () => {
      await prisma.pluginInstallation.update({ where: { projectId_pluginCode: { projectId: project.id, pluginCode: "aij-payment" } }, data: { status: "installed", disabledAt: new Date() } });
      await request("/client/payments/orders/" + orderId, { cookie: ownerCookie, expected: 404 });
      const orders = await prisma.paymentOrder.findMany({ where: { workspaceId: workspace.id }, include: { attempts: true } });
      const audits = await prisma.auditLog.findMany({ where: { module: "aij-payment" } });
      assert.equal(audits.filter(row => row.action === "payment_order_requested").length, 2);
      const serialized = JSON.stringify([orders, audits], (_key, value) => typeof value === "bigint" ? value.toString() : value);
      for (const secret of secrets) assert.ok(!serialized.includes(secret), "ledger and audit do not persist raw keys, synthetic credential marker, or adapter error");
      assert.ok(audits.every(row => row.workspaceId === workspace.id));
    });
  } finally {
    if (app) await app.close();
    replaceEnvironment(original);
  }
});
