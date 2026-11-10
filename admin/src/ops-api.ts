import { orderQuery, projectOrderPage, projectOrderSummary, type OrderFilters } from './ops-orders-collection'
import { normalizeOrderId, orderPath, projectOrder } from './ops-order'

export type Capability = 'access' | 'orders' | 'draft' | 'systemRead' | 'systemWrite' | 'release' | 'fulfillment' | 'generationRetry' | 'moderationRead' | 'moderation' | 'export' | 'redemption'
export interface OpsSession {
  user: { id: string; username: string; realName: string; isSuperAdmin: boolean }
  platformSuperAdmin: boolean
  role: 'owner' | 'editor' | 'support' | 'reader'
  capabilities: Record<Capability, boolean>
  permissions: string[]
  businessStage: string
}

let csrf = ''
let refreshPromise: Promise<OpsSession> | undefined
const timeoutMs = 12_000

export class OpsApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: 'INVALID_ORDER_RESPONSE') { super(message) }
}

export async function request<T>(path: string, init: RequestInit = {}, retry = true, raw: boolean | 'csv' = false): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body) headers.set('Content-Type', 'application/json')
    if (init.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase()) && csrf) headers.set('X-AIJ-CSRF', csrf)
    const response = await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
    if (response.status === 401 && retry && path !== '/auth/browser-login' && path !== '/auth/session' && path !== '/auth/logout') {
      try { await session() } catch { throw new OpsApiError(401, '登录已失效，请重新登录。') }
      return request<T>(path, init, false, raw)
    }
    if (raw === 'csv' && response.ok) {
      if (!response.headers.get('Content-Type')?.startsWith('text/csv')) throw new OpsApiError(502, '导出响应格式不正确。')
      return await response.text() as T
    }
    const payload = await response.json().catch(() => null) as { success?: boolean; data?: T; message?: string } | null
    if (!response.ok || (!raw && !payload?.success)) {
      const message = response.status === 401 ? '登录已失效，请重新登录。' : response.status === 403 ? '当前账号没有此操作权限。' : response.status >= 500 ? '服务暂不可用，请稍后重试。' : (!raw && payload?.message) || `请求失败（${response.status}）`
      throw new OpsApiError(response.status, message)
    }
    return (raw ? payload : payload?.data) as T
  } catch (error) {
    if (error instanceof OpsApiError) throw error
    throw new OpsApiError(0, error instanceof DOMException && error.name === 'AbortError' ? '请求超时，请检查服务后重试。' : '网络连接失败，请检查运营 API。')
  } finally { window.clearTimeout(timeout) }
}

export async function login(username: string, password: string) {
  await request('/auth/browser-login', { method: 'POST', headers: { 'X-AIJ-Client': 'web' }, body: JSON.stringify({ username, password }) }, false)
  return session()
}
export function session(): Promise<OpsSession> {
  if (!refreshPromise) refreshPromise = request<{ user: OpsSession['user']; csrfToken: string }>('/auth/session', {}, false)
    .then(async value => { csrf = value.csrfToken; return request<OpsSession>('/admin/mbti/ops/session', {}, false) })
    .finally(() => { refreshPromise = undefined })
  return refreshPromise
}
export async function logout() {
  try { await request('/auth/logout', { method: 'POST' }, false) } finally { csrf = '' }
}
export async function readOrder(id: string) {
  const normalized = normalizeOrderId(id)
  // This MBTI controller opts out of Foundation's success/data envelope.
  const payload = await request<unknown>(orderPath(normalized), {}, true, true)
  try { return projectOrder(payload, normalized) }
  catch { throw new OpsApiError(502, '订单响应格式不正确，请重试或联系维护人员。', 'INVALID_ORDER_RESPONSE') }
}

