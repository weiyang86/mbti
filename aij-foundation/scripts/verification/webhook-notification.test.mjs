import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

// Execute the actual TypeScript sources without API build, database or external network.
const require = createRequire(join(process.cwd(), "apps/api/package.json"));
require("ts-node").register({ project: join(process.cwd(), "apps/api/tsconfig.json"), transpileOnly: true });
require("reflect-metadata");
const { WebhookNotificationPolicy, publicWebhookAddress, WEBHOOK_DENIED, WEBHOOK_UNKNOWN } = require("../../apps/api/src/plugins/aij-notification/webhook-notification-policy.ts");
const { WebhookNotificationProvider, WEBHOOK_DISPATCH_OWNER } = require("../../apps/api/src/plugins/aij-notification/webhook-notification-provider.ts");
const { NotificationDeliveryService } = require("../../apps/api/src/plugins/aij-notification/notification-delivery.service.ts");
const { NotificationProviderRegistry } = require("../../apps/api/src/plugins/aij-notification/notification-provider.ts");
const { NotificationRuntimeModule } = require("../../apps/api/src/plugins/aij-notification/notification-runtime.module.ts");
const { RuntimeRegistry } = require("../../apps/api/src/async-runtime/registry.ts");
const endpoint = "https://receiver.aij-notify.com/notifications/v1";
const secret = "af155-synthetic-signing-value";
const ref = "env://AIJ_SECRET_AIJ_FOUNDATION_TEST_AF155_WEBHOOK";
const context = { projectId: "project-155", messageId: "message-155", recipientId: "recipient-155", recipientAddress: endpoint,
  title: "Synthetic title", body: "af155-private-body-marker", contentType: "text", attemptNo: 1, idempotencyKey: "notification:event-155" };
const receipt = body => ({ status: 202, headers: { "content-type": "application/json" }, body: Buffer.from(body || '{"receiptId":"accepted-155"}') });
const safeError = code => error => {
  assert.equal(error.message, code); assert.equal(error.runtimeRetryable, false);
  assert.ok(!JSON.stringify(error).includes(secret)); assert.ok(!error.stack.includes(context.body));
  return true;
};
function fixture(options = {}) {
  const calls = { config: 0, secret: 0, dns: 0, post: [], admissions: 0, plugins: 0 };
  const fences = new Set();
  let enabled = true, configured = true, activeRef = true, projectId = context.projectId;
  const tx = {
    scopedConfig: { async findFirst(query) {
      calls.config++; const w = query.where;
      assert.equal(w.configKey, "notification.channel.webhook.secretRef"); assert.equal(w.pluginCode, "aij-notification");
      assert.equal(w.scope, "project"); assert.equal(w.scopeId, context.projectId); assert.equal(w.valueType, "secretRef");
      assert.equal(w.status, "active"); assert.equal(w.deletedAt, null); assert.equal(w.isPublic, false); assert.equal(w.sensitive, true);
      return configured ? { id: "config-155", configValue: ref } : null;
    } },
    secretReference: { async findFirst(query) { assert.equal(query.where.ref, ref); return activeRef ? { id: "ref-155" } : null; } },
    runtimeIdempotency: { async createMany({ data }) {
      calls.admissions++; assert.equal(data[0].owner, WEBHOOK_DISPATCH_OWNER);
      const key = data[0].scopeId + ":" + data[0].idempotencyKey;
      if (fences.has(key)) return { count: 0 }; fences.add(key); return { count: 1 };
    } }
  };
  const prisma = { async $transaction(work) { return work(tx); } };
  const plugins = { async projectId() { return projectId; }, async assertEnabledInTransaction() { calls.plugins++; if (!enabled) throw Error("disabled " + secret); } };
  const secrets = { async resolveTrustedForPlugin(code, value) { calls.secret++; assert.equal(code, "aij-notification"); assert.equal(value, ref);
    if (options.resolveSecret) return options.resolveSecret({ disableConfig: () => { configured = false; }, disableRef: () => { activeRef = false; } });
    return secret;
  } };
  const io = { async resolve(hostname, signal) { calls.dns++; assert.equal(hostname, new URL(endpoint).hostname);
    return options.resolve ? options.resolve(signal) : [{ address: "93.184.216.34", family: 4 }]; },
    async post(input) { calls.post.push(input); return options.post ? options.post(input) : receipt(); } };
  return { calls, fences, provider: new WebhookNotificationProvider(prisma, plugins, secrets, new WebhookNotificationPolicy([endpoint]), io),
    disablePlugin() { enabled = false; }, disableConfig() { configured = false; }, disableRef() { activeRef = false; }, foreignProject() { projectId = "foreign"; } };
}

