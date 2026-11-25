import { X509Certificate, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import type { MbtiPaymentSettings } from "./mbti-config.schema";

export const WECHAT_PAY_CHANNELS = ["wechat", "mp"] as const;
export type WechatPayChannel = typeof WECHAT_PAY_CHANNELS[number];
export const PAYMENT_CHANNEL_LABELS: Record<WechatPayChannel, string> = { wechat: "微信小程序", mp: "微信公众号" };

/** Labels of the merchant fields still required before the channel can take real payments. */
export function paymentMissingFields(settings: MbtiPaymentSettings): string[] {
  const missing: string[] = [];
  if (!settings.merchantLabel) missing.push("收款方展示名");
  if (!settings.appId) missing.push("AppID");
  if (!settings.appSecretRef) missing.push("AppSecret 凭据");
  if (!settings.mchId) missing.push("商户号 MchID");
  if (!settings.serialNo) missing.push("商户证书序列号");
  if (!settings.notifyUrl) missing.push("支付通知地址");
  if (!settings.privateKeyRef) missing.push("商户签名私钥");
  if (!settings.apiV3KeyRef) missing.push("APIv3 密钥");
  if (!settings.platformPublicKeyRef) missing.push("微信支付验签公钥");
  return missing;
}

/**
 * A PEM block pasted through a single-line control loses its line breaks.
 * Rebuild the 64-column body while keeping the header/footer text intact.
 */
export function normalizePem(value: string): string {
  const text = value.trim()
  if (!text.includes("-----BEGIN") || /\r?\n/.test(text)) return text;
  const match = /-----(BEGIN[ A-Z]*?)-----\s*([\s\S]*?)\s*-----(END[ A-Z]*?)-----/.exec(text);
  if (!match) return text;
  const body = match[2]!.replace(/\s+/g, "");
  if (!body) return text;
  const wrapped = (body.match(/.{1,64}/g) || []).join("\n");
  return `-----${match[1]!.trim()}-----\n${wrapped}\n-----${match[3]!.trim()}-----\n`;
}

export function platformPublicKey(pem: string): KeyObject | null {
  const normalized = normalizePem(pem);
  try {
    return normalized.includes("BEGIN CERTIFICATE") ? new X509Certificate(normalized).publicKey : createPublicKey(normalized);
  } catch {
    return null;
  }
}

export function merchantPrivateKey(pem: string): KeyObject | null {
  try {
    return createPrivateKey(normalizePem(pem));
  } catch {
    return null;
  }
}

/** Non-secret readiness report. Values are never returned to the caller. */
export function paymentSecretProblems(settings: MbtiPaymentSettings, values: {
  privateKey?: string; apiV3Key?: string; platformPublicKey?: string;
}): string[] {
  const problems: string[] = [];
  if (values.privateKey !== undefined && !merchantPrivateKey(values.privateKey)) problems.push("商户签名私钥不是有效的 PEM 私钥");
  if (values.apiV3Key !== undefined && values.apiV3Key.trim().length !== 32) problems.push("APIv3 密钥必须是 32 位字符");
  if (values.platformPublicKey !== undefined && !platformPublicKey(values.platformPublicKey)) problems.push("微信支付验签公钥或证书无法解析");
  return problems;
}
