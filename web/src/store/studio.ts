import { reactive } from 'vue'
import { DECLARATIONS } from '@/constants/types'

export type StyleKey = 'illustration' | 'editorial' | 'game'
export type PlanTier = 1 | 2

export type OrderStatus = 'paid' | 'failed' | 'refunded'

export interface StudioOrder {
  id: string
  tier: PlanTier
  amount: number
  status: OrderStatus
  created_at: string
}

export interface StudioState {
  tier: 0 | PlanTier
  plan: PlanTier
  style: StyleKey
  nickname: string
  quote: string
  customQuote: string
  hasCard: boolean
  redeemed: string[]
  orders: StudioOrder[]
}

const KEY = 'mbti_studio_v1'

export const STUDIO_STYLES: { key: StyleKey; label: string; asset: string }[] = [
  { key: 'illustration', label: '梦境插画', asset: '/static/share-style-illustration.webp' },
  { key: 'editorial', label: '日常杂志', asset: '/static/share-style-editorial.webp' },
  { key: 'game', label: '未来角色', asset: '/static/share-style-game.webp' },
]

export const PLAN_NAMES: Record<PlanTier, string> = {
  1: 'MBTI 晒图套装',
  2: '本人形象套装',
}

const STYLE_KEYS: StyleKey[] = ['illustration', 'editorial', 'game']

const DEFAULTS: StudioState = {
  tier: 0,
  plan: 1,
  style: 'illustration',
  nickname: '',
  quote: '',
  customQuote: '',
  hasCard: false,
  redeemed: [],
  orders: [],
}

function load(): StudioState {
  try {
    const raw = uni.getStorageSync(KEY)
    if (raw && typeof raw === 'object') {
      const tier = raw.tier === 1 || raw.tier === 2 ? raw.tier : 0
      return {
        tier,
        plan: raw.plan === 2 ? 2 : 1,
        style: STYLE_KEYS.includes(raw.style) ? raw.style : 'illustration',
        nickname: typeof raw.nickname === 'string' ? raw.nickname : '',
        quote: typeof raw.quote === 'string' ? raw.quote : '',
        customQuote: typeof raw.customQuote === 'string' ? raw.customQuote : '',
        hasCard: Boolean(raw.hasCard),
        redeemed: Array.isArray(raw.redeemed)
          ? raw.redeemed.filter((i: unknown): i is string => typeof i === 'string')
          : [],
        orders: Array.isArray(raw.orders) ? raw.orders : [],
      }
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS }
}

export const studio = reactive<StudioState>(load())

export function saveStudio() {
  try {
    uni.setStorageSync(KEY, {
      tier: studio.tier,
      plan: studio.plan,
      style: studio.style,
      nickname: studio.nickname,
      quote: studio.quote,
      customQuote: studio.customQuote,
      hasCard: studio.hasCard,
      redeemed: [...studio.redeemed],
      orders: [...studio.orders],
    })
  } catch {
    /* ignore */
  }
}

export function styleAsset(style: StyleKey) {
  return STUDIO_STYLES.find((s) => s.key === style)?.asset || STUDIO_STYLES[0].asset
}

/** 与原型一致：当前类型宣言 + 两句通用宣言 */
export function quoteOptions(typeCode: string) {
  return [
    DECLARATIONS[typeCode] || '四个字母之外，还有不一样的我。',
    '四个字母之外，还有不一样的我。',
    '同一种类型，也有我自己的节奏。',
  ]
}

export function currentQuote(typeCode: string) {
  return studio.customQuote.trim() || studio.quote || quoteOptions(typeCode)[0]
}

export function choosePlan(tier: PlanTier) {
  studio.plan = tier
  saveStudio()
}

/** 模拟下单：一次购买、无自动续费，不产生真实扣款；失败订单只留档不解锁 */
export function purchasePlan(tier: PlanTier, success = true) {
  const upgrade = studio.tier === 1 && tier === 2
  const amount = upgrade ? 10 : tier === 1 ? 9.9 : 19.9
  const order: StudioOrder = {
    id: `MOCK-${Date.now().toString(36).toUpperCase()}`,
    tier,
    amount,
    status: success ? 'paid' : 'failed',
    created_at: new Date().toISOString(),
  }
  studio.orders.push(order)
  if (success) {
    studio.tier = studio.tier > tier ? studio.tier : tier
  }
  saveStudio()
  return order
}

/** 模拟售后：记录退款，并按剩余有效订单恢复权益 */
export function refundOrder(id: string) {
  const order = studio.orders.find((o) => o.id === id && o.status === 'paid')
  if (!order) return false
  order.status = 'refunded'
  studio.tier = studio.orders
    .filter((o) => o.status === 'paid')
    .reduce<0 | PlanTier>((max, o) => (o.tier > max ? o.tier : max), 0)
  saveStudio()
  return true
}

export function redeemCode(input: string) {
  const code = input.trim().toUpperCase()
  const tier: PlanTier | 0 = ['MBTI099A', 'SELF099A'].includes(code)
    ? 1
    : ['MBTI199B', 'SELF199B'].includes(code)
      ? 2
      : 0
  if (!tier) return { ok: false, message: '体验码无效，请检查后再试' }
  if (studio.redeemed.includes(code)) return { ok: false, message: '这个演示码已在本机使用' }
  if (studio.tier >= tier) return { ok: false, message: '已拥有该套装，无需重复兑换' }
  studio.redeemed.push(code)
  studio.orders.push({
    id: `MOCK-CODE-${Date.now().toString(36).toUpperCase()}`,
    tier,
    amount: 0,
    status: 'paid',
    created_at: new Date().toISOString(),
  })
  studio.tier = tier
  saveStudio()
  return { ok: true, message: '模拟兑换成功' }
}

export function markCardReady() {
  studio.hasCard = true
  saveStudio()
}
