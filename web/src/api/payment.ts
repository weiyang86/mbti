// TODO: 待 Remy 确认接口路径和字段（后端支付接口未开发，当前用 mock 数据支撑页面演示）
import { request, useMock } from './client'
import * as mock from './mock/payment'

export type OrderStatusValue = 'pending' | 'paid' | 'failed'

/** 微信支付调起参数（前端 wx.requestPayment 使用；mock 不真实调起） */
export interface WechatPayParams {
  appId: string
  timeStamp: string
  nonceStr: string
  package: string
  signType: 'RSA' | 'MD5' | 'HMAC-SHA256'
  paySign: string
}

export interface CreateOrderBody {
  result_id: string
  product_code: string
}

export interface Order {
  id: string
  result_id: string
  product_code: string
  /** 金额，单位：分 */
  amount: number
  currency: 'CNY'
  status: OrderStatusValue
  unlocked: boolean
  created_at: string
  paid_at?: string
  pay_params?: WechatPayParams
}

export interface OrderStatus {
  order_id: string
  status: OrderStatusValue
  unlocked: boolean
  paid_at?: string
}

export interface PollOptions {
  /** 轮询间隔，默认 2000ms */
  intervalMs?: number
  /** 超时时间，默认 60000ms */
  timeoutMs?: number
}

/** 创建订单：POST /api/v1/orders */
export function createOrder(body: CreateOrderBody) {
  if (useMock()) return mock.createOrder(body)
  return request<Order>('/orders', { method: 'POST', data: body })
}

/** 查询订单状态：GET /api/v1/orders/{id} */
export function getOrderStatus(orderId: string) {
  if (useMock()) return mock.getOrderStatus(orderId)
  return request<OrderStatus>(`/orders/${encodeURIComponent(orderId)}`)
}

/**
 * 前端轮询订单状态：每 intervalMs 查一次，直到 paid / failed，或超时返回当前状态。
 * 注意：这不是后端端点，而是对 getOrderStatus 的客户端封装。
 */
export function pollOrderStatus(orderId: string, options: PollOptions = {}): Promise<OrderStatus> {
  const intervalMs = options.intervalMs ?? 2000
  const timeoutMs = options.timeoutMs ?? 60000
  const start = Date.now()

  return new Promise<OrderStatus>((resolve, reject) => {
    const tick = async () => {
      try {
        const status = await getOrderStatus(orderId)
        if (status.status === 'paid' || status.status === 'failed') {
          resolve(status)
          return
        }
        if (Date.now() - start >= timeoutMs) {
          resolve(status)
          return
        }
        setTimeout(tick, intervalMs)
      } catch (error) {
        reject(error)
      }
    }
    tick()
  })
}