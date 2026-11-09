// Projection of MbtiOrdersService.payload, not a new API contract.
export interface OpsOrder {
  id: string
  result_id: string
  product_code: string
  amount: number
  currency: string
  status: string
  unlocked: boolean
  created_at: string
  paid_at?: string
  payment_availability: string
  pricing_mode: string
}

export function normalizeOrderId(input: string): string {
  const id = input.trim()
  if (!id) throw new Error('请输入完整订单号。')
  // Keep case and the exact identifier; never silently remove internal characters.
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
    throw new Error('订单号限 1–128 位字母、数字、短横线或下划线，请勿输入网址或其他字符。')
  }
  return id
}

export function orderPath(input: string): string {
  return `/admin/mbti/orders/${encodeURIComponent(normalizeOrderId(input))}`
}

export function projectOrder(value: unknown, expectedId: string): OpsOrder {
  const invalid = () => { throw new Error('订单响应格式不正确，请重试或联系维护人员。') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const row = value as Record<string, unknown>
  const identifier = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v)
  const code = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(v)
  const timestamp = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
  if (row.id !== expectedId || !identifier(row.id, 128) || !identifier(row.result_id, 128) || !identifier(row.product_code, 64) ||
    typeof row.amount !== 'number' || !Number.isSafeInteger(row.amount) || row.amount < 0 ||
    typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency) || !code(row.status) ||
    typeof row.unlocked !== 'boolean' || !timestamp(row.created_at) ||
    (row.paid_at !== undefined && !timestamp(row.paid_at)) || !code(row.payment_availability) || !code(row.pricing_mode)) return invalid()

  // Only these public business fields may enter component state. No raw JSON fallback.
  return {
    id: row.id, result_id: row.result_id, product_code: row.product_code, amount: row.amount,
    currency: row.currency, status: row.status, unlocked: row.unlocked, created_at: row.created_at,
    ...(row.paid_at === undefined ? {} : { paid_at: row.paid_at as string }),
    payment_availability: row.payment_availability, pricing_mode: row.pricing_mode,
  }
}

export function orderStatus(status: string): string {
  const labels: Record<string, string> = { pending: '待支付', paid: '已支付', failed: '支付失败', closed: '已关闭', cancelled: '已取消', refunded: '已退款' }
  return labels[status] || '未识别状态'
}

export function orderTime(timestamp?: string): string {
  if (!timestamp) return '接口未返回'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp))
}
