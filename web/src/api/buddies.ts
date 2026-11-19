import { request } from './client'
import type { BuddyDetail, BuddySummary } from './types-social'

export function listBuddies(params: { mode?: 'recommend' | 'same'; type_code?: string; limit?: number } = {}) {
  const query = new URLSearchParams()
  if (params.mode !== undefined) query.set('mode', params.mode)
  if (params.type_code !== undefined) query.set('type_code', params.type_code)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  return request<{ items: BuddySummary[] }>(`/buddies${query.toString() ? `?${query}` : ''}`)
}
export function listBlockedBuddies() { return request<{ items: BuddySummary[] }>('/buddies/blocked') }
export function getBuddy(id: string) { return request<BuddyDetail>(`/buddies/${encodeURIComponent(id)}`) }
export function blockBuddy(id: string) {
  return request<{ blocked: boolean }>(`/buddies/${encodeURIComponent(id)}/block`, { method: 'POST' })
}
export function unblockBuddy(id: string) {
  return request<void>(`/buddies/${encodeURIComponent(id)}/block`, { method: 'DELETE' })
}
