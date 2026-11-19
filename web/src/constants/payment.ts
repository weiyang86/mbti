export interface PaymentProduct {
  code: string
  name: string
  description: string
  /** 金额，单位：分（¥9.9 = 990） */
  amount: number
  highlights: string[]
  /** 对应 studio 套餐档位 */
  tier: 1 | 2
}

export const PAYMENT_PRODUCTS: Record<string, PaymentProduct> = {
  studio_tier_1: {
    code: 'studio_tier_1',
    name: 'MBTI 晒图套装',
    description: '成图 + 头像 + 相处卡 + 配文',
    amount: 990,
    highlights: ['朋友圈 MBTI 海报', '同款人格头像', '相处卡与发圈文案'],
    tier: 1,
  },
  studio_tier_2: {
    code: 'studio_tier_2',
    name: '本人形象套装',
    description: '全部内容 + 本人照片风格方案',
    amount: 1990,
    highlights: ['包含晒图套装全部内容', '本人照片风格方案（本机预览）'],
    tier: 2,
  },
}