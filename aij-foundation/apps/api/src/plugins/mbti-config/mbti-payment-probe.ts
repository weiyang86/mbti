import { randomBytes } from "node:crypto";
import { buildWechatAuthorization } from "../../mbti/mbti-wechat-pay.crypto";
import type { WechatPayConfig } from "../../mbti/mbti-wechat-pay.config";

export type PaymentProbeResult = Readonly<{
  reachable: boolean;
  signatureValid: boolean;
  ok: boolean;
  status: number;
  code?: string;
  message: string;
  hint?: string;
}>;

/**
 * Read-only connectivity check against the real WeChat Pay API.
 * A signed lookup of a non-existent order proves the merchant certificate, serial
 * number and private key are accepted, without creating an order or touching money.
 */
export async function probeMerchant(config: WechatPayConfig): Promise<PaymentProbeResult> {
  const orderNo = "MBTIWXPROBE" + randomBytes(10).toString("hex").toUpperCase();
  const path = `/v3/pay/transactions/out-trade-no/${orderNo}?mchid=${config.mchid}`;
  let response: Response;
  try {
    response = await fetch(config.apiBase + path, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: buildWechatAuthorization({
          mchid: config.mchid, serialNo: config.serialNo, privateKeyPem: config.privateKeyPem,
          method: "GET", path, body: "",
        }),
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { reachable: false, signatureValid: false, ok: false, status: 0,
      message: "无法连接微信支付接口", hint: "检查服务器出网、DNS 或代理设置" };
  }
  const payload = await response.json().catch(() => null) as { code?: unknown; message?: unknown } | null;
  const code = typeof payload?.code === "string" ? payload.code : undefined;
  const detail = typeof payload?.message === "string" ? payload.message : "";

  if (response.status === 404 || code === "ORDER_NOT_EXIST") {
    return { reachable: true, signatureValid: true, ok: true, status: response.status, code,
      message: "签名与商户证书已通过微信支付校验" };
  }
  if (response.status === 401 || code === "SIGN_ERROR") {
    return { reachable: true, signatureValid: false, ok: false, status: response.status, code,
      message: "微信支付拒绝签名",
      hint: "商户签名私钥与商户证书序列号不是同一套，或证书已作废" };
  }
  if (code === "PARAM_ERROR" || code === "INVALID_REQUEST") {
    // Signature was accepted far enough to parse the merchant context.
    return { reachable: true, signatureValid: true, ok: true, status: response.status, code,
      message: "微信支付已接受签名，仅订单号不存在" };
  }
  if (response.status === 403) {
    return { reachable: true, signatureValid: true, ok: false, status: response.status, code,
      message: "商户无该接口权限",
      hint: "确认商户号已开通 APIv3 与对应产品权限" };
  }
  return { reachable: true, signatureValid: response.status < 400, ok: false, status: response.status, code,
    message: detail || `微信支付返回 HTTP ${response.status}`,
    hint: "请核对商户号与接口权限" };
}
