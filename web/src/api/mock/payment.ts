// TODO: 待 Remy 确认接口路径和字段（后端支付接口未开发，当前用 mock 数据支撑页面演示）
import type { CreateOrderBody, Order, OrderStatus, OrderStatusValue } from '../payment'
import { PAYMENT_PRODUCTS } from '../../constants/payment'
import { applyPaidOrder, studio } from '../../store/studio'

const ORDERS_KEY = 'mbti_mock_payment_orders_v1'

interface MockOrderRecord {
  id: string
  result_id: string
  product_code: string
  amount: number
  created_at: string
  status: OrderStatusValue
  /** 被查询次数，用于模拟异步支付：第 2 次轮询后改为最终态 */
  polls: number
  paid_at?: string
}

function loadOrders(): MockOrderRecord[] {
  try {
    const raw = uni.getStorageSync(ORDERS_KEY)
    if (Array.isArray(raw)) return raw as MockOrderRecord[]
  } catch {
    /* ignore */
  }
  return []
}

let orders = loadOrders()

function persistOrders() {
  try {
    uni.setStorageSync(ORDERS_KEY, orders)
  } catch {
    /* ignore */
  }
}

function uid() {
  return `ORD_${Date.now().toString(36).toUpperCase()}_${Math.random()
    .toString(36)
    .slice(2, 6)
    .toUpperCase()}`
}

export function createOrder(body: CreateOrderBody): Promise<Order> {
  const product =
    PAYMENT_PRODUCTS[body.product_code] ||
    PAYMENT_PRODUCTS[body.product_code.replace(/_fail$/, '')]
  if (!product) {
    return Promise.reject({ code: 'invalid_product', message: 'unknown product_code' })
  }
  // 模拟服务端按已购权益计价：已有晒图套装时，本人形象套装只收 ¥10 补差
  const upgrade = product.tier === 2 && studio.tier === 1
  const record: MockOrderRecord = {
    id: uid(),
    result_id: body.result_id,
    product_code: body.product_code,
    amount: upgrade ? 1000 : product.amount,
    created_at: new Date().toISOString(),
    status: 'pending',
    polls: 0,
  }
  orders = [record, ...orders]
  persistOrders()
  return Promise.resolve(toOrder(record))
}

function toOrder(record: MockOrderRecord): Order {
  return {
    id: record.id,
    result_id: record.result_id,
    product_code: record.product_code,
    amount: record.amount,
    currency: 'CNY',
    status: record.status,
    unlocked: record.status === 'paid',
    created_at: record.created_at,
    paid_at: record.paid_at,
    pay_params:
      record.status === 'pending'
        ? {
            appId: 'wx_mock_appid',
            timeStamp: String(Date.now()),
            nonceStr: 'mocknonce',
            package: `prepay_id=mock_${record.id}`,
            signType: 'RSA',
            paySign: 'mock_sign',
          }
        : undefined,
  }
}

export function getOrderStatus(orderId: string): Promise<OrderStatus> {
  const record = orders.find((o) => o.id === orderId)
  if (!record) {
    return Promise.reject({ code: 'not_found', message: 'order not found' })
  }

  // 模拟异步支付：第 2 次查询时落最终态；product_code 以 _fail 结尾时模拟失败
  if (record.status === 'pending') {
    record.polls += 1
    if (record.polls >= 2) {
      const failed = record.product_code.endsWith('_fail')
      record.status = failed ? 'failed' : 'paid'
      if (!failed) {
        record.paid_at = new Date().toISOString()
        const product = PAYMENT_PRODUCTS[record.product_code]
        if (product) {
          applyPaidOrder({
            id: record.id,
            product_code: record.product_code,
            tier: product.tier,
            amountYuan: record.amount / 100,
            paid_at: record.paid_at,
          })
        }
      }
      persistOrders()
    }
  }

  return Promise.resolve({
    order_id: record.id,
    status: record.status,
    unlocked: record.status === 'paid',
    paid_at: record.paid_at,
  })
}

export function resetPaymentMock() {
  orders = []
  persistOrders()
}