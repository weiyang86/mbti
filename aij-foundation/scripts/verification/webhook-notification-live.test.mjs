// ROOT ONLY: fresh AF-155 protected DB; never run in a worker. Requires root-owned fixture registration + API build.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, request as httpsRequest } from "node:https";
import { createRequire } from "node:module";
import { join,resolve } from "node:path";
import test from "node:test";
import { acceptanceRecord, checkDatabase, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";
import { writeRuntimeEvidence } from "./runtime-fixture.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json"));
const code = "aij-notification";
const endpoint = "https://receiver.aij-notify.com/notifications/v1";

async function createProtectedFixture() {
  const lease = await createAcceptance("test", "AF-155");
  assert.equal(acceptanceRecord("test", lease.id).task, "AF-155");
  assert.equal((await migrate({ mode: "test", action: "deploy", acceptanceId: lease.id })).exitCode, 0);
  assert.equal((await migrate({ mode: "test", action: "status", acceptanceId: lease.id })).exitCode, 0);
  const seeded = await seedDatabase({ mode: "test", acceptanceId: lease.id, generateCredentials: true,
    runtimeManagement: true, pluginManagement: true, configuration: true, secrets: true });
  assert.equal(seeded.status, "SEEDED");
  const credential = JSON.parse(await readFile(seeded.credentials.file, "utf8"));
  const keys = authKeys(lease.id, "AF-155");
  const previous = { ...process.env };
  let app;
  const restore = () => { for (const name of Object.keys(process.env)) delete process.env[name]; Object.assign(process.env, previous); };
  try {
    const environment=authEnvironment(lease.id, keys.secret, "AF-155");
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, environment, { ASYNC_RUNTIME_ENABLED: "false", ENABLED_PLUGINS: code });
    const databaseValues = readDatabaseEnvironment("test", process.env, lease.id);
    const { createApplication } = require("../../apps/api/dist/bootstrap.js");
    app = await createApplication();
    const logs = [];
    app.useLogger(Object.fromEntries(["log", "warn", "error", "debug", "verbose", "fatal"].map(level => [level, (...args) => logs.push(args)])));
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    let token;
    const http = async (method, path, body, expected = 200) => {
      const res = await fetch(base + path, { method, headers: { connection: "close", ...(token ? { authorization: "Bearer " + token } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      const text = await res.text(); assert.equal(res.status, expected, `${method} ${path} returned unexpected status`);
      return JSON.parse(text).data;
    };
    token = (await http("POST", "/auth/login", { username: credential.username, password: credential.password })).accessToken;
    const { PrismaService } = require("../../apps/api/dist/prisma/prisma.service.js");
    return { app, lease, logs, http, prisma: app.get(PrismaService), databaseValues,
      close: async () => { await app.close(); restore(); }, base };
  } catch (error) { if (app) await app.close(); restore(); throw error; }
}

async function ownedReceiver(secret) {
  await mkdir(join(repositoryRoot, ".artifacts/af-155/tls"), { recursive: true });
  const dir = await mkdtemp(join(repositoryRoot, ".artifacts/af-155/tls/live-"));
  const host = new URL(endpoint).hostname;
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
    "-subj", "/CN=" + host, "-addext", "subjectAltName=DNS:" + host, "-days", "1"], { stdio: "ignore" });
  const cert = await readFile(join(dir, "cert.pem")); const key = await readFile(join(dir, "key.pem"));
  const received = []; const durableReceipts = new Map(); let unknown = false;
  const server = createServer({ key, cert }, (req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks); const timestamp = req.headers["x-aij-webhook-timestamp"]; const deliveryKey = req.headers["x-aij-webhook-delivery-key"];
      assert.equal(req.method, "POST"); assert.equal(req.url, new URL(endpoint).pathname); assert.equal(req.headers.host, host);
      assert.equal(req.socket.servername, host); assert.equal(req.headers["accept-encoding"], "identity");
      assert.equal(req.headers["x-aij-webhook-signature"], "v1=" + createHmac("sha256", secret).update(timestamp + "\n" + deliveryKey + "\n").update(raw).digest("hex"));
      const payload = JSON.parse(raw); assert.equal(payload.protocol, "aij.notification.webhook.v1"); assert.equal(payload.deliveryKey, deliveryKey);
      assert.ok(!raw.includes(secret)); assert.ok(!raw.includes("env://"));
      received.push(deliveryKey);
      res.writeHead(202, { "content-type": "application/json" });
      if (unknown) res.end(JSON.stringify({ receiptId: "invalid receipt " + secret, body: payload.body }));
      else {
        if (!durableReceipts.has(deliveryKey)) durableReceipts.set(deliveryKey, "af155-receipt-" + durableReceipts.size);
        res.end(JSON.stringify({ receiptId: durableReceipts.get(deliveryKey) }));
      }
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { NodeWebhookNotificationIO } = require("../../apps/api/dist/plugins/aij-notification/webhook-notification-provider.js");
  const transport = new NodeWebhookNotificationIO((options, callback) => httpsRequest({ ...options, port: server.address().port, ca: cert }, callback));
  let dns = 0;
  return { received, durableReceipts, setUnknown(value) { unknown = value; }, get dns() { return dns; },
    io: { async resolve(hostname) { dns++; assert.equal(hostname, host); return [{ address: "93.184.216.34", family: 4 }]; },
      // Trusted app-scoped test mapping only: same bounded production transport with owned CA, normal Host/SNI verification.
      async post(input) { assert.equal(input.address, "93.184.216.34"); return transport.post({ ...input, address: "127.0.0.1", family: 4 }); } },
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir,{recursive:true}); } };
}