export async function listOrders(filters: OrderFilters) {
  const value = await request<unknown>('/admin/mbti/orders' + orderQuery(filters), {}, true, true)
  try { return projectOrderPage(value) } catch { throw new OpsApiError(502, '订单列表响应格式不正确。') }
}
export function exportOrders(filters: OrderFilters) {
  return request<string>('/admin/mbti/orders/export.csv' + orderQuery(filters), {}, true, 'csv')
}
export async function readOrderSummary(from: string, to: string, channel: string) {
  const value = await request<unknown>('/admin/mbti/orders/summary' + orderQuery({ from, to, channel }), {}, true, true)
  try { return projectOrderSummary(value) } catch { throw new OpsApiError(502, '订单汇总响应格式不正确。') }
}
export function saveOrdersCsv(csv: string, filename = 'mbti-orders.csv') {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = filename
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url)
}

export interface RefundRequestResult {
  schema: string
  status: string
  request_id: string
  order_id: string
  payment_order_id: string
  amount_fen: number
  currency: string
  refund_status: string
  reason: string
  created_at: string
  entitlement_revoked: boolean
}

function projectRefundRequest(value: unknown, expectedOrderId: string): RefundRequestResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
  const row = value as Record<string, unknown>
  if (row.schema !== 'mbti-ops-refund-request-candidate/v1' || row.status !== 'needs_human_review' ||
    row.order_id !== expectedOrderId || typeof row.request_id !== 'string' || typeof row.payment_order_id !== 'string' ||
    typeof row.amount_fen !== 'number' || !Number.isSafeInteger(row.amount_fen) || row.amount_fen < 1 ||
    typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency) ||
    row.refund_status !== 'pending_manual_review' || typeof row.reason !== 'string' ||
    typeof row.created_at !== 'string' || row.entitlement_revoked !== false) throw new Error('invalid')
  return {
    schema: row.schema, status: row.status, request_id: row.request_id, order_id: row.order_id,
    payment_order_id: row.payment_order_id, amount_fen: row.amount_fen, currency: row.currency,
    refund_status: row.refund_status, reason: row.reason, created_at: row.created_at, entitlement_revoked: false,
  }
}

export async function createOrderRefundRequest(orderId: string, body: { reason: string; idempotency_key: string; amount_fen?: number }) {
  const normalized = normalizeOrderId(orderId)
  const value = await request<unknown>(`${orderPath(normalized)}/refund-requests`, { method: 'POST', body: JSON.stringify(body) }, true, true)
  try { return projectRefundRequest(value, normalized) }
  catch { throw new OpsApiError(502, '退款申请响应格式不正确。') }
}

export interface RedeemCodeRow {
  id: string
  product_code: string
  max_redemptions: number
  redeemed_count: number
  code_status: string
  created_by: string
  created_at: string
  disabled_at?: string
}

function projectRedeemRow(value: unknown): RedeemCodeRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.product_code !== 'string' || typeof row.code_status !== 'string' ||
    typeof row.max_redemptions !== 'number' || typeof row.redeemed_count !== 'number' ||
    typeof row.created_by !== 'string' || typeof row.created_at !== 'string') throw new Error('invalid')
  return {
    id: row.id, product_code: row.product_code, max_redemptions: row.max_redemptions, redeemed_count: row.redeemed_count,
    code_status: row.code_status, created_by: row.created_by, created_at: row.created_at,
    ...(typeof row.disabled_at === 'string' ? { disabled_at: row.disabled_at } : {}),
  }
}

export async function listRedeemCodes(filters: { product_code?: string; code_status?: string; limit?: string } = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value)
  const suffix = query.toString() ? `?${query}` : ''
  const value = await request<unknown>(`/admin/mbti/redeem-codes${suffix}`, {}, true, true)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OpsApiError(502, '兑换码列表响应格式不正确。')
  const body = value as { items?: unknown[] }
  if (!Array.isArray(body.items)) throw new OpsApiError(502, '兑换码列表响应格式不正确。')
  try { return body.items.map(projectRedeemRow) } catch { throw new OpsApiError(502, '兑换码列表响应格式不正确。') }
}

