// Controlled test fixtures copied from PR20 a39d99cf constants/payment.ts.
// These are not production commercial prices or a promise of generation/fulfillment.
export const MBTI_PRODUCTS = Object.freeze([
  Object.freeze({ code: "studio_tier_1", name: "MBTI 晒图套装", description: "成图 + 头像 + 相处卡 + 配文",
    amount: 990, currency: "CNY", saleable: true, pricing_mode: "controlled_test_fixture",
    highlights: ["朋友圈 MBTI 海报", "同款人格头像", "相处卡与发圈文案"], tier: 1 }),
  Object.freeze({ code: "studio_tier_2", name: "本人形象套装", description: "全部内容 + 本人照片风格方案",
    amount: 1990, currency: "CNY", saleable: false, pricing_mode: "controlled_test_fixture",
    unavailable_reason: "FULFILLMENT_UNCONFIGURED", highlights: ["包含晒图套装全部内容", "本人照片风格方案（本机预览）"], tier: 2 })
]);
