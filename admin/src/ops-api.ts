import { normalizeOrderId, orderPath, projectOrder } from './ops-order'

export type Capability = 'access' | 'orders' | 'draft' | 'systemRead' | 'systemWrite' | 'release' | 'fulfillment' | 'moderation' | 'export' | 'redemption'
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

export async function request<T>(path: string, init: RequestInit = {}, retry = true, raw = false): Promise<T> {
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
