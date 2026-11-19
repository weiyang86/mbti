import type { Entitlement, OrderStatusValue, PaymentAvailability } from '@/api/payment'

export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${(amount / 100).toFixed(2)}`
}

/** 从服务端权益推导当前档位；不读取本机解锁缓存 */
export function entitledTier(items: Entitlement[]): 0 | 1 | 2 {
  return items.reduce<0 | 1 | 2>((max, item) => {
    const tier: 1 | 2 = /tier[_-]?2/i.test(`${item.kind} ${item.product_code}`) ? 2 : 1
    return tier > max ? tier : max
  }, 0)
}

export function orderStatusLabel(status: OrderStatusValue): string {
  return ({ pending: '待支付', paid: '已支付', failed: '支付失败' })[status] || status
}

export function paymentAvailabilityLabel(value: PaymentAvailability): string {
  return value === 'unconfigured' ? '支付通道未配置，暂不可发起支付' : '受控测试通道'
}