export async function createRedeemCodes(body: { product_code: string; count: number }) {
  const value = await request<unknown>('/admin/mbti/redeem-codes', { method: 'POST', body: JSON.stringify(body) }, true, true)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OpsApiError(502, '兑换码生成响应格式不正确。')
  const row = value as { codes?: unknown; note?: unknown }
  if (!Array.isArray(row.codes) || typeof row.note !== 'string') throw new OpsApiError(502, '兑换码生成响应格式不正确。')
  const codes = row.codes.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid')
    const code = item as Record<string, unknown>
    if (typeof code.id !== 'string' || typeof code.code !== 'string' || typeof code.product_code !== 'string') throw new Error('invalid')
    return { id: code.id, code: code.code, product_code: code.product_code }
  })
  return { codes, note: row.note }
}

export async function disableRedeemCode(id: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new OpsApiError(422, '兑换码编号无效。')
  const value = await request<unknown>(`/admin/mbti/redeem-codes/${encodeURIComponent(id)}/disable`, { method: 'POST', body: '{}' }, true, true)
  try { return projectRedeemRow(value) } catch { throw new OpsApiError(502, '兑换码停用响应格式不正确。') }
}

export interface GenerationJobRow {
  id: string
  order_id: string
  recipe: string
  job_status: string
  attempt: number
  last_error_class: string | null
  created_at: string
  updated_at: string
}

function projectGenerationJob(value: unknown): GenerationJobRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.order_id !== 'string' || typeof row.recipe !== 'string' ||
    typeof row.job_status !== 'string' || typeof row.attempt !== 'number' || typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string' || row.unlocked_is_not_delivery !== true) throw new Error('invalid')
  return {
    id: row.id, order_id: row.order_id, recipe: row.recipe, job_status: row.job_status, attempt: row.attempt,
    last_error_class: typeof row.last_error_class === 'string' ? row.last_error_class : null,
    created_at: row.created_at, updated_at: row.updated_at,
  }
}

export async function listGenerationJobs(filters: { status?: string; order_id?: string; limit?: string } = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value)
  const suffix = query.toString() ? `?${query}` : ''
  const value = await request<unknown>(`/admin/mbti/generation-jobs${suffix}`, {}, true, true)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OpsApiError(502, '生成任务响应格式不正确。')
  const body = value as { items?: unknown[] }
  if (!Array.isArray(body.items)) throw new OpsApiError(502, '生成任务响应格式不正确。')
  try { return body.items.map(projectGenerationJob) } catch { throw new OpsApiError(502, '生成任务响应格式不正确。') }
}

export async function retryGenerationJob(id: string, body: { idempotency_key: string }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new OpsApiError(422, '任务编号无效。')
  const value = await request<unknown>(`/admin/mbti/generation-jobs/${encodeURIComponent(id)}/retry`, { method: 'POST', body: JSON.stringify(body) }, true, true)
  try { return projectGenerationJob(value) } catch { throw new OpsApiError(502, '生成任务重试响应格式不正确。') }
}

export interface ModerationCaseRow {
  id: string
  kind: string
  subject_type: string
  subject_ref: string
  reason_code: string
  case_status: string
  decision: string | null
  note: string | null
  created_at: string
  closed_at?: string
}

function projectModerationCase(value: unknown): ModerationCaseRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || typeof row.kind !== 'string' || typeof row.subject_type !== 'string' ||
    typeof row.subject_ref !== 'string' || typeof row.reason_code !== 'string' || typeof row.case_status !== 'string' ||
    typeof row.created_at !== 'string') throw new Error('invalid')
  return {
    id: row.id, kind: row.kind, subject_type: row.subject_type, subject_ref: row.subject_ref, reason_code: row.reason_code,
    case_status: row.case_status, decision: typeof row.decision === 'string' ? row.decision : null,
    note: typeof row.note === 'string' ? row.note : null, created_at: row.created_at,
    ...(typeof row.closed_at === 'string' ? { closed_at: row.closed_at } : {}),
  }
}

