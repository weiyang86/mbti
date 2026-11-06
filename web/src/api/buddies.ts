// TODO: 待 Remy 确认接口路径和字段（后端未开发，当前用 mock 数据支撑页面演示）
import { request, useMock } from './client'
import type { BuddyDetail, BuddySummary } from './types-social'
import * as mock from './mock/buddies'

export function listBuddies(params?: {
  mode?: 'recommend' | 'same'
  type_code?: string
  limit?: number
}) {
  if (useMock()) return mock.listBuddies(params)
  const q = new URLSearchParams()
  if (params?.mode) q.set('mode', params.mode)
  if (params?.type_code) q.set('type_code', params.type_code)
  if (params?.limit) q.set('limit', String(params.limit))
  const suffix = q.toString() ? `?${q.toString()}` : ''
  return request<{ items: BuddySummary[] }>(`/buddies${suffix}`)
}

export function getBuddy(buddyId: string) {
  if (useMock()) return mock.getBuddy(buddyId)
  return request<BuddyDetail>(`/buddies/${encodeURIComponent(buddyId)}`)
}

export function blockBuddy(buddyId: string) {
  if (useMock()) return mock.blockBuddy(buddyId)
  return request<{ blocked: boolean }>(`/buddies/${encodeURIComponent(buddyId)}/block`, {
    method: 'POST',
  })
}

export function unblockBuddy(buddyId: string) {
  if (useMock()) return mock.unblockBuddy(buddyId)
  return request<void>(`/buddies/${encodeURIComponent(buddyId)}/block`, { method: 'DELETE' })
}

export function listBlockedBuddies() {
  if (useMock()) return mock.listBlockedBuddies()
  return request<{ items: BuddySummary[] }>('/buddies/blocked')
}
