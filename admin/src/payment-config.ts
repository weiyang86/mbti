import { request, OpsApiError } from './ops-api'
import { configApi, type Projection } from './config-api'
import { skeletonFor } from './config-form'

export const paymentChannels = ['wechat', 'mp'] as const
export type PaymentChannel = typeof paymentChannels[number]
export const paymentChannelMeta: Record<PaymentChannel, { label: string; rail: string }> = {
  wechat: { label: '微信小程序', rail: '小程序内 wx.requestPayment' },
  mp: { label: '微信公众号', rail: '公众号网页授权 + JSAPI' },
}

export interface PaymentSettings {
  enabled: boolean
  mode: 'mock' | 'live'
  merchantLabel: string
  appId: string
  appSecretRef: string
  mchId: string
  serialNo: string
  publicKeyId: string
  notifyUrl: string
  refundNotifyUrl: string
  privateKeyRef: string
  apiV3KeyRef: string
  platformPublicKeyRef: string
}

export type PaymentsConfig = Record<'wechat' | 'mp' | 'douyin' | 'xhs', PaymentSettings>
export type CredentialField = 'privateKey' | 'apiV3Key' | 'platformPublicKey' | 'appSecret'

const secretNames: Record<PaymentChannel, Record<CredentialField, string>> = {
  wechat: {
    privateKey: 'MBTI_WECHAT_PAY_PRIVATE_KEY',
    apiV3Key: 'MBTI_WECHAT_PAY_APIV3_KEY',
    platformPublicKey: 'MBTI_WECHAT_PAY_PLATFORM_PUBLIC_KEY',
    appSecret: 'MBTI_WECHAT_PAY_APP_SECRET',
  },
  mp: {
    privateKey: 'MBTI_WECHAT_MP_PAY_PRIVATE_KEY',
    apiV3Key: 'MBTI_WECHAT_MP_PAY_APIV3_KEY',
    platformPublicKey: 'MBTI_WECHAT_MP_PAY_PLATFORM_PUBLIC_KEY',
    appSecret: 'MBTI_WECHAT_MP_PAY_APP_SECRET',
  },
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

/** Accepts null/older shapes without inventing secret references. */
export function normalizePayments(value: unknown): PaymentsConfig {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const skeleton = skeletonFor('payments') as Record<string, PaymentSettings>
  const result = {} as PaymentsConfig
  for (const channel of ['wechat', 'mp', 'douyin', 'xhs'] as const) {
    const raw = source[channel] && typeof source[channel] === 'object' && !Array.isArray(source[channel])
      ? source[channel] as Record<string, unknown> : {}
    const base = skeleton[channel]
    result[channel] = {
      enabled: raw.enabled === true,
      mode: raw.mode === 'live' ? 'live' : 'mock',
      merchantLabel: text(raw.merchantLabel),
      appId: text(raw.appId),
      appSecretRef: text(raw.appSecretRef),
      mchId: text(raw.mchId),
      serialNo: text(raw.serialNo),
      publicKeyId: text(raw.publicKeyId),
      notifyUrl: text(raw.notifyUrl),
      refundNotifyUrl: text(raw.refundNotifyUrl),
      privateKeyRef: text(raw.privateKeyRef),
      apiV3KeyRef: text(raw.apiV3KeyRef),
      platformPublicKeyRef: text(raw.platformPublicKeyRef),
    }
    if (base && raw.mode === undefined && !Object.keys(raw).length) result[channel] = { ...base }
  }
  return result
}

export interface PaymentProjection {
  draft: Projection
  published: Projection
  draftPayments: PaymentsConfig
  publishedPayments: PaymentsConfig
}

export async function readPaymentConfig(): Promise<PaymentProjection> {
  const [draft, published] = await Promise.all([configApi.read('draft'), configApi.read('published')])
  return {
    draft, published,
    draftPayments: normalizePayments(draft.categories.payments),
    publishedPayments: normalizePayments(published.categories.payments),
  }
}

export function validatePaymentSettings(settings: PaymentSettings): string[] {
  const issues: string[] = []
  const live = settings.mode === 'live'
  if (settings.merchantLabel.length > 40) issues.push('收款方展示名最多 40 字。')
  if (settings.appId && !/^wx[0-9a-zA-Z]{16}$/.test(settings.appId)) issues.push('AppID 必须是 wx 开头的 18 位字母数字。')
  if (settings.mchId && !/^\d{6,20}$/.test(settings.mchId)) issues.push('商户号必须是 6–20 位数字。')
  if (settings.serialNo && !/^[0-9a-fA-F]{8,64}$/.test(settings.serialNo)) issues.push('商户证书序列号必须是 8–64 位十六进制。')
  if (settings.publicKeyId && !/^PUB_KEY_ID_[0-9a-zA-Z]{5,70}$/.test(settings.publicKeyId)) issues.push('微信支付公钥 ID 格式应为 PUB_KEY_ID_ 加 5–70 位字母数字。')
  for (const [value, label] of [[settings.notifyUrl, '支付通知地址'], [settings.refundNotifyUrl, '退款通知地址']] as const) {
    if (!value) continue
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname === '/' ||
        !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) throw new Error()
    } catch { issues.push(`${label}必须是 HTTPS 域名下的非根路径。`) }
  }
  if (live && settings.enabled) {
    if (!settings.merchantLabel) issues.push('正式收款需要填写收款方展示名。')
    if (!settings.appId) issues.push('正式收款需要填写 AppID。')
    if (!settings.appSecretRef) issues.push('正式收款需要 AppSecret 凭据（登录换取 openid）。')
    if (!settings.mchId) issues.push('正式收款需要填写微信支付商户号。')
    if (!settings.serialNo) issues.push('正式收款需要填写商户证书序列号。')
    if (!settings.notifyUrl) issues.push('正式收款需要填写支付通知地址。')
    if (!settings.privateKeyRef) issues.push('正式收款需要商户签名私钥。')
    if (!settings.apiV3KeyRef) issues.push('正式收款需要 APIv3 密钥。')
    if (!settings.platformPublicKeyRef) issues.push('正式收款需要微信支付验签公钥。')
  }
  return [...new Set(issues)]
}

