// F4 internal candidate; discoverable/direction and limits need human review before publication.
export type CardStyle = 'illustration' | 'editorial' | 'game'
export interface CardVisibility {
  name: boolean
  interests: boolean
  declaration: boolean
  manual: boolean
}
export interface CardManual { recharge: string; communication: string; care: string }
export interface PublicCard {
  id: string
  nickname: string
  type_code: string
  type_name: string
  declaration: string
  interests: string[]
  style: CardStyle
  manual?: CardManual
}
export interface MyCard extends Omit<PublicCard, 'manual'> {
  discoverable: boolean
  visibility: CardVisibility
  has_visual_set: boolean
  latest_result_id?: string
  updated_at: string
}
export type ExchangeStatus = 'none' | 'pending' | 'accepted' | 'declined' | 'revoked'
export interface BuddySummary {
  id: string
  nickname: string
  type_code: string
  type_name: string
  avatar_text: string
  avatar_color: string
  tagline: string
  interests: string[]
  same_type: boolean
  shared_interests: string[]
  exchange_status: ExchangeStatus
  is_demo: boolean
}
export interface BuddyDetail extends BuddySummary { compatibility_hint: string }
export interface CardExchange {
  id: string
  buddy_id: string
  buddy: BuddySummary
  direction: 'incoming' | 'outgoing'
  status: Exclude<ExchangeStatus, 'none'>
  created_at: string
  responded_at?: string
  simulated: boolean
}
