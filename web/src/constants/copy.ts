import { reactive } from 'vue'

/** Page titles. Kept as one editable table until the backend contract covers per-page copy. */
export const PAGE_TITLES: Record<string, string> = reactive({
  'pages/index/index': 'MBTI搭子',
  'pages/test-intro/test-intro': 'MBTI 趣味测试',
  'pages/quiz/quiz': '12 题 MBTI 趣味测试',
  'pages/self-select/self-select': '选择已有 MBTI',
  'pages/result/result': '我的 MBTI 结果',
  'pages/pricing/pricing': '我的 MBTI 晒图套装',
  'pages/create/create': '形象工作台',
  'pages/generating/generating': '制作我的 MBTI 形象',
  'pages/card/card': '我的 MBTI 名片',
  'pages/share-preview/share-preview': '晒出我的 MBTI',
  'pages/card/public': '亮出我的名片',
  'pages/discover/discover': '交换 MBTI 名片',
  'pages/buddies/detail': '搭子名片',
  'pages/contacts/contacts': '我的交换资料',
  'pages/contact-request/contact-request': '双向确认交换',
  'pages/contact-request/granted': '双向确认交换',
  'pages/exchanges/exchanges': '我的名片夹',
  'pages/radar/radar': '同型雷达',
  'pages/compat/compat': 'MBTI 相处小抄',
  'pages/account/account': '我的',
  'pages/video/video': '视频分镜预览',
  'pages/history/list': '我的 MBTI 轨迹',
  'pages/history/detail': '阶段记录',
  'pages/compare/compare': '两次结果对比',
  'pages/journey-share/journey-share': '我的阶段分享图',
  'pages/orders/orders': '我的订单',
  'pages/order-status/order-status': '订单状态',
  'pages/buddies/blocked': '管理屏蔽列表',
})

/** Business parameters kept in one place; the backend may override them once the contract is approved. */
export const LIMITS = reactive({
  recentResults: 50,
  discovery: 20,
  interests: 3,
  nickname: 12,
  questionCount: 12,
})

/** 本地体验条文案；生产构建默认不展示。 */
export const DEMO_COPY = reactive({
  badge: 'V0.4 · 在线体验版',
  link: '了解更多 ↗',
  stateToast: '当前为在线体验版',
  radarDemoCount: '位同型参与者',
})

/** Generation page copy, kept central until a backend copy category is approved. */
export const GENERATION_COPY = reactive({
  title: '正在准备你的 MBTI 晒图套装',
  subtitle: '组合个人信息与预置 AI 视觉素材',
  steps: ['01 · 排好我的人格主图', '02 · 准备同款头像与相处卡', '03 · 整理分享配文'],
  doneToast: '晒图套装已准备好',
})

/** Video storyboard titles, index-aligned with the three scenes. */
export const VIDEO_COPY = reactive({
  titles: ['我的 MBTI 有了新形象', '同一种类型，不同的我', '先交换名片，再认识彼此'],
})

/** Journey share page copy. */
export const JOURNEY_COPY = reactive({
  emptyTitle: '还没有两份可比较的记录',
  titleLines: ['每一面的我，', '都值得留一张。'],
  posterDisclaimer: '趣味复测记录，不代表人格已改变',
  captionLead: '每一面的我，都值得记录。',
  captionDisclaimer: '趣味复测结果，不代表人格已改变。',
})
