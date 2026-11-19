import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";
import type { TLSSocket } from "node:tls";
import { TextDecoder } from "node:util";
import { PrismaService } from "../../prisma/prisma.service";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { parseSecretRef, SecretRefPort } from "../../secret-center/secret-ref";
import type { NotificationDeliveryContext, NotificationDeliveryReceipt, NotificationProvider } from "./notification-provider";
import { publicWebhookAddress, WebhookNotificationPolicy, webhookError, WEBHOOK_DEADLINE_MS, WEBHOOK_DENIED,
  WEBHOOK_PAYLOAD_LIMIT, WEBHOOK_RESPONSE_LIMIT, WEBHOOK_UNKNOWN } from "./webhook-notification-policy";

const PLUGIN = "aij-notification";
const CONFIG_KEY = "notification.channel.webhook.secretRef";
export const WEBHOOK_DISPATCH_OWNER = "aij-notification.webhook-dispatch@1";
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const RECEIPT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type WebhookPost = Readonly<{
  endpoint: URL; address: string; family: 4 | 6; headers: Readonly<Record<string, string>>; body: Buffer; signal: AbortSignal;
}>;
export type WebhookResponse = Readonly<{ status: number; headers: Readonly<Record<string, string | string[] | undefined>>; body: Buffer }>;
/** Trusted constructor/app-instance test IO only. Production has no env proxy, loopback or TLS escape hatch. */
export interface WebhookNotificationIO {
  resolve(hostname: string, signal: AbortSignal): Promise<readonly { address: string; family: number }[]>;
  post(input: WebhookPost): Promise<WebhookResponse>;
}

export class NodeWebhookNotificationIO implements WebhookNotificationIO {
  // Trusted constructor seam permits owned TLS fixtures without global patches or runtime env bypasses.
  constructor(private readonly httpsRequest: typeof request = request) {}
  async resolve(hostname: string): Promise<readonly { address: string; family: number }[]> {
    return lookup(hostname, { all: true, verbatim: true });
  }
  post(input: WebhookPost): Promise<WebhookResponse> {
    return new Promise((resolve, reject) => {
      if (input.signal.aborted) { reject(webhookError(WEBHOOK_UNKNOWN)); return; }
      const req = this.httpsRequest({
        protocol: "https:", hostname: input.endpoint.hostname, port: 443, path: input.endpoint.pathname,
        method: "POST", headers: input.headers, servername: input.endpoint.hostname,
        rejectUnauthorized: true, agent: false, family: input.family,
        // Exactly one validated pin; no second resolution, alternate address, redirect or proxy.
        lookup: (_hostname, _options, callback) => callback(null, input.address, input.family),
        signal: input.signal, maxHeaderSize: WEBHOOK_RESPONSE_LIMIT
      }, res => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        if (!validResponseHeaders(res.statusCode || 0, res.headers)) {
          reject(webhookError(WEBHOOK_UNKNOWN)); res.destroy(); req.destroy(); return;
        }
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > WEBHOOK_RESPONSE_LIMIT) { reject(webhookError(WEBHOOK_UNKNOWN)); res.destroy(); req.destroy(); }
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("aborted", () => reject(webhookError(WEBHOOK_UNKNOWN)));
        res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on("socket", socket => socket.once("secureConnect", () => {
        const tls = socket as TLSSocket;
        const remote = tls.remoteAddress?.replace(/^::ffff:/, "");
        // Node verifies the normal CA chain and hostname against SNI, as well as our DNS pin.
        if (!tls.authorized || normalizeAddress(remote) !== normalizeAddress(input.address)) req.destroy(webhookError(WEBHOOK_UNKNOWN));
      }));
      req.on("error", reject);
      if (input.signal.aborted) req.destroy(webhookError(WEBHOOK_UNKNOWN));
      else req.end(input.body);
    });
  }
}

export class WebhookNotificationProvider implements NotificationProvider {
  readonly channelType = "webhook" as const;
  readonly requiresSecretRef = true;
  constructor(
    private readonly prisma: PrismaService,
    private readonly plugins: PluginRuntimeAccessService,
    private readonly secrets: SecretRefPort,
    private readonly policy: WebhookNotificationPolicy,
    private readonly io: WebhookNotificationIO = new NodeWebhookNotificationIO()
  ) {}