export async function listModerationCases(filters: { case_status?: string; kind?: string; limit?: string } = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value)
  const suffix = query.toString() ? `?${query}` : ''
  const value = await request<unknown>(`/admin/mbti/moderation/cases${suffix}`, {}, true, true)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OpsApiError(502, '匿名工单响应格式不正确。')
  const body = value as { items?: unknown[] }
  if (!Array.isArray(body.items)) throw new OpsApiError(502, '匿名工单响应格式不正确。')
  try { return body.items.map(projectModerationCase) } catch { throw new OpsApiError(502, '匿名工单响应格式不正确。') }
}

export async function disposeModerationCase(id: string, body: { decision: string; note?: string }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new OpsApiError(422, '工单编号无效。')
  const value = await request<unknown>(`/admin/mbti/moderation/cases/${encodeURIComponent(id)}/dispose`, { method: 'POST', body: JSON.stringify(body) }, true, true)
  try { return projectModerationCase(value) } catch { throw new OpsApiError(502, '工单处置响应格式不正确。') }
}

export interface GrowthSummary {
  interval: { from: string; to: string }
  channel: string
  metrics: { by_channel_event: { channel: string; event_type: string; count: number }[] } | null
  unavailableReason: string | null
}

export async function readGrowthSummary(from: string, to: string, channel: string) {
  const query = new URLSearchParams({ from, to, channel })
  const value = await request<unknown>(`/admin/mbti/growth/summary?${query}`, {}, true, true)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OpsApiError(502, '渠道汇总响应格式不正确。')
  const row = value as Record<string, unknown>
  const interval = row.interval as { from?: string; to?: string } | undefined
  if (!interval || interval.from !== from || interval.to !== to || typeof row.channel !== 'string') throw new OpsApiError(502, '渠道汇总响应格式不正确。')
  if (row.metrics === null) {
    if (row.unavailableReason !== 'growth_events_unavailable') throw new OpsApiError(502, '渠道汇总响应格式不正确。')
    return { interval: { from, to }, channel: row.channel, metrics: null, unavailableReason: 'growth_events_unavailable' }
  }
  const metrics = row.metrics as { by_channel_event?: unknown }
  if (!metrics || !Array.isArray(metrics.by_channel_event)) throw new OpsApiError(502, '渠道汇总响应格式不正确。')
  const by = metrics.by_channel_event.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid')
    const event = item as Record<string, unknown>
    if (typeof event.channel !== 'string' || typeof event.event_type !== 'string' || typeof event.count !== 'number') throw new Error('invalid')
    return { channel: event.channel, event_type: event.event_type, count: event.count }
  })
  return { interval: { from, to }, channel: row.channel, metrics: { by_channel_event: by }, unavailableReason: null }
}

export interface RetentionCohort {
  as_of: string
  eligible_first_tests: number
  same_bank_retakes: number
  retake_rate: number | null
  channel_attribution_unavailable: true
}

export async function readRetentionCohorts(asOf?: string) {
  const suffix = asOf ? `?as_of=${encodeURIComponent(asOf)}` : ''
  const value = await request<unknown>(`/admin/mbti/retention/cohorts${suffix}`, {}, true, true)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OpsApiError(502, '成熟队列响应格式不正确。')
  const row = value as Record<string, unknown>
  if (typeof row.as_of !== 'string' || typeof row.eligible_first_tests !== 'number' || typeof row.same_bank_retakes !== 'number' ||
    row.channel_attribution_unavailable !== true ||
    !(row.retake_rate === null || typeof row.retake_rate === 'number')) throw new OpsApiError(502, '成熟队列响应格式不正确。')
  return {
    as_of: row.as_of, eligible_first_tests: row.eligible_first_tests, same_bank_retakes: row.same_bank_retakes,
    retake_rate: row.retake_rate, channel_attribution_unavailable: true as const,
  }
}
