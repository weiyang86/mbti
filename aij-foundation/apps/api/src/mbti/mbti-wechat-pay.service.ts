import { Inject, Injectable, Optional } from "@nestjs/common";
import { PaymentAttemptStatus, PaymentCallbackEventStatus, PaymentOrderStatus, Prisma, PaymentTransactionKind } from "@prisma/client";
import type { IncomingHttpHeaders } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readApplicationEnvironment } from "../../../../scripts/runtime-environment.cjs";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";
import { MbtiOrdersService } from "./mbti-orders.service";
import { buildWechatPayConfig, loadWechatPayConfig, type WechatPayChannel, type WechatPayConfig } from "./mbti-wechat-pay.config";
import { WECHAT_PAY_CHANNELS } from "../plugins/mbti-config/mbti-payment-settings";
import { buildWechatAuthorization, buildWechatPayParams, decryptWechatResource, verifyWechatNotifySignature } from "./mbti-wechat-pay.crypto";
import { MbtiConfigService } from "../plugins/mbti-config/mbti-config.service";
import { SecretRefPort } from "../secret-center/secret-ref";

const OWNER = "mbti-controlled-test";
const WECHAT_PROVIDER = "wechat-jsapi";
const MP_PROVIDER = "wechat-mp-jsapi";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const providerFor = (channel: WechatPayChannel) => channel === "mp" ? MP_PROVIDER : WECHAT_PROVIDER;

type WechatTransaction = Readonly<{
  appid?: unknown;
  mchid?: unknown;
  out_trade_no?: unknown;
  transaction_id?: unknown;
  trade_state?: unknown;
  success_time?: unknown;
  amount?: { total?: unknown; currency?: unknown };
  payer?: { openid?: unknown };
}>;

type NotifyEnvelope = Readonly<{
  id?: unknown;
  event_type?: unknown;
  resource?: Readonly<{ algorithm?: unknown; ciphertext?: unknown; nonce?: unknown; associated_data?: unknown }>;
}>;

function header(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] || "" : "";
}

/**
 * WeChat Pay JSAPI bridge for the controlled-test order projection.
 * Mini-program (`wechat`) and official-account (`mp`) channels read the published
 * admin payment settings, and their merchant credentials only from SecretCenter.
 * Without a complete configuration the payment endpoint returns 503.
 */
