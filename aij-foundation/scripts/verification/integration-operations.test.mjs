import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRuntimeFixture } from "./runtime-fixture.mjs";

const secretName = "AIJ_SECRET_AIJ_FOUNDATION_TEST_CONNECTOR_WEBHOOK_KEY";
const secretRef = "env://" + secretName;
const rawCredential = "Q6!integration-operation-secret-91mF7x2K";
const project = "aij-foundation-test";
const connector = "aij-generic-webhook";
const base = `/admin/integrations/projects/${project}`;
const operationType = { type: "secret_reference_check" };

test("AF-101 operation query, retry, authorization and failure recovery use real PostgreSQL and Nest HTTP", { timeout: 300_000 }, async t => {
  const f = await createRuntimeFixture("AF-101", { rbacFixture: true });
  const previousSecret = process.env[secretName];
  try {
    const accountDoc = JSON.parse(await readFile(f.rbacFixture.accounts[0].initialPasswordFile, "utf8"));
    const manager = accountDoc.accounts.find(account => account.username === "af101-integration-manager");
    const denied = accountDoc.accounts.find(account => account.username === "af101-no-access");
    assert.ok(manager && denied, "isolated acceptance DB has a connector manager and a default-deny account");
    const managerToken = await f.login(manager.username, manager.password);
    const deniedToken = await f.login(denied.username, denied.password);
    const projectRow = await f.prisma.projectProfile.findUniqueOrThrow({ where: { code: project }, select: { id: true } });
    const otherOrganization = await f.prisma.organizationProfile.create({ data: { code: "af101-other-org", name: "AF-101 synthetic organization" } });
    const otherProject = await f.prisma.projectProfile.create({ data: { organizationId: otherOrganization.id, code: "af101-other-project",
      name: "AF-101 synthetic project", environment: "test" } });
    process.env[secretName] = rawCredential;
    await f.prisma.secretReference.create({ data: { ref: secretRef, provider: "env", description: "AF-101 synthetic readiness reference" } });
    const configured = await f.request(`${base}/connectors/${connector}`, { method: "PUT", authorization: managerToken,
      body: { scopes: ["webhook:receive", "webhook:read"], secretRef, expectedVersion: 0 } });
    assert.equal(configured.body.data.secretConfigured, true);

    await t.test("anonymous and unauthorized users are rejected by actual API permission guards", async () => {
      await f.request(`${base}/operations`, { expected: 401, authorization: null });
      await f.request(`${base}/connectors/${connector}/operations`, { expected: 403, method: "POST", authorization: deniedToken, body: operationType });
    });

    let successOperation;
    await t.test("configured local SecretRef produces an auditable successful operation and bounded query", async () => {
      const started = await f.request(`${base}/connectors/${connector}/operations`, { expected: 201, method: "POST", authorization: managerToken, body: operationType });
      successOperation = started.body.data;
      assert.equal(successOperation.type, "secret_reference_check");
      assert.equal(successOperation.status, "succeeded");
      assert.equal(successOperation.attemptCount, 1);
      assert.equal(successOperation.attempts.length, 1);
      assert.equal(successOperation.lastFailureCode, null);
      const list = await f.request(`${base}/operations?page=1&pageSize=1`, { authorization: managerToken });
      assert.equal(list.body.data.total, 1);
      assert.equal(list.body.data.items.length, 1);
      assert.equal(list.body.data.items[0].id, successOperation.id);
      const detail = await f.request(`${base}/operations/${successOperation.id}`, { authorization: managerToken });
      assert.equal(detail.body.data.attempts[0].status, "succeeded");
      assert.equal(JSON.stringify({ started, list, detail }).includes(rawCredential), false, "responses contain no resolved secret value");
      const stored = await f.prisma.connectorOperation.findUniqueOrThrow({ where: { id: successOperation.id }, include: { attempts: true } });
      assert.equal(stored.status, "succeeded");
      assert.equal(stored.attemptCount, 1);
      const audit = await f.prisma.auditLog.findMany({ where: { module: "integration-center", resourceId: successOperation.id } });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].action, "connector_operation_attempted");
      assert.equal(JSON.stringify({ stored, audit }).includes(rawCredential), false, "operation and audit persistence contain no secret value");
      await assert.rejects(() => f.prisma.connectorOperation.delete({ where: { id: successOperation.id } }), error => error?.code === "P2003", "attempt history restricts deleting its operation");
      await assert.rejects(() => f.prisma.connectorInstallation.delete({ where: { projectId_connectorCode: { projectId: projectRow.id, connectorCode: connector } } }), error => error?.code === "P2003", "operation history restricts deleting its connector installation");
    });

    let failedOperation;
    await t.test("missing SecretRef configuration is recorded safely, then a retry recovers against current provider state", async () => {
      delete process.env[secretName];
      const started = await f.request(`${base}/connectors/${connector}/operations`, { expected: 201, method: "POST", authorization: managerToken, body: operationType });
      failedOperation = started.body.data;
      assert.equal(failedOperation.status, "failed");
      assert.equal(failedOperation.lastFailureCode, "secret_unavailable");
      assert.equal(failedOperation.attemptCount, 1);
      const stillFailed = await f.request(`${base}/operations/${failedOperation.id}/retry`, { expected: 201, method: "POST", authorization: managerToken });
      assert.equal(stillFailed.body.data.status, "failed");
      assert.equal(stillFailed.body.data.attemptCount, 2);
      assert.equal(stillFailed.body.data.attempts.length, 2);
      process.env[secretName] = rawCredential;
      const recovered = await f.request(`${base}/operations/${failedOperation.id}/retry`, { expected: 201, method: "POST", authorization: managerToken });
      assert.equal(recovered.body.data.status, "succeeded");
      assert.equal(recovered.body.data.lastFailureCode, null);
      assert.equal(recovered.body.data.attemptCount, 3);
      assert.deepEqual(recovered.body.data.attempts.map(attempt => attempt.status), ["failed", "failed", "succeeded"]);
      assert.equal(JSON.stringify({ started, stillFailed, recovered }).includes(rawCredential), false);
      const persisted = await f.prisma.connectorOperation.findUniqueOrThrow({ where: { id: failedOperation.id }, include: { attempts: true } });
      assert.equal(persisted.status, "succeeded");
      assert.equal(persisted.attemptCount, 3);
      assert.equal(persisted.attempts.length, 3);
      const audits = await f.prisma.auditLog.findMany({ where: { module: "integration-center", resourceId: failedOperation.id }, orderBy: { createdAt: "asc" } });
      assert.equal(audits.length, 3);
      assert.deepEqual(audits.map(row => row.action), ["connector_operation_attempted", "connector_operation_retried", "connector_operation_retried"]);
      assert.equal(JSON.stringify({ persisted, audits }).includes(rawCredential), false);
    });

    await t.test("invalid query, unknown context, missing operation and illegal retry fail closed", async () => {
      await f.request(`${base}/operations?page=0`, { expected: 400, authorization: managerToken });
      await f.request("/admin/integrations/projects/missing-project/operations", { expected: 404, authorization: managerToken });
      await f.request(`${base}/operations/x`, { expected: 400, authorization: managerToken });
      await f.request(`${base}/operations/${successOperation.id}/retry`, { expected: 409, method: "POST", authorization: managerToken });
      await f.request(`${base}/operations?page=1&pageSize=101`, { expected: 400, authorization: managerToken });
    });

    await t.test("disabled installation cannot start or retry connector readiness operations", async () => {
      await f.prisma.connectorInstallation.update({ where: { projectId_connectorCode: { projectId: projectRow.id, connectorCode: connector } }, data: { status: "disabled" } });
      await f.request(`${base}/connectors/${connector}/operations`, { expected: 404, method: "POST", authorization: managerToken, body: operationType });
      await f.prisma.connectorInstallation.update({ where: { projectId_connectorCode: { projectId: projectRow.id, connectorCode: connector } }, data: { status: "configured" } });
    });

    await t.test("operation attempts are scoped to their project and retry is permission protected", async () => {
      await f.request(`/admin/integrations/projects/${otherProject.code}/operations/${failedOperation.id}`, { expected: 404, authorization: managerToken });
      await f.request(`${base}/operations/${failedOperation.id}/retry`, { expected: 403, method: "POST", authorization: deniedToken });
      const filtered = await f.request(`${base}/operations?status=failed`, { authorization: managerToken });
      assert.equal(filtered.body.data.total, 0, "recovered operation is no longer in the failed filter");
      delete process.env[secretName];
      const disabledRetry = await f.request(`${base}/connectors/${connector}/operations`, { expected: 201, method: "POST", authorization: managerToken, body: operationType });
      assert.equal(disabledRetry.body.data.status, "failed");
      await f.prisma.connectorInstallation.update({ where: { projectId_connectorCode: { projectId: projectRow.id, connectorCode: connector } }, data: { status: "disabled" } });
      await f.request(`${base}/operations/${disabledRetry.body.data.id}/retry`, { expected: 404, method: "POST", authorization: managerToken });
      await f.prisma.connectorInstallation.update({ where: { projectId_connectorCode: { projectId: projectRow.id, connectorCode: connector } }, data: { status: "configured" } });
    });
  } finally {
    if (previousSecret === undefined) delete process.env[secretName]; else process.env[secretName] = previousSecret;
    await f.close();
  }
});