test("exact canonical HTTPS policy rejects URL ambiguity, special hosts, and oversized allowlists", () => {
  for (const value of ["http://receiver.aij-notify.com/notifications/v1", endpoint + "?token=x", endpoint + "#x", endpoint + "?", endpoint + "#", endpoint.replace("https://", "https://user:pass@"),
    "https://localhost/", "https://a.local/", "https://a.internal/", "https://metadata.google.internal/", "https://127.0.0.1/", "https://2130706433/", "https://[::1]/",
    "https://RECEIVER.aij-notify.com/notifications/v1", endpoint.replace(".com/", ".com:443/"), endpoint.replace(".com/", ".com:444/"),
    " https://receiver.aij-notify.com/", "https://receiver.aij-notify.com/a/../notifications/v1", "https://receiver.aij-notify.com/%xz", "https://receiver.aij-notify.com\\evil/"]) {
    assert.throws(() => new WebhookNotificationPolicy([value]), safeError(WEBHOOK_DENIED), value);
  }
  assert.throws(() => new WebhookNotificationPolicy([]));
  assert.throws(() => new WebhookNotificationPolicy(Array.from({ length: 9 }, (_, i) => endpoint + i)));
  assert.throws(() => new WebhookNotificationPolicy([endpoint, endpoint]));
  assert.equal(new WebhookNotificationPolicy([endpoint]).endpoint(endpoint).href, endpoint);
  assert.throws(() => new WebhookNotificationPolicy([endpoint]).endpoint(endpoint + "/other"));
});

