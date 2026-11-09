import type { OrderStatusValue, PaymentAvailability } from '@/api/payment'

export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${(amount / 100).toFixed(2)}`
}

export function orderStatusLabel(status: OrderStatusValue): string {
  return ({ pending: '待支付', paid: '已支付', failed: '支付失败' })[status] || status
}

export function paymentAvailabilityLabel(value: PaymentAvailability): string {
  return value === 'unconfigured' ? '支付通道未配置，暂不可发起支付' : '受控测试通道'
}