test("AF-155 root protected lifecycle -> channel/SecretRef -> Outbox -> Job -> owned TLS receiver", { timeout: 240_000 }, async t => {
  assert.equal(process.env.AIJ_AF155_ROOT_LIVE, "true", "ROOT ONLY: root must explicitly enable this fresh protected fixture after registration; never run Worker");
  assert.equal(resolve(process.cwd()), "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation");
  const git=flag=>resolve(repositoryRoot,execFileSync("git",["rev-parse",flag],{encoding:"utf8"}).trim());assert.equal(git("--git-dir"),git("--git-common-dir"));
  assert.equal(execFileSync("git",["branch","--show-current"],{encoding:"utf8"}).trim(),"dev");await checkDatabase("test");
  const f = await createProtectedFixture(); let receiver; let closed = false;
  try {
    const { NotificationProviderRegistry } = require("../../apps/api/dist/plugins/aij-notification/notification-provider.js");
    const { NotificationDeliveryService, NOTIFICATION_DELIVERY_JOB } = require("../../apps/api/dist/plugins/aij-notification/notification-delivery.service.js");
    const { WebhookNotificationProvider, WEBHOOK_DISPATCH_OWNER } = require("../../apps/api/dist/plugins/aij-notification/webhook-notification-provider.js");
    const { WebhookNotificationPolicy, WEBHOOK_UNKNOWN, WEBHOOK_DENIED } = require("../../apps/api/dist/plugins/aij-notification/webhook-notification-policy.js");
    const { PluginRuntimeAccessService } = require("../../apps/api/dist/plugin-runtime/plugin-runtime-access.service.js");
    const { SecretRefPort } = require("../../apps/api/dist/secret-center/secret-ref.js");
    const { OutboxService } = require("../../apps/api/dist/async-runtime/outbox.service.js");
    const { JobService } = require("../../apps/api/dist/async-runtime/job.service.js");
    const project = await f.prisma.projectProfile.findUniqueOrThrow({ where: { code: "aij-foundation-test" } });
    const delivery = f.app.get(NotificationDeliveryService), outbox = f.app.get(OutboxService), jobs = f.app.get(JobService);
    const providers = f.app.get(NotificationProviderRegistry);
    assert.throws(() => providers.get("webhook"), "default-off production module has no outbound provider");
    const secretName = "AIJ_SECRET_AIJ_FOUNDATION_TEST_AF155_" + f.lease.id.toUpperCase();
    const ref = "env://" + secretName, secret = "af155-synthetic-" + randomBytes(24).toString("hex");
    const body = "af155-private-body-" + f.lease.id;
    process.env[secretName] = secret;
    receiver = await ownedReceiver(secret);
    providers.register(new WebhookNotificationProvider(f.prisma, f.app.get(PluginRuntimeAccessService), f.app.get(SecretRefPort), new WebhookNotificationPolicy([endpoint]), receiver.io));
    await f.http("POST", `/admin/plugins/${code}/install`, { version: "0.1.0" }, 201);
    await f.http("POST", `/admin/plugins/${code}/enable`);
    await f.http("POST", "/admin/secret-references", { ref }, 201);
    const configure = async () => {
      const row = await f.prisma.scopedConfig.findFirst({ where: { scope: "project", scopeId: project.id, pluginCode: code, configKey: "notification.channel.webhook.secretRef" } });
      return f.http("PATCH", "/admin/notifications/channels/webhook", { secretRef: ref, expectedVersion: row?.version || 0 });
    };
    await configure();
    const payload = { messageId: "af155-message", recipientId: "af155-recipient", recipientAddress: endpoint, channelType: "webhook", title: "Synthetic Webhook", body, contentType: "text" };
    const enqueue = async key => {
      const event = await f.prisma.$transaction(tx => delivery.requestDelivery(tx, payload, key));
      const claims = await outbox.claim("af155-outbox", 20, 5000); const claim = claims.find(row => row.id === event.eventId); assert.ok(claim);
      await outbox.deliver(claim);
      const row = await f.prisma.runtimeJob.findFirstOrThrow({ where: { jobType: NOTIFICATION_DELIVERY_JOB, idempotencyKey: "notification:" + event.eventId } });
      assert.equal(row.maxAttempts, 1);
      return { ...event, jobId: row.id };
    };
    const claimOne = async queued => {
      const claim = (await jobs.claim("af155-worker", 20, 5000)).find(row => row.id === queued.jobId); assert.ok(claim); return claim;
    };
    const success = await enqueue("af155-success");
    const successClaim = await claimOne(success);
    await Promise.all([jobs.execute(successClaim), jobs.execute(successClaim)]);
    await t.test("one receipt and status owner; producer replay and duplicate lease execution never redeliver", async () => {
      const row = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: success.jobId } });
      assert.equal(row.status, "completed"); assert.deepEqual(row.resultReference, { providerMessageId: "af155-receipt-0" });
      const replay = await f.prisma.$transaction(tx => delivery.requestDelivery(tx, payload, "af155-success")); assert.equal(replay.eventId, success.eventId);
      await jobs.execute(successClaim);
      assert.equal(receiver.received.length, 1); assert.equal(receiver.durableReceipts.size, 1);
      assert.equal(await f.prisma.runtimeJob.count({ where: { idempotencyKey: "notification:" + success.eventId } }), 1);
      assert.equal(await f.prisma.runtimeIdempotency.count({ where: { owner: WEBHOOK_DISPATCH_OWNER, idempotencyKey: "notification:" + success.eventId } }), 1);
      assert.equal((await delivery.status(success.eventId)).status, "completed");
    });
    receiver.setUnknown(true);
    const unknown = await enqueue("af155-unknown"), unknownClaim = await claimOne(unknown); await jobs.execute(unknownClaim);
    await t.test("ambiguous external attempt is terminal; real operator retry resetting attempts cannot send again", async () => {
      const row = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: unknown.jobId } });
      assert.equal(row.status, "dead"); assert.equal(row.lastError, WEBHOOK_UNKNOWN); assert.equal(receiver.received.length, 2);
      await jobs.retry(unknown.jobId); const retriedClaim = await claimOne(unknown);
      assert.equal(retriedClaim.lease_owner, unknownClaim.lease_owner); assert.equal(retriedClaim.attempts, unknownClaim.attempts); assert.equal(retriedClaim.attempts, 1);
      assert.notEqual(retriedClaim.lease_nonce, unknownClaim.lease_nonce);
      await jobs.execute(retriedClaim);
      const retried = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: unknown.jobId } });
      assert.equal(retried.status, "dead"); assert.equal(retried.lastError, WEBHOOK_UNKNOWN); assert.equal(receiver.received.length, 2);
    });
    receiver.setUnknown(false);
    const deniedIds = [];
    for (const gate of ["plugin", "config", "ref", "project", "organization"]) {
      await t.test(`queued ${gate} disable has zero DNS and transport IO`, async () => {
        const queued = await enqueue("af155-disabled-" + gate); deniedIds.push(queued.jobId); const claim = await claimOne(queued);
        const before = { dns: receiver.dns, calls: receiver.received.length };
        if (gate === "plugin") await f.http("POST", `/admin/plugins/${code}/disable`);
        if (gate === "config") {
          const config = await f.prisma.scopedConfig.findFirstOrThrow({ where: { scopeId: project.id, pluginCode: code, configKey: "notification.channel.webhook.secretRef" } });
          await f.http("PATCH", "/admin/notifications/channels/webhook", { secretRef: null, expectedVersion: config.version });
        }
        if (gate === "ref") await f.prisma.secretReference.update({ where: { ref }, data: { status: "disabled" } });
        if (gate === "project") await f.prisma.projectProfile.update({ where: { id: project.id }, data: { status: "disabled" } });
        if (gate === "organization") await f.prisma.organizationProfile.update({ where: { id: project.organizationId }, data: { status: "disabled" } });
        try {
          await jobs.execute(claim);
          assert.equal(receiver.dns, before.dns); assert.equal(receiver.received.length, before.calls);
          const row = await f.prisma.runtimeJob.findUniqueOrThrow({ where: { id: queued.jobId } });
          if (gate === "config" || gate === "ref") { assert.equal(row.status, "dead"); assert.equal(row.lastError, WEBHOOK_DENIED); }
        } finally {
          if (gate === "plugin") await f.http("POST", `/admin/plugins/${code}/enable`);
          if (gate === "ref") await f.prisma.secretReference.update({ where: { ref }, data: { status: "active" } });
          if (gate === "project") await f.prisma.projectProfile.update({ where: { id: project.id }, data: { status: "active" } });
          if (gate === "organization") await f.prisma.organizationProfile.update({ where: { id: project.organizationId }, data: { status: "active" } });
          if (gate === "config") await configure();
        }
      });
    }
    const projection = { audits: await f.prisma.auditLog.findMany(), changes: await f.prisma.configurationChange.findMany(),
      jobs: await f.prisma.runtimeJob.findMany({ select: { id: true, status: true, lastError: true, resultReference: true } }),
      idempotency: await f.prisma.runtimeIdempotency.findMany(), logs: f.logs };
    const serialized = JSON.stringify(projection);
    for (const marker of [secret, body]) assert.equal(serialized.includes(marker), false, "no credential/body in receipts, terminal errors, runtime logs, audit or config history");
    // Intent payloads deliberately retain the producer's body under the existing Outbox/Job ownership.
    const intents = JSON.stringify({ outbox: await f.prisma.runtimeOutbox.findMany(), jobs: await f.prisma.runtimeJob.findMany() });
    assert.equal(intents.includes(secret), false);
    await receiver.close(); receiver = undefined;
    await f.close(); closed = true;
    const applicationPools = await withDatabase("test", f.databaseValues, async client => (await client.query(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND application_name LIKE 'aij-api:%'"
    )).rows[0].count, { acceptanceId: f.lease.id });
    assert.equal(applicationPools, 0);
    await writeRuntimeEvidence("AF-155", f.lease.id, "webhook-notification-live.json", { database: f.lease.database,
      statusOwner: "runtime_job", successJobId: success.jobId, unknownJobId: unknown.jobId, deniedJobIds: deniedIds,
      receiverAttempts: 2, successReceipts: 1, operatorRetrySecondTransport: false, sameWorkerSameAttemptDifferentNonce: true, disabledGatesZeroIO: true,
      credentialAndBodyInSafeProjections: false, applicationPools, externalNetwork: false, fixture: "owned loopback TLS with app-scoped IO; normal certificate verification" });
  } finally {
    if (receiver) await receiver.close(); if (!closed) await f.close();
  }
});
