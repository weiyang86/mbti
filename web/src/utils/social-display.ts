import { HttpError, requestErrorMessage } from '@/api/client'
import type { CardExchange, ExchangeStatus } from '@/api/types-social'

export function exchangeStatusLabel(status: ExchangeStatus): string {
  return { none: '尚未交换', pending: '等待回应', accepted: '已互换名片', declined: '已拒绝', revoked: '已撤回' }[status]
}
/** 联调/测试账号不展示内部昵称，按 id 稳定映射成演示用简称，避免演示页出现「联调A」这类名字 */
const INTERNAL_NICKNAME = /联调|测试|test|demo/i
const DEMO_NAMES = ['小鱼', '木木', '润润', '阿森', '小乔', '林间', '小畅', '阿岚', '小满', '小野']
function nameHash(text: string) {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) % 100000
  return hash
}
export function displayBuddyName(nickname: string | undefined, seed = ''): string {
  const name = (nickname || '').trim()
  if (!name) return '匿名搭子'
  if (!INTERNAL_NICKNAME.test(name)) return name
  return DEMO_NAMES[nameHash(seed || name) % DEMO_NAMES.length]
}
/** 头像方块配色：按记录 id 稳定取一组柔和底色，避免整列表都用同一深灰色 */
const AVATAR_TINTS = [
  { bg: '#e8f0d8', fg: '#4c6b34' },
  { bg: '#e9e0f7', fg: '#5b47a8' },
  { bg: '#fbe6d4', fg: '#8a5a33' },
  { bg: '#dfe9f7', fg: '#3f5a7a' },
  { bg: '#f6e1e6', fg: '#8a4657' },
  { bg: '#fdf0d5', fg: '#7a5c22' },
]
export function avatarTint(seed: string) {
  return AVATAR_TINTS[nameHash(seed || 'mbti') % AVATAR_TINTS.length]
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
