import { X509Certificate, createPublicKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { readApplicationEnvironment } from "../../../../scripts/runtime-environment.cjs";

export type WechatPayConfig = Readonly<{
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
  let platformPublicKey: KeyObject;
  try {
    platformPublicKey = platformPem.includes("BEGIN CERTIFICATE")
      ? new X509Certificate(platformPem).publicKey
      : createPublicKey(platformPem);
  } catch {
    return null;
  }
  let notify: URL;
  try {
    notify = new URL(notifyUrl);
  } catch {
    return null;
  }
  if (notify.protocol !== "https:") return null;
  return {
    appid,
    mchid,
    serialNo,
    privateKeyPem,
    apiV3Key,
    platformPublicKey,
    notifyUrl,
    apiBase: (env.MBTI_WECHAT_PAY_API_BASE || "https://api.mch.weixin.qq.com").replace(/\/$/, ""),
  };
}