export async function saveSecretValue(channel: PaymentChannel, field: CredentialField, value: string): Promise<string> {
  const result = await request<unknown>('/admin/secret-references/values', {
    method: 'POST', body: JSON.stringify({ name: secretNames[channel][field], value }),
  })
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new OpsApiError(502, '凭据保存响应格式不正确。')
  const ref = (result as { ref?: unknown }).ref
  if (typeof ref !== 'string' || !ref.startsWith('local://')) throw new OpsApiError(502, '凭据保存响应缺少引用。')
  return ref
}

export type PemKind = 'private' | 'public' | 'certificate' | 'unknown'

/** Detects the PEM block type so a pasted file can be checked before it is stored. */
export function pemKind(value: string): PemKind {
  const text = value.trim()
  if (/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(text)) return 'private'
  if (/-----BEGIN CERTIFICATE-----/.test(text)) return 'certificate'
  if (/-----BEGIN PUBLIC KEY-----/.test(text)) return 'public'
  return 'unknown'
}

const pemLabels: Record<PemKind, string> = {
  private: '私钥（PRIVATE KEY）', public: '公钥（PUBLIC KEY）',
  certificate: '证书（CERTIFICATE）', unknown: '无法识别的内容',
}

/** Returns a user-facing problem, or null when the credential looks usable. */
export function credentialProblem(field: CredentialField, value: string): string | null {
  const text = value.trim()
  if (!text) return null
  if (field === 'apiV3Key') {
    if (/\s/.test(text)) return 'APIv3 密钥不能包含空白字符或换行'
    return text.length === 32 ? null : `APIv3 密钥必须是 32 位，当前是 ${text.length} 位`
  }
  if (field === 'appSecret') return /\s/.test(text) ? 'AppSecret 不能包含空白字符或换行' : null
  const kind = pemKind(text)
  if (field === 'privateKey') {
    if (kind === 'private') return null
    if (!text.includes('-----BEGIN')) return '商户签名私钥需要粘贴 apiclient_key.pem 的完整内容（含 BEGIN/END 行）'
    return `这里应粘贴私钥文件 apiclient_key.pem，当前内容是${pemLabels[kind]}`
  }
  if (field === 'platformPublicKey') {
    if (kind === 'public' || kind === 'certificate') return null
    if (!text.includes('-----BEGIN')) return '验签公钥需要粘贴 pub_key.pem 或平台证书的完整内容（含 BEGIN/END 行）'
    return `这里应粘贴 pub_key.pem 或平台证书，当前内容是${pemLabels[kind]}`
  }
  return null
}

export type PaymentCheck = { channel: PaymentChannel; label: string; ready: boolean; problems: string[]; checkedAt: string }

export type PaymentProbe = {
  channel: PaymentChannel; label: string
  reachable: boolean; signatureValid: boolean; ok: boolean
  status: number; message: string; hint?: string; probedAt: string
}

export async function checkPaymentChannel(channel: PaymentChannel): Promise<PaymentCheck> {
  const result = await request<unknown>('/plugins/mbti-config/payments/check', { method: 'POST', body: JSON.stringify({ channel }) })
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new OpsApiError(502, '检查响应格式不正确。')
  const row = result as Record<string, unknown>
  if (typeof row.ready !== 'boolean' || !Array.isArray(row.problems)) throw new OpsApiError(502, '检查响应格式不正确。')
  return { channel, label: String(row.label ?? ''), ready: row.ready, problems: row.problems.filter(item => typeof item === 'string') as string[], checkedAt: String(row.checkedAt ?? '') }
}

/** Real signed request to WeChat Pay; creates no order and moves no money. */
export async function probePaymentChannel(channel: PaymentChannel): Promise<PaymentProbe> {
  const result = await request<unknown>('/plugins/mbti-config/payments/probe', { method: 'POST', body: JSON.stringify({ channel }) })
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new OpsApiError(502, '验证响应格式不正确。')
  const row = result as Record<string, unknown>
  if (typeof row.ok !== 'boolean' || typeof row.message !== 'string') throw new OpsApiError(502, '验证响应格式不正确。')
  return {
    channel, label: String(row.label ?? ''), reachable: row.reachable === true, signatureValid: row.signatureValid === true,
    ok: row.ok, status: Number(row.status) || 0, message: row.message,
    ...(typeof row.hint === 'string' ? { hint: row.hint } : {}), probedAt: String(row.probedAt ?? ''),
  }
}

export function errorMessage(error: unknown): string {
  const status = error instanceof OpsApiError ? error.status : 0
  if (status === 401) return '登录已失效，请重新登录。'
  if (status === 403) return '需要平台超级管理员、admin.config.manage 与 admin.secret.manage 权限。'
  if (status === 409) return '配置版本已变化，请重新读取后再保存或发布。'
  if (status === 503) return '密钥存储或支付配置服务暂不可用，请稍后重试。'
  if (status >= 500) return '支付配置服务暂不可用，请稍后重试。'
  return error instanceof Error ? error.message : '支付配置请求失败，请重试。'
}
