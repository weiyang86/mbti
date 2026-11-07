import type {
  CardExchange,
  CardStyle,
  CardVisibility,
  ContactRequest,
  MyContacts,
} from '../types-social'

const SOCIAL_KEY = 'mbti_mock_social_v1'
const CARD_KEY = 'mbti_mock_card_v1'

export interface SocialState {
  exchanges: CardExchange[]
  contactRequests: ContactRequest[]
  contacts: MyContacts
  blocked: string[]
}

export interface CardOverrides {
  nickname?: string
  type_code?: string
  declaration?: string
  interests?: string[]
  style?: CardStyle
  visibility?: CardVisibility
}

export const DEFAULT_VISIBILITY: CardVisibility = {
  name: true,
  interests: true,
  declaration: true,
  manual: true,
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function loadSocial(): SocialState {
  try {
    const raw = uni.getStorageSync(SOCIAL_KEY)
    if (raw && typeof raw === 'object') {
      return {
        exchanges: Array.isArray(raw.exchanges) ? raw.exchanges : [],
        contactRequests: Array.isArray(raw.contactRequests) ? raw.contactRequests : [],
        contacts:
          raw.contacts && typeof raw.contacts === 'object' ? (raw.contacts as MyContacts) : {},
        blocked: Array.isArray(raw.blocked) ? raw.blocked : [],
      }
    }
  } catch {
    /* ignore */
  }
  return { exchanges: [], contactRequests: [], contacts: {}, blocked: [] }
}

let social = loadSocial()

export function getSocial(): SocialState {
  return social
}

export function persistSocial() {
  try {
    uni.setStorageSync(SOCIAL_KEY, social)
  } catch {
    /* ignore */
  }
}

export function resetSocialMock() {
  social = { exchanges: [], contactRequests: [], contacts: {}, blocked: [] }
  persistSocial()
  try {
    uni.removeStorageSync(CARD_KEY)
  } catch {
    /* ignore */
  }
}

export function loadOverrides(): CardOverrides {
  try {
    const raw = uni.getStorageSync(CARD_KEY)
    if (raw && typeof raw === 'object') {
      return raw as CardOverrides
    }
  } catch {
    /* ignore */
  }
  return {}
}

export function saveOverrides(patch: CardOverrides) {
  try {
    uni.setStorageSync(CARD_KEY, { ...loadOverrides(), ...patch })
  } catch {
    /* ignore */
  }
}

/** 某搭子最近一次未撤销的名片交换记录 */
export function latestExchange(buddyId: string) {
  return getSocial()
    .exchanges.filter((e) => e.buddy_id === buddyId && e.status !== 'revoked')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
}