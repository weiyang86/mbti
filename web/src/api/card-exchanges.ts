// TODO: 待 Remy 确认接口路径和字段（后端未开发，当前用 mock 数据支撑页面演示）
import { request, useMock } from './client'
import type { CardExchange } from './types-social'
import * as mock from './mock/card-exchanges'

export function listCardExchanges() {
  if (useMock()) return mock.listCardExchanges()
  return request<{ items: CardExchange[] }>('/card-exchanges')
}

export function createCardExchange(body: { buddy_id: string }) {
  if (useMock()) return mock.createCardExchange(body)
  return request<CardExchange>('/card-exchanges', { method: 'POST', data: body })
}

export function respondCardExchange(exchangeId: string, action: 'accept' | 'decline') {
  if (useMock()) return mock.respondCardExchange(exchangeId, action)
  return request<CardExchange>(`/card-exchanges/${encodeURIComponent(exchangeId)}/respond`, {
    method: 'POST',
    data: { action },
  })
}

export function revokeCardExchange(exchangeId: string) {
  if (useMock()) return mock.revokeCardExchange(exchangeId)
  return request<void>(`/card-exchanges/${encodeURIComponent(exchangeId)}`, {
    method: 'DELETE',
  })
}