@Injectable()
export class MbtiWechatPayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: MbtiOrdersService,
    @Optional() private readonly configs?: MbtiConfigService,
    @Optional() @Inject(SecretRefPort) private readonly secrets?: SecretRefPort,
  ) {}

  private async publishedSettings(channel: WechatPayChannel) {
    try {
      const payments = await this.configs?.publishedPayments();
      return payments?.[channel] ?? null;
    } catch {
      // Plugin disabled or configuration unavailable: fall through to the legacy env path.
      return null;
    }
  }

  private async resolve(channel: WechatPayChannel): Promise<WechatPayConfig | null> {
    const settings = await this.publishedSettings(channel);
    if (settings) {
      if (!settings.enabled || settings.mode !== "live") return null;
      if (!this.secrets) return null;
      let values: { privateKey?: string; apiV3Key?: string; platformPublicKey?: string };
      try {
        const [privateKey, apiV3Key, platformPublicKey] = await Promise.all([
          this.secrets.resolveTrusted(settings.privateKeyRef),
          this.secrets.resolveTrusted(settings.apiV3KeyRef),
          this.secrets.resolveTrusted(settings.platformPublicKeyRef),
        ]);
        values = { privateKey, apiV3Key, platformPublicKey };
      } catch {
        return null;
      }
      const built = buildWechatPayConfig(channel, settings, values);
      return "config" in built ? built.config : null;
    }
    if (channel === "wechat") return loadWechatPayConfig();
    return null;
  }

  private async requireConfig(channel: WechatPayChannel): Promise<WechatPayConfig> {
    const config = await this.resolve(channel);
    if (!config) {
      if (channel === "mp") reject(503, "WECHAT_PAY_UNAVAILABLE", "微信公众号支付未配置完整，暂不可发起支付");
      reject(503, "WECHAT_PAY_UNAVAILABLE", "微信支付未配置完整，暂不可发起支付");
    }
    return config;
  }

  private async identityFor(channel: WechatPayChannel, guestId: string) {
    return channel === "mp"
      ? this.prisma.mbtiWechatMpIdentity.findUnique({ where: { guestId } })
      : this.prisma.mbtiWechatIdentity.findUnique({ where: { guestId } });
  }

  async pay(ownerId: string, id: string, channelInput: unknown) {
    const channel: WechatPayChannel = channelInput === "mp" ? "mp" : "wechat";
    const provider = providerFor(channel);
    const config = await this.requireConfig(channel);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) reject(404, "NOT_FOUND", "资源不存在");
    const order = await this.prisma.mbtiOrder.findFirst({ where: { id, ownerId } });
    if (!order) reject(404, "NOT_FOUND", "资源不存在");
    if (order.status !== "pending") reject(409, "ORDER_STATE", "仅待支付订单可发起微信支付");
    const identity = await this.identityFor(channel, ownerId);
    if (!identity) {
      if (channel === "mp") reject(409, "WECHAT_MP_LOGIN_REQUIRED", "请先在微信内完成公众号授权登录后再支付");
      reject(409, "WECHAT_LOGIN_REQUIRED", "请先使用微信登录后再支付");
    }

    const prepared = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"mbti-wxpay:" + id},0))`;
      const fresh = await tx.mbtiOrder.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== "pending") reject(409, "ORDER_STATE", "仅待支付订单可发起微信支付");
      let ledger = fresh.paymentOrderId
        ? await tx.paymentOrder.findUnique({ where: { id: fresh.paymentOrderId }, include: { attempts: { orderBy: { attemptNumber: "desc" } } } })
        : await tx.paymentOrder.findFirst({
          where: { payableOwner: OWNER, payableReference: id, status: PaymentOrderStatus.pending },
          include: { attempts: { orderBy: { attemptNumber: "desc" } } },
        });
      if (ledger && ledger.status !== PaymentOrderStatus.pending) reject(409, "ORDER_STATE", "该订单的支付记录已结束");
      if (!ledger) {
        const project = await tx.projectProfile.findFirst({ where: { environment: readApplicationEnvironment().APP_ENV || "development" } });
        if (!project) reject(503, "WECHAT_PAY_UNAVAILABLE", "支付服务未就绪");
        const workspace = await tx.clientWorkspace.findUnique({ where: { code: "mbti-wechat-pay" } })
          ?? await tx.clientWorkspace.create({ data: {
            id: "mbti-wechat-pay-workspace", code: "mbti-wechat-pay", name: "MBTI 微信支付",
            createdByMemberId: (await tx.memberUser.upsert({ where: { id: "mbti-wechat-pay-owner" },
              create: { id: "mbti-wechat-pay-owner", nickname: "MBTI 微信支付" }, update: {} })).id,
            creationIdempotencyKey: "mbti-wechat-pay-workspace",
          } });
        const role = await tx.clientWorkspaceRole.upsert({ where: { workspaceId_code: { workspaceId: workspace.id, code: "member" } },
          create: { id: "mbti-wechat-pay-role", workspaceId: workspace.id, code: "member", name: "成员" }, update: {} });
        const memberId = "mbti-wx-" + ownerId;
        await tx.memberUser.upsert({ where: { id: memberId }, create: { id: memberId, nickname: "MBTI 微信支付用户" }, update: {} });
        await tx.clientWorkspaceMembership.upsert({ where: { workspaceId_memberId: { workspaceId: workspace.id, memberId } },
          create: { workspaceId: workspace.id, memberId, roleId: role.id }, update: {} });
        ledger = await tx.paymentOrder.create({
          data: {
            projectId: project.id, workspaceId: workspace.id, memberId,
            // WeChat out_trade_no is limited to 32 characters.
            orderNo: "MBTIWX" + randomUUID().replace(/-/g, "").slice(0, 26),
            payableOwner: OWNER, payableReference: id,
            amountMinor: BigInt(fresh.amount), currency: fresh.currency, currencyExponent: 2,
            idempotencyKeyHash: digest("wechat:" + id),
            requestFingerprint: digest(JSON.stringify([id, fresh.amount, fresh.currency])),
            status: PaymentOrderStatus.pending,
          },
          include: { attempts: { orderBy: { attemptNumber: "desc" } } },
        });
      }
      let attempt = ledger.attempts.find(item => item.providerCode === provider);
      if (!attempt) {
        attempt = await tx.paymentAttempt.create({ data: {
          orderId: ledger.id, attemptNumber: (ledger.attempts[0]?.attemptNumber ?? 0) + 1, providerCode: provider,
          status: PaymentAttemptStatus.submitting,
        } });
      }
      return {
        ledgerId: ledger.id,
        orderNo: ledger.orderNo,
        attemptId: attempt.id,
        prepayId: attempt.providerReference || "",
        amount: fresh.amount,
        currency: fresh.currency,
      };
    }, { maxWait: 5000, timeout: 10000 });

    let prepayId = prepared.prepayId;
    if (!prepayId) {
      prepayId = await this.createJsapiPrepay(config, prepared.orderNo, prepared.amount, identity.openId);
      await this.prisma.$transaction(async tx => {
        await tx.paymentAttempt.update({ where: { id: prepared.attemptId }, data: {
          providerReference: prepayId, status: PaymentAttemptStatus.pending,
          submittedAt: new Date(), observedAt: new Date(),
        } });
        const fresh = await tx.mbtiOrder.findUniqueOrThrow({ where: { id }, select: { paymentOrderId: true } });
        if (!fresh.paymentOrderId) await tx.mbtiOrder.update({ where: { id }, data: { paymentOrderId: prepared.ledgerId } });
      }, { maxWait: 5000, timeout: 10000 });
    }
    return {
      payment_availability: "wechat_jsapi" as const,
      channel,
      pay_params: buildWechatPayParams({ appid: config.appid, prepayId, privateKeyPem: config.privateKeyPem }),
    };
  }

  private async createJsapiPrepay(config: WechatPayConfig, orderNo: string, amount: number, openId: string) {
    const path = "/v3/pay/transactions/jsapi";
    const body = JSON.stringify({
      appid: config.appid,
      mchid: config.mchid,
      description: "MBTI 套装",
      out_trade_no: orderNo,
      notify_url: config.notifyUrl,
      amount: { total: amount, currency: "CNY" },
      payer: { openid: openId },
    });
    let response: Response;
    try {
      response = await fetch(config.apiBase + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: buildWechatAuthorization({
            mchid: config.mchid, serialNo: config.serialNo, privateKeyPem: config.privateKeyPem,
            method: "POST", path, body,
          }),
        },
        body,
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      reject(503, "WECHAT_PAY_UNAVAILABLE", "微信支付下单超时，请稍后重试");
    }
    const payload = await response.json().catch(() => null) as { prepay_id?: unknown; code?: unknown } | null;
    if (!response.ok || !payload || typeof payload.prepay_id !== "string" || !payload.prepay_id) {
      reject(503, "WECHAT_PAY_UNAVAILABLE", "微信支付下单失败，请稍后重试");
    }
    return payload.prepay_id;
  }

  async notify(headers: IncomingHttpHeaders, rawBody?: Buffer) {
    if (!Buffer.isBuffer(rawBody) || rawBody.length < 1 || rawBody.length > 65_536) {
      reject(400, "INVALID_CALLBACK", "支付回调格式无效");
    }
    const timestamp = header(headers, "wechatpay-timestamp");
    const nonce = header(headers, "wechatpay-nonce");
    const signature = header(headers, "wechatpay-signature");
    if (!timestamp || !nonce || !signature) reject(401, "INVALID_CALLBACK_SIGNATURE", "支付回调签名缺失");
    const seconds = Number(timestamp);
    if (!Number.isInteger(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) {
      reject(401, "INVALID_CALLBACK_SIGNATURE", "支付回调时间戳无效");
    }
    let envelope: NotifyEnvelope;
    try {
      envelope = JSON.parse(rawBody.toString("utf8")) as NotifyEnvelope;
    } catch {
      reject(400, "INVALID_CALLBACK", "支付回调格式无效");
    }
    const resource = envelope.resource;
    if (!envelope || typeof envelope.id !== "string" || !envelope.id || !resource ||
        typeof resource.ciphertext !== "string" || typeof resource.nonce !== "string") {
      reject(400, "INVALID_CALLBACK", "支付回调格式无效");
    }
    if (envelope.event_type !== "TRANSACTION.SUCCESS") return { ignored: true };

    // A notify carries no channel marker and both channels may share one merchant id,
    // so the ledger's payment attempt decides the channel instead of config order.
    const candidates: { channel: WechatPayChannel; config: WechatPayConfig; transaction: WechatTransaction }[] = [];
    for (const channel of WECHAT_PAY_CHANNELS) {
      const candidate = await this.resolveForNotify(channel);
      if (!candidate) continue;
      if (!verifyWechatNotifySignature({ publicKey: candidate.platformPublicKey, timestamp, nonce, body: rawBody, signature })) continue;
      try {
        const parsed = JSON.parse(decryptWechatResource(candidate.apiV3Key, {
          algorithm: String(resource.algorithm),
          ciphertext: resource.ciphertext,
          nonce: resource.nonce,
          ...(typeof resource.associated_data === "string" ? { associated_data: resource.associated_data } : {}),
        })) as WechatTransaction;
        if (typeof parsed.mchid === "string" && parsed.mchid !== candidate.mchid) continue;
        candidates.push({ channel, config: candidate, transaction: parsed });
      } catch {
        continue;
      }
    }
    if (!candidates.length) reject(401, "INVALID_CALLBACK_SIGNATURE", "支付回调签名无效");
    const transaction = candidates[0].transaction;
    if (transaction.trade_state !== "SUCCESS" || typeof transaction.out_trade_no !== "string" ||
        typeof transaction.transaction_id !== "string" || !transaction.amount ||
        typeof transaction.amount.total !== "number" || typeof transaction.amount.currency !== "string") {
      reject(400, "INVALID_CALLBACK", "支付回调内容无效");
    }
    const ledger = await this.prisma.paymentOrder.findUnique({ where: { orderNo: transaction.out_trade_no }, include: { attempts: { orderBy: { attemptNumber: "desc" } } } });
    if (!ledger || ledger.payableOwner !== OWNER) reject(404, "NOT_FOUND", "支付订单不存在");
    const attempt = ledger.attempts.find(item => item.providerCode === WECHAT_PROVIDER || item.providerCode === MP_PROVIDER);
    if (!attempt) reject(404, "NOT_FOUND", "支付尝试不存在");
    const channel: WechatPayChannel = attempt.providerCode === MP_PROVIDER ? "mp" : "wechat";
    const provider = attempt.providerCode;
    const chosen = candidates.find(item => item.channel === channel &&
      (typeof item.transaction.appid !== "string" || item.transaction.appid === item.config.appid));
    const config = (chosen ?? candidates.find(item => item.channel === channel))?.config;
    if (!config) reject(401, "INVALID_CALLBACK_SIGNATURE", "支付回调渠道不匹配");
    if (Number(ledger.amountMinor) !== transaction.amount.total || ledger.currency.trim() !== transaction.amount.currency) {
      reject(400, "INVALID_CALLBACK", "支付金额或币种不匹配");
    }
    const mbtiOrderId = ledger.payableReference;
    const mbtiOrder = await this.prisma.mbtiOrder.findUnique({ where: { id: mbtiOrderId }, select: { ownerId: true } });
    if (!mbtiOrder) reject(404, "NOT_FOUND", "业务订单不存在");
    if (typeof transaction.payer?.openid === "string") {
      const identity = await this.identityFor(channel, mbtiOrder.ownerId);
      if (!identity || identity.openId !== transaction.payer.openid) reject(400, "INVALID_CALLBACK", "支付人与下单身份不一致");
    }

    const eventId = envelope.id as string;
    let alreadyProcessed: boolean;
    try {
      alreadyProcessed = await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"mbti-wxpay-notify:" + eventId},0))`;
        const existing = await tx.paymentCallbackEvent.findUnique({ where: {
          projectId_providerCode_eventId: { projectId: ledger.projectId, providerCode: provider, eventId },
        } });
        if (existing) return existing.status === PaymentCallbackEventStatus.accepted;
        const occurredAt = typeof transaction.success_time === "string" && Number.isFinite(Date.parse(transaction.success_time))
          ? new Date(transaction.success_time) : new Date();
        const receipt = await tx.paymentCallbackEvent.create({ data: {
          projectId: ledger.projectId, orderId: ledger.id, attemptId: attempt.id, providerCode: provider,
          eventId, payloadSha256: digest(rawBody.toString("utf8")),
          status: PaymentCallbackEventStatus.accepted, processedAt: new Date(),
        } });
        await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: PaymentAttemptStatus.succeeded, observedAt: occurredAt } });
        await tx.paymentOrder.update({ where: { id: ledger.id }, data: { status: PaymentOrderStatus.succeeded } });
        await tx.paymentTransaction.create({ data: {
          orderId: ledger.id, attemptId: attempt.id, callbackEventId: receipt.id,
          providerCode: provider, providerReference: transaction.transaction_id as string,
          kind: PaymentTransactionKind.charge, amountMinor: ledger.amountMinor, currency: ledger.currency, occurredAt,
        } });
        // Link the verified charge even to an order already closed as failed; read repair then
        // reopens it, because the payer was actually charged.
        const linked = await tx.mbtiOrder.findUniqueOrThrow({ where: { id: mbtiOrderId }, select: { paymentOrderId: true } });
        if (!linked.paymentOrderId) await tx.mbtiOrder.update({ where: { id: mbtiOrderId }, data: { paymentOrderId: ledger.id } });
        return false;
      }, { maxWait: 5000, timeout: 10000 });
    } catch (error) {
      // WeChat may resend the same transaction under a new event id; the charge is still one fact.
      const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" &&
        await this.prisma.paymentTransaction.findFirst({ where: {
          providerCode: provider, providerReference: transaction.transaction_id as string, kind: PaymentTransactionKind.charge,
        }, select: { id: true } });
      if (!duplicate) throw error;
      alreadyProcessed = true;
    }

    // Read repair projects the verified charge onto the business order and grants the entitlement.
    await this.orders.sync(mbtiOrderId);
    return { accepted: true, replay: alreadyProcessed };
  }

  private async resolveForNotify(channel: WechatPayChannel): Promise<WechatPayConfig | null> {
    const settings = await this.publishedSettings(channel);
    // A later "pause new orders" toggle must not strand callbacks for pending payments,
    // so notify ignores enabled/mode and only requires complete merchant material.
    if (!settings) return channel === "wechat" ? loadWechatPayConfig() : null;
    if (!this.secrets) return null;
    try {
      const [privateKey, apiV3Key, platformPublicKey] = await Promise.all([
        this.secrets.resolveTrusted(settings.privateKeyRef),
        this.secrets.resolveTrusted(settings.apiV3KeyRef),
        this.secrets.resolveTrusted(settings.platformPublicKeyRef),
      ]);
      // notify_url is irrelevant for verification: a paused channel must still settle callbacks.
      const built = buildWechatPayConfig(channel, settings, { privateKey, apiV3Key, platformPublicKey }, { requireNotifyUrl: false });
      return "config" in built ? built.config : null;
    } catch {
      return null;
    }
  }
}
