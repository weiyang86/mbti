import { createDecipheriv, randomBytes, sign, verify, type KeyObject } from "node:crypto";

export type WechatPayParams = Readonly<{
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: "RSA";
  paySign: string;
}>;

export function signWechatMessage(privateKeyPem: string, message: string): string {
  return sign("RSA-SHA256", Buffer.from(message), privateKeyPem).toString("base64");
}

/** WeChat Pay APIv3 request authorization header. */
export function buildWechatAuthorization(input: {
  mchid: string;
  serialNo: string;
  privateKeyPem: string;
  method: string;
  path: string;
  body: string;
  timestamp?: string;
  nonce?: string;
}): string {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const nonce = input.nonce ?? randomBytes(16).toString("hex");
  const message = `${input.method}\n${input.path}\n${timestamp}\n${nonce}\n${input.body}\n`;
  const signature = signWechatMessage(input.privateKeyPem, message);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${input.mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${input.serialNo}"`;
}

/** Mini-program wx.requestPayment parameters. */
export function buildWechatPayParams(input: {
  appid: string;
  prepayId: string;
  privateKeyPem: string;
  timestamp?: string;
  nonce?: string;
}): WechatPayParams {
  const timeStamp = input.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const nonceStr = input.nonce ?? randomBytes(16).toString("hex");
  const pkg = `prepay_id=${input.prepayId}`;
  const message = `${input.appid}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
  return { timeStamp, nonceStr, package: pkg, signType: "RSA", paySign: signWechatMessage(input.privateKeyPem, message) };
}

export function verifyWechatNotifySignature(input: {
  publicKey: KeyObject;
  timestamp: string;
  nonce: string;
  body: Buffer;
  signature: string;
}): boolean {
  const message = `${input.timestamp}\n${input.nonce}\n${input.body.toString("utf8")}\n`;
  try {
    return verify("RSA-SHA256", Buffer.from(message), input.publicKey, Buffer.from(input.signature, "base64"));
  } catch {
    return false;
  }
}

export type WechatNotifyResource = Readonly<{
  algorithm: string;
  ciphertext: string;
  nonce: string;
  associated_data?: string;
}>;

/** AES-256-GCM resource decryption using the merchant APIv3 key. */
export function decryptWechatResource(apiV3Key: string, resource: WechatNotifyResource): string {
  if (resource.algorithm !== "AEAD_AES_256_GCM") throw new Error("Unsupported callback algorithm");
  const data = Buffer.from(resource.ciphertext, "base64");
  if (data.length <= 16) throw new Error("Invalid callback ciphertext");
  const tag = data.subarray(data.length - 16);
  const encrypted = data.subarray(0, data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(apiV3Key, "utf8"), Buffer.from(resource.nonce, "utf8"));
  decipher.setAuthTag(tag);
  if (resource.associated_data) decipher.setAAD(Buffer.from(resource.associated_data, "utf8"));
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
