import { Injectable } from "@nestjs/common";
import { PaymentAttemptStatus, PaymentCallbackEventStatus, PaymentOrderStatus, Prisma, PaymentTransactionKind } from "@prisma/client";
import type { IncomingHttpHeaders } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readApplicationEnvironment } from "../../../../scripts/runtime-environment.cjs";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";
import { MbtiOrdersService } from "./mbti-orders.service";
import { loadWechatPayConfig, type WechatPayConfig } from "./mbti-wechat-pay.config";
import { buildWechatAuthorization, buildWechatPayParams, decryptWechatResource, verifyWechatNotifySignature } from "./mbti-wechat-pay.crypto";

const OWNER = "mbti-controlled-test";
const PROVIDER = "wechat-jsapi";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

type WechatTransaction = Readonly<{
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
 * No credentials are fabricated: without a complete merchant configuration the
 * payment endpoint returns 503 and the callback endpoint stays unavailable.
 */
@Injectable()
export class MbtiWechatPayService {
  private readonly config: WechatPayConfig | null;

  constructor(private readonly prisma: PrismaService, private readonly orders: MbtiOrdersService) {
    this.config = loadWechatPayConfig();
  }

  available() {
    return !!this.config;
  }

  private requireConfig(): WechatPayConfig {
    if (!this.config) reject(503, "WECHAT_PAY_UNAVAILABLE", "微信支付未配置，暂不可发起支付");
    return this.config;
  }

  async pay(ownerId: string, id: string) {
    const config = this.requireConfig();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) reject(404, "NOT_FOUND", "资源不存在");
    const order = await this.prisma.mbtiOrder.findFirst({ where: { id, ownerId } });
    if (!order) reject(404, "NOT_FOUND", "资源不存在");
    if (order.status !== "pending") reject(409, "ORDER_STATE", "仅待支付订单可发起微信支付");
    const identity = await this.prisma.mbtiWechatIdentity.findUnique({ where: { guestId: ownerId } });
    if (!identity) reject(409, "WECHAT_LOGIN_REQUIRED", "请先使用微信登录后再支付");

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
      let attempt = ledger.attempts[0];
      if (!attempt) {
        attempt = await tx.paymentAttempt.create({ data: {
          orderId: ledger.id, attemptNumber: 1, providerCode: PROVIDER, status: PaymentAttemptStatus.submitting,
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
    const config = this.requireConfig();
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
    if (!verifyWechatNotifySignature({ publicKey: config.platformPublicKey, timestamp, nonce, body: rawBody, signature })) {
      reject(401, "INVALID_CALLBACK_SIGNATURE", "支付回调签名无效");
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
    let transaction: WechatTransaction;
    try {
      transaction = JSON.parse(decryptWechatResource(config.apiV3Key, {
        algorithm: String(resource.algorithm),
        ciphertext: resource.ciphertext,
        nonce: resource.nonce,
        ...(typeof resource.associated_data === "string" ? { associated_data: resource.associated_data } : {}),
      })) as WechatTransaction;
    } catch {
      reject(400, "INVALID_CALLBACK", "支付回调解密失败");
    }
    if (transaction.trade_state !== "SUCCESS" || typeof transaction.out_trade_no !== "string" ||
        typeof transaction.transaction_id !== "string" || !transaction.amount ||
        typeof transaction.amount.total !== "number" || typeof transaction.amount.currency !== "string") {
      reject(400, "INVALID_CALLBACK", "支付回调内容无效");
    }
    const ledger = await this.prisma.paymentOrder.findUnique({ where: { orderNo: transaction.out_trade_no }, include: { attempts: { orderBy: { attemptNumber: "desc" } } } });
    if (!ledger || ledger.payableOwner !== OWNER) reject(404, "NOT_FOUND", "支付订单不存在");
    if (Number(ledger.amountMinor) !== transaction.amount.total || ledger.currency.trim() !== transaction.amount.currency) {
      reject(400, "INVALID_CALLBACK", "支付金额或币种不匹配");
    }
    const attempt = ledger.attempts.find(item => item.providerCode === PROVIDER);
    if (!attempt) reject(404, "NOT_FOUND", "支付尝试不存在");
    const mbtiOrderId = ledger.payableReference;
    const mbtiOrder = await this.prisma.mbtiOrder.findUnique({ where: { id: mbtiOrderId }, select: { ownerId: true, status: true } });
    if (!mbtiOrder) reject(404, "NOT_FOUND", "业务订单不存在");
    if (typeof transaction.payer?.openid === "string") {
      const identity = await this.prisma.mbtiWechatIdentity.findUnique({ where: { guestId: mbtiOrder.ownerId } });
      if (!identity || identity.openId !== transaction.payer.openid) reject(400, "INVALID_CALLBACK", "支付人与下单身份不一致");
    }

    const eventId = envelope.id as string;
    const alreadyProcessed = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"mbti-wxpay-notify:" + eventId},0))`;
      const existing = await tx.paymentCallbackEvent.findUnique({ where: {
        projectId_providerCode_eventId: { projectId: ledger.projectId, providerCode: PROVIDER, eventId },
      } });
      if (existing) return existing.status === PaymentCallbackEventStatus.accepted;
      const occurredAt = typeof transaction.success_time === "string" && Number.isFinite(Date.parse(transaction.success_time))
        ? new Date(transaction.success_time) : new Date();
      const receipt = await tx.paymentCallbackEvent.create({ data: {
        projectId: ledger.projectId, orderId: ledger.id, attemptId: attempt.id, providerCode: PROVIDER,
        eventId, payloadSha256: digest(rawBody.toString("utf8")),
        status: PaymentCallbackEventStatus.accepted, processedAt: new Date(),
      } });
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: PaymentAttemptStatus.succeeded, observedAt: occurredAt } });
      await tx.paymentOrder.update({ where: { id: ledger.id }, data: { status: PaymentOrderStatus.succeeded } });
      await tx.paymentTransaction.create({ data: {
        orderId: ledger.id, attemptId: attempt.id, callbackEventId: receipt.id,
        providerCode: PROVIDER, providerReference: transaction.transaction_id as string,
        kind: PaymentTransactionKind.charge, amountMinor: ledger.amountMinor, currency: ledger.currency, occurredAt,
      } });
      const linked = await tx.mbtiOrder.findUniqueOrThrow({ where: { id: mbtiOrderId }, select: { paymentOrderId: true } });
      if (!linked.paymentOrderId) await tx.mbtiOrder.update({ where: { id: mbtiOrderId }, data: { paymentOrderId: ledger.id } });
      return false;
    }, { maxWait: 5000, timeout: 10000 });

    // Read repair projects the verified charge onto the business order and grants the entitlement.
    await this.orders.sync(mbtiOrderId);
    return { accepted: true, replay: alreadyProcessed };
  }
}
