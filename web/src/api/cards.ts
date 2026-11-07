// TODO: 待 Remy 确认接口路径和字段（后端未开发，当前用 mock 数据支撑页面演示）
import { request, useMock } from './client'
import type { CardStyle, CardVisibility, MyCard, PublicCard } from './types-social'
import * as mock from './mock/cards'

export interface UpdateCardBody {
  nickname?: string
  type_code?: string
  declaration?: string
  interests?: string[]
  style?: CardStyle
  visibility?: Partial<CardVisibility>
}

export function getMyCard() {
  if (useMock()) return mock.getMyCard()
  return request<MyCard>('/cards/me')
}

export function updateMyCard(body: UpdateCardBody) {
  if (useMock()) return mock.updateMyCard(body)
  return request<MyCard>('/cards/me', { method: 'PUT', data: body })
}

export function getPublicCard(cardId: string) {
  if (useMock()) return mock.getPublicCard(cardId)
  return request<PublicCard>(`/cards/${encodeURIComponent(cardId)}`)
}
