// Internal F3 integration candidate; see F3-INTEGRATION.md, not a published contract.
import { baseURL, ensureGuestSession, request, useMock } from './client'

export type OrderStatusValue = 'pending' | 'paid' | 'failed'
export type PaymentAvailability = 'unconfigured' | 'controlled_test'

export interface PaymentProduct {
  code: string
  name: string
  description: string
  amount: number
  currency: 'CNY'
  saleable: boolean
  pricing_mode: 'controlled_test_fixture'
  highlights: string[]
  tier: 1 | 2
  unavailable_reason?: string
}

export interface CreateOrderBody {
  result_id: string
  product_code: string
}

export interface Order {
  id: string
  result_id: string
  product_code: string
  /** Server price in minor units (分). */
  amount: number
  currency: 'CNY'
  status: OrderStatusValue
  unlocked: boolean
  created_at: string
  payment_availability: PaymentAvailability
  pricing_mode: 'controlled_test_fixture'
  paid_at?: string
  pay_params?: Record<string, unknown>
}

export interface OrderStatus {
  order_id: string
  status: OrderStatusValue
  unlocked: boolean
  payment_availability: PaymentAvailability
  paid_at?: string
}

export interface Entitlement {
  id: string
  order_id: string
  result_id: string
  product_code: string
  kind: 'studio_tier_1'
  status: 'active'
  granted_at: string
  scope: 'controlled_test'
}

interface PurchaseIntent extends CreateOrderBody {
  owner: string
  key: string
}

const intentStorageKey = `mbti_purchase_intent_v1:${baseURL}`

function requireOnline() {
  if (useMock()) throw new Error('商品、订单和权益需要在线服务，请关闭 Mock 后使用')
}

function newIntentKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
    return `purchase-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }
  // This key deduplicates a request; it is not an authentication credential.
  return `purchase-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

/** Persist only request intent, never local payment or entitlement state. */
export async function preparePurchaseIntent(body: CreateOrderBody): Promise<string> {
  requireOnline()
  if (!body.result_id || !body.product_code) throw new Error('请先选择本人的结果和商品')
  const guest = await ensureGuestSession()
  const stored = uni.getStorageSync(intentStorageKey) as PurchaseIntent | undefined
  if (stored?.owner === guest.guest_token && stored.result_id === body.result_id && stored.product_code === body.product_code && typeof stored.key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(stored.key)) {
    return stored.key
  }
  const intent: PurchaseIntent = {
    owner: guest.guest_token,
    result_id: body.result_id,
    product_code: body.product_code,
    key: newIntentKey(),
  }
  // If persistence fails, do not create an order that cannot be safely retried.
  uni.setStorageSync(intentStorageKey, intent)
  return intent.key
}

/** Repeated attempts for the same intent, including after refresh, reuse its key. */
export async function createOrder(body: CreateOrderBody): Promise<Order> {
  const key = await preparePurchaseIntent(body)
  return request<Order>('/orders', {
    method: 'POST',
    data: { result_id: body.result_id, product_code: body.product_code },
    header: { 'Idempotency-Key': key },
  })
}

export function getOrderStatus(orderId: string): Promise<OrderStatus> {
  requireOnline()
  return request<OrderStatus>(`/orders/${encodeURIComponent(orderId)}`)
}

export function listProducts(): Promise<{ items: PaymentProduct[] }> {
  requireOnline()
  return request('/products')
}

export function listOrders(params: { limit?: number; cursor?: string } = {}): Promise<{ items: Order[]; next_cursor: string | null }> {
  requireOnline()
  const query = new URLSearchParams()
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.cursor) query.set('cursor', params.cursor)
  const suffix = query.toString()
  return request(`/orders${suffix ? `?${suffix}` : ''}`)
}

export function getMyEntitlements(): Promise<{ items: Entitlement[] }> {
  requireOnline()
  return request('/entitlements/me')
}