test("DNS address policy excludes private, mapped, transition, special and documentation addresses", () => {
  for (const address of ["0.0.0.0", "10.1.2.3", "100.64.1.2", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.0.0.9", "192.0.2.1", "192.88.99.1", "192.168.0.1", "192.31.196.1", "192.52.193.1", "192.175.48.1",
    "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1", "::ffff:8.8.8.8", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "2001::1", "2002:0808:0808::", "3fff::1", "2620:4f:8000::1", "64:ff9b::808:808", "not-ip"]) {
    assert.equal(publicWebhookAddress(address), false, address);
  }
  for (const address of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(publicWebhookAddress(address), true, address);
});

test("module factory leaves webhook off unless explicitly configured; malformed enabled policy fails closed", () => {
  assert.equal(WebhookNotificationPolicy.fromEnvironment({}), null);
  assert.equal(WebhookNotificationPolicy.fromEnvironment({ AIJ_NOTIFICATION_WEBHOOK_ENABLED: "false", AIJ_NOTIFICATION_WEBHOOK_ENDPOINTS: "bad" }), null);
  assert.throws(() => WebhookNotificationPolicy.fromEnvironment({ AIJ_NOTIFICATION_WEBHOOK_ENABLED: "true" }));
  const previous = { enabled: process.env.AIJ_NOTIFICATION_WEBHOOK_ENABLED, endpoints: process.env.AIJ_NOTIFICATION_WEBHOOK_ENDPOINTS };
  try {
    delete process.env.AIJ_NOTIFICATION_WEBHOOK_ENABLED; delete process.env.AIJ_NOTIFICATION_WEBHOOK_ENDPOINTS;
    const factory = Reflect.getMetadata("providers", NotificationRuntimeModule).find(item => item.provide === NotificationProviderRegistry).useFactory;
    assert.throws(() => factory({}, {}, {}).get("webhook"));
    process.env.AIJ_NOTIFICATION_WEBHOOK_ENABLED = "true"; process.env.AIJ_NOTIFICATION_WEBHOOK_ENDPOINTS = JSON.stringify([endpoint]);
    assert.ok(factory({}, {}, {}).get("webhook") instanceof WebhookNotificationProvider);
  } finally {
    for (const [key, value] of [["AIJ_NOTIFICATION_WEBHOOK_ENABLED", previous.enabled], ["AIJ_NOTIFICATION_WEBHOOK_ENDPOINTS", previous.endpoints]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("unapproved recipient and attempt >1 reject before metadata, DNS, secret or transport", async () => {
  for (const change of [{ recipientAddress: "https://attacker.aij-notify.com/" }, { recipientAddress: endpoint + "?x=1" }, { attemptNo: 2 }, { attemptNo: 0 }]) {
    const f = fixture(); await assert.rejects(f.provider.deliver({ ...context, ...change }), safeError(change.attemptNo !== undefined ? WEBHOOK_UNKNOWN : WEBHOOK_DENIED));
    assert.equal(f.calls.config + f.calls.secret + f.calls.dns + f.calls.post.length + f.calls.admissions, 0);
  }
});

test("server plugin/project/config/ref gates and binding changes reject before DNS and transport", async () => {
  for (const disable of ["disablePlugin", "disableConfig", "disableRef", "foreignProject"]) {
    const f = fixture(); f[disable](); await assert.rejects(f.provider.deliver(context), safeError(WEBHOOK_DENIED));
    assert.equal(f.calls.dns + f.calls.post.length, 0);
  }
  for (const which of ["disableConfig", "disableRef"]) {
    const f = fixture({ resolveSecret: controls => { controls[which](); return secret; } });
    await assert.rejects(f.provider.deliver(context), safeError(WEBHOOK_DENIED)); assert.equal(f.calls.dns, 0);
  }
});

test("HMAC covers exact UTF8 bytes and stable delivery key; only allowpattern receipt survives", async () => {
  const f = fixture(); const result = await f.provider.deliver({ ...context, body: "你好\n" + context.body });
  assert.deepEqual(result, { providerMessageId: "accepted-155" });
  assert.equal(f.calls.secret, 1); assert.equal(f.calls.dns, 1); assert.equal(f.calls.post.length, 1);
  const input = f.calls.post[0]; const h = input.headers;
  assert.equal(input.address, "93.184.216.34"); assert.equal(input.family, 4); assert.equal(input.endpoint.href, endpoint);
  assert.equal(h.host, new URL(endpoint).hostname); assert.equal(h["accept-encoding"], "identity"); assert.equal(h["content-length"], String(input.body.length));
  assert.equal(h["x-aij-webhook-delivery-key"], context.idempotencyKey);
  assert.equal(h["x-aij-webhook-signature"], "v1=" + createHmac("sha256", secret).update(h["x-aij-webhook-timestamp"] + "\n" + context.idempotencyKey + "\n").update(input.body).digest("hex"));
  const payload = JSON.parse(input.body);
  assert.deepEqual(Object.keys(payload), ["protocol", "messageId", "recipientId", "title", "body", "contentType", "idempotencyKey", "deliveryKey"]);
  assert.ok(!input.body.includes(secret)); assert.ok(!input.body.includes(ref)); assert.equal(payload.deliveryKey, context.idempotencyKey);
  await assert.rejects(f.provider.deliver(context), safeError(WEBHOOK_UNKNOWN)); assert.equal(f.calls.post.length, 1, "durable fence also blocks an operator-reset attempt 1");
});

test("UTF8 payload limit is bytes and precedes all IO", async () => {
  const f = fixture(); await assert.rejects(f.provider.deliver({ ...context, body: "界".repeat(50_000) }), safeError(WEBHOOK_DENIED));
  assert.equal(f.calls.config + f.calls.secret + f.calls.dns + f.calls.post.length, 0);
});

test("mixed/private DNS answers, empty DNS, family mismatch and rebinding cannot reach transport", async () => {
  for (const answers of [[], [{ address: "127.0.0.1", family: 4 }], [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }], [{ address: "8.8.8.8", family: 6 }]]) {
    const f = fixture({ resolve: async () => answers });
    await assert.rejects(f.provider.deliver(context), safeError(WEBHOOK_UNKNOWN)); assert.equal(f.calls.post.length, 0);
  }
});

test("redirects, errors, compressed/oversized/nonJSON/invalid UTF8 responses all require reconciliation without resend", async () => {
  for (const response of [
    { ...receipt(), status: 302, headers: { location: endpoint } }, { ...receipt(), status: 500 },
    { ...receipt(), headers: { "content-type": "application/json", "content-encoding": "gzip" } },
    { ...receipt(), headers: { "content-type": "application/json", "content-length": "8193" } },
    { ...receipt(), body: Buffer.alloc(8193) }, { ...receipt(), body: Buffer.from([0xff]) },
    receipt('{"receiptId":"bad id"}'), receipt('{"receiptId":"ok","private":"' + secret + '"}'), receipt('{"receiptId":"' + context.body + '"}'), receipt("not-json"), receipt("{}"), receipt("[]"), receipt('{"receiptId":"' + secret + '"}')
  ]) {
    const f = fixture({ post: async () => response }); await assert.rejects(f.provider.deliver(context), safeError(WEBHOOK_UNKNOWN));
    await assert.rejects(f.provider.deliver(context), safeError(WEBHOOK_UNKNOWN)); assert.equal(f.calls.post.length, 1);
  }
  const f = fixture({ post: async () => { throw Error("token=" + secret + "; body=" + context.body); } });
  await assert.rejects(f.provider.deliver(context), safeError(WEBHOOK_UNKNOWN)); assert.equal(f.calls.post.length, 1);
});

test("abort before IO and late DNS do not start a transport; late response cannot report success", async () => {
  const before = new AbortController(); before.abort(); const f = fixture();
  await assert.rejects(f.provider.deliver(context, before.signal), safeError(WEBHOOK_UNKNOWN)); assert.equal(f.calls.config + f.calls.secret + f.calls.dns, 0);
  let finishDNS; const g = fixture({ resolve: () => new Promise(resolve => { finishDNS = resolve; }) });
  const controller = new AbortController(); const work = g.provider.deliver(context, controller.signal);
  while (!finishDNS) await new Promise(resolve => setImmediate(resolve));
  controller.abort(); await assert.rejects(work, safeError(WEBHOOK_UNKNOWN));
  finishDNS([{ address: "8.8.8.8", family: 4 }]); await new Promise(resolve => setImmediate(resolve)); assert.equal(g.calls.post.length, 0);
  let finishPost; const h = fixture({ post: () => new Promise(resolve => { finishPost = resolve; }) });
  const c = new AbortController(); const sent = h.provider.deliver(context, c.signal);
  while (!finishPost) await new Promise(resolve => setImmediate(resolve));
  c.abort(); await assert.rejects(sent, safeError(WEBHOOK_UNKNOWN)); finishPost(receipt());
  assert.equal(h.calls.post[0].signal.aborted, true);
});

test("10-second deadline includes DNS; a result arriving later never sends", { timeout: 12_000 }, async () => {
  let finish; const f = fixture({ resolve: () => new Promise(resolve => { finish = resolve; }) }); const start = Date.now();
  await assert.rejects(f.provider.deliver(context), safeError(WEBHOOK_UNKNOWN));
  assert.ok(Date.now() - start >= 9900 && Date.now() - start < 11_500);
  finish([{ address: "8.8.8.8", family: 4 }]); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.calls.post.length, 0);
});

test("actual delivery handler sets webhook attempt limit and safe terminal code while preserving other provider retry", async () => {
  const jobs = []; const terminals = []; const registry = new RuntimeRegistry(); let fail = true; let webhookCalls = 0; const calls = [];
  const prisma = { async $transaction(work) { return work({}); }, runtimeJob: { async updateMany(input) { terminals.push(input); return { count: 1 }; } } };
  const plugins = { async projectId() { return context.projectId; }, async assertEnabled() {} };
  const providers = new NotificationProviderRegistry([{ channelType: "in_app", requiresSecretRef: false, async deliver(c) {
    calls.push(c); if (fail) throw Object.assign(Error(secret), { runtimeRetryable: true }); return { providerMessageId: "in-app-ok" };
  } }, { channelType: "webhook", requiresSecretRef: true, async deliver() { webhookCalls++; throw Object.assign(Error(WEBHOOK_UNKNOWN), { runtimeRetryable: false }); } }]);
  const service = new NotificationDeliveryService(prisma, {}, { async enqueueInTransaction(_tx, input) { jobs.push(input); } }, plugins, registry, providers);
  service.onModuleInit();
  const event = channelType => ({ id: "event-155", scope: { type: "plugin", id: context.projectId, pluginCode: "aij-notification" }, correlationId: "correlation-155",
    payload: { projectId: context.projectId, messageId: context.messageId, recipientId: context.recipientId, title: context.title, body: context.body,
      contentType: "text", channelType, ...(channelType === "webhook" ? { recipientAddress: endpoint } : {}) } });
  const consumer = registry.event("aij-notification.delivery.requested", 1);
  await consumer(event("webhook"), {}); await consumer(event("in_app"), {});
  assert.deepEqual(jobs.map(job => job.maxAttempts), [1, 5]);
  const handler = registry.job("aij-notification.deliver", 1);
  const job = { id: "job-155", payload: event("webhook").payload, attempt: 2, leaseOwner: "lease-155", leaseNonce: "54f69321-0595-4a20-b320-c897ff15babd", signal: new AbortController().signal, idempotencyKey: context.idempotencyKey };
  await assert.rejects(handler(job), safeError(WEBHOOK_UNKNOWN));
  assert.equal(terminals[0].data.status, "dead"); assert.equal(terminals[0].data.lastError, WEBHOOK_UNKNOWN);
  const { leaseExpiresAt, ...sealedIdentity } = terminals[0].where;
  assert.deepEqual(sealedIdentity, { id: job.id, status: "running", leaseOwner: job.leaseOwner, attempts: 2, leaseNonce: job.leaseNonce, deletedAt: null });
  assert.ok(leaseExpiresAt.gt instanceof Date && Math.abs(leaseExpiresAt.gt.getTime() - Date.now()) < 1000);
  assert.equal(terminals[0].data.leaseNonce, null);
  await assert.rejects(handler({ ...job, attempt: 1 }), safeError(WEBHOOK_UNKNOWN));
  await assert.rejects(handler({ ...job, payload: event("in_app").payload, attempt: 1 }), error => error.runtimeRetryable === true);
  fail = false; assert.deepEqual(await handler({ ...job, payload: event("in_app").payload, attempt: 2 }), { resultReference: { providerMessageId: "in-app-ok" } });
  assert.deepEqual(calls.map(c => c.attemptNo), [1, 2]); assert.equal(terminals.length, 2);
  assert.equal(webhookCalls, 1);
  for (const leaseNonce of [undefined, null, "", "not-a-nonce"]) await assert.rejects(handler({ ...job, attempt: 1, leaseNonce }), safeError(WEBHOOK_UNKNOWN));
  assert.equal(webhookCalls, 1, "missing nonce cannot start a webhook provider");
  assert.equal(terminals.length, 2, "missing nonce cannot omit an ORM fence");
});

test("actual bounded Node HTTPS transport verifies TLS/Host/SNI/pin and rejects redirects, large streams and untrusted certs", { timeout: 8000 }, async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtemp, mkdir, readFile } = await import("node:fs/promises");
  const { createServer, request } = await import("node:https");
  const { NodeWebhookNotificationIO } = require("../../apps/api/src/plugins/aij-notification/webhook-notification-provider.ts");
  await mkdir(".artifacts/af-155/tls", { recursive: true });
  const dir = await mkdtemp(join(process.cwd(), ".artifacts/af-155/tls/unit-"));
  const host = new URL(endpoint).hostname;
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
    "-subj", "/CN=" + host, "-addext", "subjectAltName=DNS:" + host, "-days", "1"], { stdio: "ignore" });
  const cert = await readFile(join(dir, "cert.pem")); const key = await readFile(join(dir, "key.pem"));
  let mode = "ok", requests = 0;
  const server = createServer({ key, cert }, (req, res) => {
    requests++; assert.equal(req.headers.host, host); assert.equal(req.socket.servername, host);
    req.resume();
    if (mode === "hang") { return; }
    if (mode === "redirect") { res.writeHead(307, { location: endpoint }); res.end(); }
    else if (mode === "large") { res.writeHead(200, { "content-type": "application/json" }); res.end("x".repeat(8193)); }
    else { res.writeHead(202, { "content-type": "application/json" }); res.end('{"receiptId":"tls-accepted"}'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  // Fixture remaps only its own constructor-scoped dial to an ephemeral owned TLS listener.
  // CA/hostname verification stays on; production transport has neither test port nor test trust env.
  const transport = trusted => new NodeWebhookNotificationIO((options, callback) => request({ ...options, port, ...(trusted ? { ca: cert } : {}) }, callback));
  const input = { endpoint: new URL(endpoint), address: "127.0.0.1", family: 4, headers: { host }, body: Buffer.from("{}"), signal: new AbortController().signal };
  try {
    assert.equal((await transport(true).post(input)).body.toString(), '{"receiptId":"tls-accepted"}');
    assert.equal(requests, 1);
    for (const next of ["redirect", "large"]) { mode = next; await assert.rejects(transport(true).post(input)); }
    assert.equal(requests, 3, "redirect is never followed");
    await assert.rejects(transport(true).post({ ...input, endpoint: new URL("https://wrong.aij-notify.com/notifications/v1") }));
    assert.equal(requests, 3, "wrong hostname certificate is rejected before receiver HTTP");
    await assert.rejects(transport(false).post(input)); assert.equal(requests, 3, "untrusted certificate never reaches receiver HTTP");
    mode = "hang";
    await assert.rejects(transport(true).post({ ...input, signal: AbortSignal.timeout(100) }));
    assert.equal(requests, 4, "abort stops an actual response wait");
    const aborted = new AbortController(); aborted.abort(); await assert.rejects(transport(true).post({ ...input, signal: aborted.signal }));
    assert.equal(requests, 4);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

// Independently selected boundary vectors from IANA allocated/reserved registry.
test("IPv6 requires a current allocated prefix, not merely membership in 2000::/3", () => {
  for (const address of ["2001:1000::1", "2001:11ff:ffff::1", "2001:4e00::1", "2001:6000::1", "2001:c000::1", "2003:4000::1", "2420::1", "2610:200::1", "2612::1", "2620:200::1", "2640::1", "2810::1", "2a20::1", "2c10::1", "2d00::1", "3001::1", "3800::1", "3ffe::1", "3ffe:831f::1", "3fff:ffff::1"]) assert.equal(publicWebhookAddress(address), false, address);
  for (const address of ["2001:200::1", "2001:fff::1", "2001:1200::1", "2001:4860:4860::8888", "2001:5fff::1", "2001:8000::1", "2001:bfff::1", "2003:3fff::1", "240f::1", "241f::1", "2606:4700::1", "2610:1ff::1", "2620:1ff::1", "263f::1", "280f::1", "2a1f::1", "2c0f::1"]) assert.equal(publicWebhookAddress(address), true, address);
});
