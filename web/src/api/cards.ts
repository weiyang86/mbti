import { request } from './client'
import type { CardStyle, CardVisibility, MyCard, PublicCard } from './types-social'

export interface UpdateCardBody {
  nickname?: string
  type_code?: string
  declaration?: string
  interests?: string[]
  style?: CardStyle
  visibility?: Partial<CardVisibility>
  discoverable?: boolean
}
export function getMyCard() { return request<MyCard>('/cards/me') }
export function updateMyCard(body: UpdateCardBody) {
  return request<MyCard>('/cards/me', { method: 'PUT', data: body })
}
export function getPublicCard(cardId: string) {
  return request<PublicCard>(`/cards/${encodeURIComponent(cardId)}`)
}
