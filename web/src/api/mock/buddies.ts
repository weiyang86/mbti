// TODO: 待 Remy 确认接口路径和字段（后端未开发，当前用 mock 数据支撑页面演示）
import type { BuddyDetail, BuddySummary } from '../types-social'
import { TYPE_NAMES } from '../../constants/types'
import { loadProfile } from '../../store/profile'
import { getMyCard } from './cards'
import { getSocial, latestExchange, persistSocial } from './social-state'

interface BuddySeed {
  id: string
  nickname: string
  glyph: string
  interests: string[]
  tagline: string
  color: string
}

const BUDDY_SEEDS: BuddySeed[] = [
  {
    id: 'mori',
    nickname: '阿森',
    glyph: '森',
    interests: ['摄影', '散步'],
    tagline: '一起发现日常里的小风景',
    color: '#e3e9d5',
  },
  {
    id: 'qiao',
    nickname: '小乔',
    glyph: '乔',
    interests: ['阅读', '咖啡'],
    tagline: '把周末留给一本书和一杯咖啡',
    color: '#ece2f4',
  },
  {
    id: 'yu',
    nickname: '小鱼',
    glyph: '鱼',
    interests: ['电影', '音乐'],
    tagline: '想找一起看展和听歌的搭子',
    color: '#f7e6d5',
  },
  {
    id: 'lin',
    nickname: '林间',
    glyph: '林',
    interests: ['阅读', '游戏'],
    tagline: '认真做事，也认真安排休息',
    color: '#dfe8f5',
  },
  {
    id: 'mu',
    nickname: '木木',
    glyph: '木',
    interests: ['摄影', '咖啡'],
    tagline: '喜欢慢慢走，也喜欢随手拍',
    color: '#e7eadb',
  },
  {
    id: 'yang',
    nickname: '小杨',
    glyph: '杨',
    interests: ['运动', '游戏'],
    tagline: '尝试没做过的事，一起开个新副本',
    color: '#f3e0e7',
  },
]

function buddyType(seed: BuddySeed, myType: string): string {
  const base = myType || 'INFP'
  if (seed.id === 'mori' || seed.id === 'qiao') return base
  if (seed.id === 'yu') return base === 'ENFP' ? 'INFP' : 'ENFP'
  if (seed.id === 'lin') return 'INTJ'
  if (seed.id === 'mu') return 'ISFP'
  return 'ENTP'
}

function toSummary(seed: BuddySeed, myType: string, myInterests: string[]): BuddySummary {
  const type = buddyType(seed, myType)
  const shared = seed.interests.filter((i) => myInterests.includes(i))
  return {
    id: seed.id,
    nickname: seed.nickname,
    type_code: type,
    type_name: TYPE_NAMES[type] || 'MBTI',
    avatar_text: seed.glyph,
    avatar_color: seed.color,
    tagline: seed.tagline,
    interests: [...seed.interests],
    same_type: Boolean(myType) && type === myType,
    shared_interests: shared,
    exchange_status: latestExchange(seed.id)?.status || 'none',
    is_demo: true,
  }
}

function currentInterests(): string[] {
  return loadProfile().interests
}

export function listBuddies(params?: {
  mode?: 'recommend' | 'same'
  type_code?: string
  limit?: number
}): Promise<{ items: BuddySummary[] }> {
  const myType = params?.type_code || ''
  const myInterests = currentInterests()
  let items = BUDDY_SEEDS.filter((seed) => !getSocial().blocked.includes(seed.id)).map((seed) =>
    toSummary(seed, myType, myInterests),
  )
  if (params?.mode === 'same') {
    items = items.filter((item) => item.same_type)
  } else {
    items.sort((a, b) => b.shared_interests.length - a.shared_interests.length)
  }
  const limit = params?.limit ?? 20
  return Promise.resolve({ items: items.slice(0, limit) })
}

export async function getBuddy(buddyId: string): Promise<BuddyDetail> {
  const myCard = await getMyCard()
  const seed = BUDDY_SEEDS.find((item) => item.id === buddyId)
  if (!seed) {
    return Promise.reject({ code: 'not_found', message: 'buddy not found' })
  }
  if (getSocial().blocked.includes(buddyId)) {
    return Promise.reject({ code: 'not_found', message: 'buddy blocked' })
  }
  const summary = toSummary(seed, myCard.type_code, myCard.interests)
  return {
    ...summary,
    compatibility_hint: summary.same_type
      ? '同型，也有不同的相处方式。'
      : '不同的偏好，也能找到共同点。',
  }
}

export function blockBuddy(buddyId: string): Promise<{ blocked: boolean }> {
  const social = getSocial()
  if (!social.blocked.includes(buddyId)) {
    social.blocked.push(buddyId)
    persistSocial()
  }
  return Promise.resolve({ blocked: true })
}

export function unblockBuddy(buddyId: string): Promise<void> {
  const social = getSocial()
  social.blocked = social.blocked.filter((id) => id !== buddyId)
  persistSocial()
  return Promise.resolve()
}

export async function listBlockedBuddies(): Promise<{ items: BuddySummary[] }> {
  const myCard = await getMyCard()
  const items = BUDDY_SEEDS.filter((seed) => getSocial().blocked.includes(seed.id)).map((seed) =>
    toSummary(seed, myCard.type_code, myCard.interests),
  )
  return { items }
}

export { BUDDY_SEEDS, toSummary, currentInterests }