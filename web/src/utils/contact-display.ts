import { HttpError } from '@/api/client'
import type { ContactChannel, ContactRequest, MyContacts } from '@/api/types-social'

export const contactChannels: ContactChannel[] = ['wechat', 'qq', 'phone']
export function channelLabel(channel: ContactChannel): string {
  return { wechat: '微信', qq: 'QQ', phone: '手机' }[channel]
}
export function channelList(channels: ContactChannel[]): string { return channels.map(channelLabel).join('、') }
export function contactStatusLabel(status: ContactRequest['status']): string {
  return { pending: '等待本人回应', accepted: '已批准所选渠道，读取时仍需验证', declined: '已拒绝，不可读取', revoked: '已撤回或失效，不可读取' }[status]
}
export function canRespondContact(item: ContactRequest): boolean { return item.direction === 'incoming' && item.status === 'pending' }
export function canRevokeContact(item: ContactRequest): boolean {
  return ['incoming', 'outgoing'].includes(item.direction) && ['pending', 'accepted'].includes(item.status)
}
export function validateContacts(form: MyContacts): string {
  if (form.wechat?.trim() && !/^[a-zA-Z][a-zA-Z0-9_-]{5,19}$/.test(form.wechat.trim())) return '微信号需以字母开头，6–20 位字母、数字、下划线或短横线。'
  if (form.qq?.trim() && !/^[1-9]\d{4,11}$/.test(form.qq.trim())) return 'QQ 需为 5–12 位数字，首位不为 0。'
  if (form.phone?.trim() && !/^1[3-9]\d{9}$/.test(form.phone.trim())) return '手机号格式不符合要求。'
  return ''
}
// Never interpolate a private server response or input into error text.
export function contactErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    if (error.status === 401) return '游客会话已失效，请返回首页处理；本次操作没有重试。'
    if (error.status === 404) return '当前不可读取：未获批准、不属于本人或授权已失效。'
    if (error.status === 409) return '当前角色、关系或渠道状态冲突，请刷新；可拒绝后重新申请更小范围。'
    if (error.status === 422) return '输入不符合要求，请检查渠道格式和所选范围。'
  }
  return fallback
}
