import { X509Certificate, createPublicKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { readApplicationEnvironment } from "../../../../scripts/runtime-environment.cjs";
import type { MbtiPaymentSettings } from "../plugins/mbti-config/mbti-config.schema";
import { merchantPrivateKey, normalizePem } from "../plugins/mbti-config/mbti-payment-settings";

export type WechatPayChannel = "wechat" | "mp";
export type WechatPayConfig = Readonly<{
  channel: WechatPayChannel;
  appid: string;
  mchid: string;
  serialNo: string;
  privateKeyPem: string;
  apiV3Key: string;
  platformPublicKey: KeyObject;
  notifyUrl: string;
  apiBase: string;
}>;

/** Supports PEM content or an absolute file path; values are never logged. */
function secret(value: string | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  if (raw.includes("BEGIN ")) return raw.replace(/\\n/g, "\n");
  try {
    return readFileSync(raw, "utf8");
  } catch {
    return "";
  }
}

function platformKey(pem: string): KeyObject | null {
  const normalized = normalizePem(pem);
  try {
    return normalized.includes("BEGIN CERTIFICATE") ? new X509Certificate(normalized).publicKey : createPublicKey(normalized);
  } catch {
    return null;
  }
}

function apiBase(env: Record<string, string | undefined> = readApplicationEnvironment()) {
  return (env.MBTI_WECHAT_PAY_API_BASE || "https://api.mch.weixin.qq.com").replace(/\/$/, "");
}

/**
 * Builds a runtime config from published admin settings plus resolved SecretCenter values.
 * Callback verification does not need notify_url, so it can omit that requirement.
 */
export function buildWechatPayConfig(channel: WechatPayChannel, settings: MbtiPaymentSettings,
  values: { privateKey?: string; apiV3Key?: string; platformPublicKey?: string },
  options: { requireNotifyUrl?: boolean } = {}): { config: WechatPayConfig } | { problem: string } {
  const requireNotifyUrl = options.requireNotifyUrl !== false;
  const appid = (settings.appId || "").trim();
  const mchid = (settings.mchId || "").trim();
  const serialNo = (settings.serialNo || "").trim();
  const notifyUrl = (settings.notifyUrl || "").trim();
  const privateKeyPem = normalizePem(values.privateKey || "");
  const apiV3Key = (values.apiV3Key || "").trim();
  const platformPem = normalizePem(values.platformPublicKey || "");
  if (!appid || !mchid || !serialNo || (requireNotifyUrl && !notifyUrl)) return { problem: "商户参数未填完整" };
  if (!privateKeyPem || !merchantPrivateKey(privateKeyPem)) return { problem: "商户签名私钥不可用" };
  if (apiV3Key.length !== 32) return { problem: "APIv3 密钥必须为 32 位" };
  const platformPublicKey = platformKey(platformPem);
  if (!platformPublicKey) return { problem: "微信支付验签公钥不可用" };
  if (notifyUrl) {
    let notify: URL;
    try { notify = new URL(notifyUrl); } catch { return { problem: "支付通知地址无效" }; }
    if (notify.protocol !== "https:") return { problem: "支付通知地址必须是 HTTPS" };
  }
  return { config: {
    channel, appid, mchid, serialNo, privateKeyPem, apiV3Key, platformPublicKey,
    notifyUrl, apiBase: apiBase(),
  } };
}

/** Legacy environment configuration, kept so deployments that predate admin settings still work. */
export function loadWechatPayConfig(env: Record<string, string | undefined> = readApplicationEnvironment()): WechatPayConfig | null {
  const appid = (env.MBTI_WECHAT_APPID || "").trim();
  const mchid = (env.MBTI_WECHAT_PAY_MCHID || "").trim();
  const serialNo = (env.MBTI_WECHAT_PAY_SERIAL_NO || "").trim();
  const privateKeyPem = secret(env.MBTI_WECHAT_PAY_PRIVATE_KEY);
  const apiV3Key = (env.MBTI_WECHAT_PAY_APIV3_KEY || "").trim();
  const platformPem = secret(env.MBTI_WECHAT_PAY_PLATFORM_PUBLIC_KEY);
  const notifyUrl = (env.MBTI_WECHAT_PAY_NOTIFY_URL || "").trim();
  if (!appid || !mchid || !serialNo || !privateKeyPem || apiV3Key.length !== 32 || !platformPem || !notifyUrl) return null;
  if (!privateKeyPem.includes("BEGIN PRIVATE KEY") && !privateKeyPem.includes("BEGIN RSA PRIVATE KEY")) return null;
  const platformPublicKey = platformKey(platformPem);
  if (!platformPublicKey) return null;
  let notify: URL;
  try { notify = new URL(notifyUrl); } catch { return null; }
  if (notify.protocol !== "https:") return null;
  return {
    channel: "wechat", appid, mchid, serialNo, privateKeyPem, apiV3Key, platformPublicKey,
    notifyUrl, apiBase: apiBase(env),
  };
}
