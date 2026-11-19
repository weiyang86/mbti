import { request } from './client'
import type { CardExchange } from './types-social'

export function listCardExchanges() { return request<{ items: CardExchange[] }>('/card-exchanges') }
export function createCardExchange(body: { buddy_id: string }) {
  return request<CardExchange>('/card-exchanges', { method: 'POST', data: body })
}
export function respondCardExchange(id: string, action: 'accept' | 'decline') {
  return request<CardExchange>(`/card-exchanges/${encodeURIComponent(id)}/respond`, { method: 'POST', data: { action } })
}
export function revokeCardExchange(id: string) {
  return request<void>(`/card-exchanges/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