  async deliver(context: NotificationDeliveryContext, signal?: AbortSignal): Promise<NotificationDeliveryReceipt> {
    // Do not trust a manually reset attempt counter as the only duplicate guard.
    if (context.attemptNo !== 1) throw webhookError(WEBHOOK_UNKNOWN);
    const endpoint = this.policy.endpoint(context.recipientAddress);
    if (![context.idempotencyKey, context.projectId, context.messageId, context.recipientId].every(value => KEY.test(value)) ||
        typeof context.title !== "string" || typeof context.body !== "string" || !["text", "html"].includes(context.contentType)) {
      throw webhookError(WEBHOOK_DENIED);
    }
    const body = Buffer.from(JSON.stringify({ protocol: "aij.notification.webhook.v1", messageId: context.messageId,
      recipientId: context.recipientId, title: context.title, body: context.body, contentType: context.contentType,
      idempotencyKey: context.idempotencyKey, deliveryKey: context.idempotencyKey }), "utf8");
    if (body.length > WEBHOOK_PAYLOAD_LIMIT) throw webhookError(WEBHOOK_DENIED);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const deadline = performance.now() + WEBHOOK_DEADLINE_MS;
    const timer = setTimeout(abort, WEBHOOK_DEADLINE_MS);
    const check = () => {
      // A delayed timer callback must never permit late DNS/DB completion to start a send.
      if (performance.now() >= deadline) controller.abort();
      checkAbort(controller.signal);
    };
    // Keep this deadline live for isolated callers as well as the runtime worker.
    let admitted = false;
    try {
      check();
      const ref = await bounded(this.prisma.$transaction(async tx => {
        if (await this.plugins.projectId(tx) !== context.projectId) throw webhookError(WEBHOOK_DENIED);
        await this.plugins.assertEnabledInTransaction(tx, context.projectId, PLUGIN);
        const config = await tx.scopedConfig.findFirst({ where: channelWhere(context.projectId), select: { configValue: true } });
        if (!config) throw webhookError(WEBHOOK_DENIED);
        parseSecretRef(config.configValue);
        return config.configValue;
      }), controller.signal);
      check();
      const secret = await bounded(this.secrets.resolveTrustedForPlugin(PLUGIN, ref), controller.signal);
      if (!secret || Buffer.byteLength(secret, "utf8") > 8192) throw webhookError(WEBHOOK_DENIED);
      check();
      // Recheck the exact channel binding after resolve; SecretRefPort owns namespace/provider validation.
      // Permanent dispatch fence in the existing idempotency owner, not a second delivery ledger.
      const admission = await bounded(this.prisma.$transaction(async tx => {
        if (await this.plugins.projectId(tx) !== context.projectId) throw webhookError(WEBHOOK_DENIED);
        await this.plugins.assertEnabledInTransaction(tx, context.projectId, PLUGIN);
        const config = await tx.scopedConfig.findFirst({ where: { ...channelWhere(context.projectId), configValue: ref }, select: { id: true } });
        const parsed = parseSecretRef(ref);
        const active = await tx.secretReference.findFirst({ where: { ref, provider: parsed.provider, status: "active", deletedAt: null }, select: { id: true } });
        if (!config || !active) throw webhookError(WEBHOOK_DENIED);
        check();
        return tx.runtimeIdempotency.createMany({ data: [{ requestScope: "job", scope: "plugin", scopeId: context.projectId,
          pluginCode: PLUGIN, owner: WEBHOOK_DISPATCH_OWNER, idempotencyKey: context.idempotencyKey,
          // No TTL cleanup may reopen an external side effect. Retain with the job for reconciliation.
          status: "processing", expiresAt: new Date("9999-12-31T00:00:00.000Z") }], skipDuplicates: true });
      }), controller.signal);
      admitted = true;
      if (admission.count !== 1) throw webhookError(WEBHOOK_UNKNOWN);
      check();
      const answers = await bounded(this.io.resolve(endpoint.hostname, controller.signal), controller.signal);
      check();
      if (!answers.length || answers.length > 32 || answers.some(answer => !publicWebhookAddress(answer.address) || isIP(answer.address) !== answer.family)) {
        throw webhookError(WEBHOOK_UNKNOWN);
      }
      const pin = answers[0];
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac("sha256", secret).update(timestamp + "\n" + context.idempotencyKey + "\n").update(body).digest("hex");
      check();
      const response = await bounded(this.io.post({ endpoint, address: pin.address, family: pin.family as 4 | 6, body,
        headers: { host: endpoint.host, "content-type": "application/json; charset=utf-8", "content-length": String(body.length),
          "accept": "application/json", "accept-encoding": "identity", "x-aij-webhook-timestamp": timestamp,
          "x-aij-webhook-delivery-key": context.idempotencyKey, "x-aij-webhook-signature": "v1=" + signature }, signal: controller.signal }), controller.signal);
      check();
      if (!validResponseHeaders(response.status, response.headers) || response.body.length > WEBHOOK_RESPONSE_LIMIT) throw webhookError(WEBHOOK_UNKNOWN);
      const receipt: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body));
      if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || Object.keys(receipt).length !== 1 ||
          !("receiptId" in receipt) || typeof receipt.receiptId !== "string" || !RECEIPT.test(receipt.receiptId)) throw webhookError(WEBHOOK_UNKNOWN);
      // Do not echo credentials supplied by a malicious/misconfigured receiver as its receipt.
      const receiptId = receipt.receiptId;
      if ([secret, ref, context.title, context.body].some(value => value &&
          (receiptId === value || value.length >= 8 && receiptId.includes(value)))) throw webhookError(WEBHOOK_UNKNOWN);
      return { providerMessageId: receiptId };
    } catch (error) {
      if (admitted || controller.signal.aborted || error instanceof Error && error.message === WEBHOOK_UNKNOWN) throw webhookError(WEBHOOK_UNKNOWN);
      throw webhookError(WEBHOOK_DENIED);
    } finally {
      controller.abort(); clearTimeout(timer); signal?.removeEventListener("abort", abort);
    }
  }
}

function normalizeAddress(address: string | undefined): string | undefined {
  if (!address || isIP(address) !== 6) return address;
  return new URL(`https://[${address}]/`).hostname;
}
function channelWhere(projectId: string) {
  return { scope: "project", scopeId: projectId, pluginCode: PLUGIN, configKey: CONFIG_KEY,
    valueType: "secretRef", sensitive: true, isPublic: false, status: "active", deletedAt: null };
}
function checkAbort(signal: AbortSignal): void { if (signal.aborted) throw webhookError(WEBHOOK_UNKNOWN); }
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(webhookError(WEBHOOK_UNKNOWN));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
function validResponseHeaders(status: number, headers: WebhookResponse["headers"]): boolean {
  const length = headers["content-length"];
  return status >= 200 && status <= 299 && headers.location === undefined &&
    (headers["content-encoding"] === undefined || headers["content-encoding"] === "identity") &&
    typeof headers["content-type"] === "string" && /^application\/json(?:;\s*charset=utf-8)?$/i.test(headers["content-type"]) &&
    (length === undefined || typeof length === "string" && /^\d+$/.test(length) && Number(length) <= WEBHOOK_RESPONSE_LIMIT);
}
