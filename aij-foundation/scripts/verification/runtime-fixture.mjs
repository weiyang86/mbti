import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { acceptanceRecord, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { prepareRbacFixture } from "./rbac-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function createRuntimeFixture(task, { workerEnabled = false, enabledPlugins = [], rbacFixture = false } = {}) {
  const lease = await createAcceptance("test", task);
  const migration = await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id });
  assert.equal(migration.exitCode, 0, "new task-owned logical test database deploys only the local migration chain");
  const migrationStatus = await migrate({ mode: "test", action: "status", acceptanceId: lease.id });
  assert.equal(migrationStatus.exitCode, 0, "task database migration status is up to date before application writes");
  const seeded = await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true, runtimeManagement: true,
    ...(["AF-106", "AF-107"].includes(task) ? { paymentManagement: true } : {}),
    ...(task === "AF-082" ? { adminUsers: true, configuration: true, secrets: true, pluginManagement: true } : {}),
    ...(task === "AF-095" ? { adminUsers: true, configuration: true, secrets: true } : {}),
    ...(task === "AF-096" ? { auditLogs: true } : {}),
    ...(["AF-099", "AF-100", "AF-101", "AF-102"].includes(task) ? { integrationManagement: true } : {}) });
  assert.equal(seeded.status, "SEEDED");
  assert.equal(acceptanceRecord("test", lease.id).task, task);
  const credential = JSON.parse(await (await import("node:fs/promises")).readFile(seeded.credentials.file, "utf8"));
  const roleFixture = rbacFixture ? await prepareRbacFixture(lease.id, task) : undefined;
  const key = authKeys(lease.id, task);
  const previousEnv = { ...process.env };
  const environment = authEnvironment(lease.id, key.secret, task);
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env, environment, {
    ASYNC_RUNTIME_ENABLED: workerEnabled ? "true" : "false", ENABLED_PLUGINS: enabledPlugins.join(",")
  });
  const { createApplication } = require(join(repositoryRoot, "apps/api/dist/bootstrap.js"));
  const { PrismaService } = require(join(repositoryRoot, "apps/api/dist/prisma/prisma.service.js"));
  const { JobService } = require(join(repositoryRoot, "apps/api/dist/async-runtime/job.service.js"));
  const { OutboxService } = require(join(repositoryRoot, "apps/api/dist/async-runtime/outbox.service.js"));
  const { RuntimeRegistry } = require(join(repositoryRoot, "apps/api/dist/async-runtime/registry.js"));
  const app = await createApplication();
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address === "object" && address.port > 0, "API binds an OS-selected loopback port");
  const prisma = app.get(PrismaService);
  const registry = app.get(RuntimeRegistry);
  const jobs = app.get(JobService);
  const outbox = app.get(OutboxService);
  const baseUrl = `http://127.0.0.1:${address.port}/api`;
  const loginResponse = await fetch(baseUrl + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: credential.username, password: credential.password }), signal: AbortSignal.timeout(8000) });
  assert.equal(loginResponse.status, 200, "synthetic seeded admin can authenticate against the isolated test DB");
  const loginBody = await loginResponse.json();
  const token = loginBody.data.accessToken;
  assert.ok(typeof token === "string" && token.length > 50);
  return {
    task, lease, seeded, migrationStatus, rbacFixture: roleFixture, credentialFile: seeded.credentials.file, keyFile: key.path, baseUrl, app, prisma, registry, jobs, outbox, token,
    request: async (path, { expected = 200, method = "GET", body, authorization = token } = {}) => {
      const response = await fetch(baseUrl + path, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(authorization ? { authorization: "Bearer " + authorization } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      const text = await response.text();
      assert.equal(response.status, expected, `${method} ${path} expected HTTP ${expected} and got ${response.status}`);
      return { response, text, body: text ? JSON.parse(text) : null };
    },
    login: async (username, password) => {
      const response = await fetch(baseUrl + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(8000) });
      assert.equal(response.status, 200, "synthetic test account authenticates through the real HTTP route");
      return (await response.json()).data.accessToken;
    },
    database: operation => withDatabase("test", process.env, operation, { acceptanceId: lease.id }),
    close: async () => {
      await app.close();
      for (const name of Object.keys(process.env)) delete process.env[name];
      Object.assign(process.env, previousEnv);
    }
  };
}

export async function writeRuntimeEvidence(task, acceptanceId, file, payload) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const dir = join(repositoryRoot, ".artifacts", task.toLowerCase(), "integration", acceptanceId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, file);
  await writeFile(path, JSON.stringify({ task, acceptanceId, ...payload }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return path;
}

export { sleep };
