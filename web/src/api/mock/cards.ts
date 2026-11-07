// TODO: 待 Remy 确认接口路径和字段（后端未开发，当前用 mock 数据支撑页面演示）
import type { CardManual, CardStyle, CardVisibility, MyCard, PublicCard } from '../types-social'
import { DECLARATIONS, TYPE_NAMES } from '../../constants/types'
import { loadProfile } from '../../store/profile'
import { listResults } from './store'
import { DEFAULT_VISIBILITY, loadOverrides, saveOverrides, type CardOverrides } from './social-state'

function buildManual(typeCode: string): CardManual | undefined {
  if (!typeCode || typeCode.length !== 4) return undefined
  return {
    recharge:
      typeCode[0] === 'I'
        ? '独处一会儿再出发，允许我慢慢恢复电量。'
        : '和熟悉的人一起活动，可能更容易让我恢复电量。',
    communication:
      typeCode[2] === 'F'
        ? '先理解感受，再一起讨论下一步。'
        : '把事实和需求说清楚，一起看可行的办法。',
    care:
      typeCode[3] === 'J'
        ? '重要安排提前说，我更容易安心。'
        : '留一点调整空间，我更容易投入。',
  }
}

async function latestSummary() {
  try {
    const res = await listResults({ limit: 1 })
    return res.items[0] || null
  } catch {
    return null
  }
}

export async function getMyCard(): Promise<MyCard> {
  const [latest, overrides] = await Promise.all([
    latestSummary(),
    Promise.resolve(loadOverrides()),
  ])
  const profile = loadProfile()
  const typeCode = overrides.type_code || latest?.type_code || ''
  const nickname = overrides.nickname ?? (profile.name.trim() || '小禾')
  return {
    id: 'card_me',
    nickname,
    type_code: typeCode,
    type_name: TYPE_NAMES[typeCode] || '',
    declaration: overrides.declaration ?? DECLARATIONS[typeCode] ?? '',
    interests: overrides.interests ?? profile.interests.slice(0, 3),
    style: overrides.style || 'illustration',
    visibility: { ...DEFAULT_VISIBILITY, ...(overrides.visibility || {}) },
    has_visual_set: false,
    latest_result_id: latest?.id,
    updated_at: latest?.submitted_at || new Date().toISOString(),
  }
}

export async function updateMyCard(body: {
  nickname?: string
  type_code?: string
  declaration?: string
  interests?: string[]
  style?: CardStyle
  visibility?: Partial<CardVisibility>
}): Promise<MyCard> {
  const current = loadOverrides()
  const patch: CardOverrides = { ...current }
  if (body.nickname !== undefined) patch.nickname = body.nickname
  if (body.type_code !== undefined) patch.type_code = body.type_code
  if (body.declaration !== undefined) patch.declaration = body.declaration
  if (body.interests !== undefined) patch.interests = body.interests
  if (body.style !== undefined) patch.style = body.style
  if (body.visibility !== undefined) {
    patch.visibility = { ...DEFAULT_VISIBILITY, ...(current.visibility || {}), ...body.visibility }
  }
  saveOverrides(patch)
  return getMyCard()
}

export async function getPublicCard(cardId: string): Promise<PublicCard> {
  const card = await getMyCard()
  return {
    id: cardId,
    nickname: card.visibility.name ? card.nickname : '匿名搭子',
    type_code: card.type_code,
    type_name: card.type_name,
    declaration: card.visibility.declaration ? card.declaration : '',
    interests: card.visibility.interests ? card.interests : [],
    style: card.style,
    manual: card.visibility.manual ? buildManual(card.type_code) : undefined,
  }
}