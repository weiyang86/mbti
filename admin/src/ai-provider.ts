import { request, OpsApiError } from './ops-api'

export type AiProviderCode = 'deepseek' | 'aliyun'

export interface AiProviderField {
  key: string
  label: string
  kind: 'text' | 'url' | 'number' | 'select'
  required: boolean
  maxLength: number
}

export interface AiProviderEntry {
  code: AiProviderCode
  label: string
  category: 'model'
  fields: AiProviderField[]
  credentials: { key: string; label: string; required: boolean }[]
}

export interface ExternalServiceView {
  providerCode: AiProviderCode
  version: number
  fields: { baseUrl?: string; model?: string }
  credentialStates: { apiKey?: boolean }
  missingFields: string[]
  configurationStatus: 'not_configured' | 'draft' | 'credentials_ready'
  runtimeEnabled: false
  externalVerification: 'not_run'
}

export interface SecretReferenceView {
  id: string
  ref: string
  provider: 'env' | 'local'
  status: string
  configured: boolean
  updatedAt: string
}

const codes: AiProviderCode[] = ['deepseek', 'aliyun']
const labelOf: Record<string, string> = { deepseek: 'DeepSeek', aliyun: '阿里云百炼' }

export function aiSecretName(code: AiProviderCode) {
  return `MBTI_AI_${code.toUpperCase()}_API_KEY`
}

function invalid(): never {
  throw new OpsApiError(502, 'AI 配置响应格式不正确。')
}

function entry(value: unknown): AiProviderEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const row = value as Record<string, unknown>
  if (!codes.includes(row.code as AiProviderCode) || row.category !== 'model' || typeof row.label !== 'string' ||
    !Array.isArray(row.fields) || !Array.isArray(row.credentials)) return invalid()
  return { code: row.code as AiProviderCode, label: row.label, category: 'model',
    fields: row.fields as AiProviderField[], credentials: row.credentials as AiProviderEntry['credentials'] }
}

export async function readProviders(): Promise<AiProviderEntry[]> {
  const value = await request<unknown>('/admin/external-services/catalog')
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const providers = (value as { providers?: unknown }).providers
  if (!Array.isArray(providers)) return invalid()
  const rows = providers
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row) && codes.includes((row as Record<string, unknown>).code as AiProviderCode))
    .map(entry)
  if (rows.length !== codes.length) return invalid()
  return rows.sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code))
}

export async function readService(code: AiProviderCode): Promise<ExternalServiceView> {
  const value = await request<unknown>(`/admin/external-services/${code}`)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const row = value as Record<string, unknown>
  if (row.providerCode !== code || typeof row.version !== 'number' || !Number.isSafeInteger(row.version) ||
    !row.fields || typeof row.fields !== 'object' || Array.isArray(row.fields) ||
    !row.credentialStates || typeof row.credentialStates !== 'object' || Array.isArray(row.credentialStates) ||
    !Array.isArray(row.missingFields) || !row.missingFields.every(item => typeof item === 'string') ||
    !['not_configured', 'draft', 'credentials_ready'].includes(String(row.configurationStatus))) return invalid()
  const fields = row.fields as Record<string, unknown>, states = row.credentialStates as Record<string, unknown>
  return { providerCode: code, version: row.version as number,
    fields: { ...(typeof fields.baseUrl === 'string' ? { baseUrl: fields.baseUrl } : {}), ...(typeof fields.model === 'string' ? { model: fields.model } : {}) },
    credentialStates: { apiKey: states.apiKey === true },
    missingFields: row.missingFields as string[],
    configurationStatus: row.configurationStatus as ExternalServiceView['configurationStatus'],
    runtimeEnabled: false, externalVerification: 'not_run' }
}

export async function saveApiKey(code: AiProviderCode, apiKey: string): Promise<SecretReferenceView> {
  const value = await request<unknown>('/admin/secret-references/values', {
    method: 'POST', body: JSON.stringify({ name: aiSecretName(code), value: apiKey }),
  })
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const row = value as Record<string, unknown>
  if (typeof row.ref !== 'string' || !row.ref.startsWith('local://') || typeof row.configured !== 'boolean') return invalid()
  return { id: String(row.id ?? ''), ref: row.ref, provider: 'local', status: String(row.status ?? ''), configured: row.configured, updatedAt: String(row.updatedAt ?? '') }
}

export async function saveService(code: AiProviderCode, expectedVersion: number, baseUrl: string, model: string, secretRef?: string): Promise<ExternalServiceView> {
  const body: Record<string, unknown> = { expectedVersion, fields: { baseUrl: baseUrl.trim(), model: model.trim() } }
  if (secretRef) body.credentialRefs = { apiKey: secretRef }
  const value = await request<unknown>(`/admin/external-services/${code}`, { method: 'PUT', body: JSON.stringify(body) })
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return readServiceAfterSave(value as Record<string, unknown>, code)
}

function readServiceAfterSave(row: Record<string, unknown>, code: AiProviderCode): ExternalServiceView {
  const fields = (row.fields ?? {}) as Record<string, unknown>, states = (row.credentialStates ?? {}) as Record<string, unknown>
  return { providerCode: code, version: Number(row.version) || 0,
    fields: { ...(typeof fields.baseUrl === 'string' ? { baseUrl: fields.baseUrl } : {}), ...(typeof fields.model === 'string' ? { model: fields.model } : {}) },
    credentialStates: { apiKey: states.apiKey === true },
    missingFields: Array.isArray(row.missingFields) ? row.missingFields.filter(item => typeof item === 'string') as string[] : [],
    configurationStatus: (['not_configured', 'draft', 'credentials_ready'].includes(String(row.configurationStatus)) ? row.configurationStatus : 'draft') as ExternalServiceView['configurationStatus'],
    runtimeEnabled: false, externalVerification: 'not_run' }
}

export function providerLabel(code: AiProviderCode) {
  return labelOf[code] ?? code
}

export function errorMessage(error: unknown): string {
  const status = error instanceof OpsApiError ? error.status : 0
  if (status === 401) return '登录已失效，请重新登录。'
  if (status === 403) return '当前账号缺少 admin.config.manage 或 admin.secret.manage 权限。'
  if (status === 409) return '配置版本已变化，请重新读取后再保存。'
  if (status === 422 || status === 400) return 'Base URL、模型或 API Key 格式无效。'
  if (status === 503) return '服务端未配置密钥存储（AIJ_SECRET_STORE_KEY），暂时无法保存 API Key。'
  if (status >= 500) return 'AI 配置服务暂不可用，请稍后重试。'
  return error instanceof Error ? error.message : 'AI 配置请求失败，请重试。'
}
