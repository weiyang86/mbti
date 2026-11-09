import { HttpError, requestErrorMessage } from '@/api/client'
import type { CardExchange, ExchangeStatus } from '@/api/types-social'

export function exchangeStatusLabel(status: ExchangeStatus): string {
  return { none: '尚未交换', pending: '等待回应', accepted: '已互换名片', declined: '已拒绝', revoked: '已撤回' }[status]
}
export function canRespond(item: CardExchange): boolean {
  return item.direction === 'incoming' && item.status === 'pending'
}
export function canRevoke(item: CardExchange): boolean {
  return item.direction === 'outgoing' && (item.status === 'pending' || item.status === 'accepted')
}
export function socialErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    if (error.status === 404) return '这张名片或关系当前不可查看，请刷新列表。'
    if (error.status === 409) return '操作与当前角色或状态冲突，请刷新后查看最新状态。'
    if (error.status === 422) return `输入不符合要求：${error.message}`
  }
  return requestErrorMessage(error, fallback)
}
