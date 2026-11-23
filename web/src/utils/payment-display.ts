import type { Entitlement, PaymentAvailability } from '@/api/payment'

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

export type OrderTone = 'pending' | 'paid' | 'failed' | 'unknown'

/** 服务端新增状态时保留原值展示，避免前端因未知枚举崩溃 */
export function orderStatusLabel(status: string): string {
  return ({ pending: '待支付', paid: '已支付', failed: '支付失败' } as Record<string, string>)[status] || `未知状态 ${status}`
}

export function orderTone(status: string): OrderTone {
  return status === 'pending' || status === 'paid' || status === 'failed' ? status : 'unknown'
}

export function orderStatusHint(status: string): string {
  switch (orderTone(status)) {
    case 'pending': return '订单仍待支付；创建订单不会自动获得权益。'
    case 'paid': return '支付已完成，商品权益已解锁。'
    case 'failed': return '支付失败，该订单已结束，可重新选择商品下单。'
    default: return '该状态暂不支持自助操作，请刷新或联系支持。'
  }
}

/** 已支付与已失败都不会再变化，避免无意义轮询 */
export function isTerminalOrder(status: string): boolean {
  return status === 'paid' || status === 'failed'
}

export function paymentAvailabilityLabel(value: PaymentAvailability): string {
  return value === 'unconfigured' ? '支付通道未配置，暂不可发起支付' : '受控测试通道'
}
