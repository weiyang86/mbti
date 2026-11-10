import { projectOrder, type OpsOrder } from './ops-order'

export interface OrderFilters { q?: string; status?: string; product_code?: string; from?: string; to?: string; limit?: string; cursor?: string }
export interface OrderPage { items: OpsOrder[]; next_cursor: string | null }
export interface OrderSummary {
  interval: { from: string; to: string; startInclusive: string; endExclusive: string; dateBasis: string; boundaryTimezone: string; displayTimezone: string }
  metrics: { pending: number; paid: number; failed: number; paidOrderCount: number; grossPaidAmountFen: number | null; currency: string | null; grossPaidByCurrency: { currency: string; amountFen: number; paidOrderCount: number }[] } | null
  netCollectedFen: null; refundsUnavailable: true; channelAttributionUnavailable: true; unavailableReason: string | null
}
export function orderQuery(filters: OrderFilters | { from: string; to: string; channel: string }): string {
  const values = Object.entries(filters).filter(([, value]) => value !== undefined && value !== '')
  return values.length ? '?' + values.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value!)}`).join('&') : ''
}
export function projectOrderPage(value: unknown): OrderPage {
  const row = value as OrderPage
  if (!row || !Array.isArray(row.items) || row.items.length > 100 || row.next_cursor !== null && (typeof row.next_cursor !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(row.next_cursor))) throw new Error('Invalid order page')
  return { items: row.items.map(item => projectOrder(item, item?.id)), next_cursor: row.next_cursor }
}
export function projectOrderSummary(value: unknown): OrderSummary {
  const row = value as OrderSummary
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  if (!row || row.netCollectedFen !== null || row.refundsUnavailable !== true || row.channelAttributionUnavailable !== true ||
    row.interval?.boundaryTimezone !== 'UTC' || row.interval.displayTimezone !== 'Asia/Shanghai' || row.interval.dateBasis !== 'order_created_at' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.interval.from) || !/^\d{4}-\d{2}-\d{2}$/.test(row.interval.to) ||
    !Number.isFinite(Date.parse(row.interval.startInclusive)) || !Number.isFinite(Date.parse(row.interval.endExclusive))) throw new Error('Invalid summary')
  const m = row.metrics
  if (m !== null && (!m || ![m.pending, m.paid, m.failed, m.paidOrderCount].every(count) || m.paid !== m.paidOrderCount ||
    m.grossPaidAmountFen !== null && !count(m.grossPaidAmountFen) || m.currency !== null && !/^[A-Z]{3}$/.test(m.currency) ||
    !Array.isArray(m.grossPaidByCurrency) || m.grossPaidByCurrency.some(g => !g || !/^[A-Z]{3}$/.test(g.currency) || !count(g.amountFen) || !count(g.paidOrderCount)))) throw new Error('Invalid summary')
  if (m === null ? row.unavailableReason !== 'channel_attribution_unavailable' : row.unavailableReason !== null) throw new Error('Invalid summary availability')
  const i = row.interval
  return { interval: { from: i.from, to: i.to, startInclusive: i.startInclusive, endExclusive: i.endExclusive, dateBasis: i.dateBasis, boundaryTimezone: i.boundaryTimezone, displayTimezone: i.displayTimezone },
    metrics: m === null ? null : { pending: m.pending, paid: m.paid, failed: m.failed, paidOrderCount: m.paidOrderCount, grossPaidAmountFen: m.grossPaidAmountFen, currency: m.currency, grossPaidByCurrency: m.grossPaidByCurrency.map(g => ({ currency: g.currency, amountFen: g.amountFen, paidOrderCount: g.paidOrderCount })) },
    netCollectedFen: null, refundsUnavailable: true, channelAttributionUnavailable: true, unavailableReason: row.unavailableReason }
}
