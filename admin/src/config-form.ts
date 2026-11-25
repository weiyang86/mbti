// Form metadata for the server configuration panel. Paths mirror the candidate
// category shapes validated by the API; ids and fixed system fields stay read-only.
export type FieldType = 'text' | 'textarea' | 'number' | 'checkbox' | 'select' | 'tags' | 'numbers'
export interface FieldDef {
  path: string
  label: string
  type: FieldType
  max?: number
  min?: number
  maxValue?: number
  options?: { value: string | number | boolean; label: string }[]
  group?: string
  hint?: string
}
const channelNames: [string, string][] = [['wechat', '微信小程序'], ['mp', '公众号 H5'], ['douyin', '抖音小程序'], ['xhs', '小红书小程序']]
const landings = { home: '首页', pricing: '购买页', 'test-intro': '测试入口', discover: '换名片', history: '我的轨迹' }
const styleNames = { editorial: '杂志', illustration: '插画', game: '游戏' }
const dimensions = ['EI', 'SN', 'TF', 'JP'] as const
const personaCodes = ['E', 'I'].flatMap(a => ['S', 'N'].flatMap(b => ['T', 'F'].flatMap(c => ['J', 'P'].map(d => a + b + c + d))))
const pageTitles: [string, string][] = [
  ['pages/index/index', '首页'], ['pages/test-intro/test-intro', '测试入口'], ['pages/quiz/quiz', '答题页'],
  ['pages/self-select/self-select', '自选类型'], ['pages/result/result', '测试结果'], ['pages/pricing/pricing', '购买页'],
  ['pages/create/create', '形象工作台'], ['pages/generating/generating', '生成中'], ['pages/card/card', '我的名片'],
  ['pages/share-preview/share-preview', '分享预览'], ['pages/card/public', '公开名片'], ['pages/discover/discover', '发现搭子'],
  ['pages/buddies/detail', '搭子名片'], ['pages/contacts/contacts', '交换资料'], ['pages/contact-request/contact-request', '双向确认'],
  ['pages/contact-request/granted', '确认结果'], ['pages/exchanges/exchanges', '名片夹'], ['pages/radar/radar', '同型雷达'],
  ['pages/compat/compat', '相处小抄'], ['pages/account/account', '我的'], ['pages/video/video', '视频分镜'],
  ['pages/history/list', '我的轨迹'], ['pages/history/detail', '阶段记录'], ['pages/compare/compare', '结果对比'],
  ['pages/journey-share/journey-share', '阶段分享图'], ['pages/orders/orders', '我的订单'],
  ['pages/order-status/order-status', '订单状态'], ['pages/buddies/blocked', '屏蔽管理'],
]
const text = (path: string, label: string, max: number, long = false, group?: string): FieldDef => ({ path, label, type: long ? 'textarea' : 'text', max, group })
const number = (path: string, label: string, min: number, maxValue: number, group?: string): FieldDef => ({ path, label, type: 'number', min, maxValue, group })
const check = (path: string, label: string, group?: string): FieldDef => ({ path, label, type: 'checkbox', group })
const select = (path: string, label: string, options: Record<string, string | number>, group?: string): FieldDef => ({
  path, label, type: 'select', group,
  options: Object.entries(options).map(([value, text]) => ({ value: /^\d+$/.test(value) ? Number(value) : value, label: String(text) })),
})

export function fieldsFor(category: string): FieldDef[] {
  if (category === 'content') return [
    text('headline', '主标题', 26), text('accent', '强调语', 28), text('sub', '首屏说明', 80, true), text('cta', '免费测试按钮', 20),
    text('moments', '朋友圈场景标题', 100, true), text('avatar', '头像场景标题', 100, true),
    text('meet', '见面场景标题', 100, true), text('caption', '朋友圈默认配文', 100, true),
  ]
  if (category === 'channels') return channelNames.flatMap(([key, name]) => [
    text(`${key}.name`, '渠道名称', 30, false, name),
    select(`${key}.landing`, '打开后首个页面', landings, name),
    text(`${key}.badge`, '渠道首页栏目语', 26, false, name),
  ])
  if (category === 'catalog') return [
    ...['0', '1'].flatMap((index, i) => [
      text(`shop.${index}.title`, '商品名称', 24, false, `商品 ${i + 1}`),
      number(`shop.${index}.cents`, '售价（分）', 1, 999999, `商品 ${i + 1}`),
      text(`shop.${index}.desc`, '权益说明', 100, true, `商品 ${i + 1}`),
      check(`shop.${index}.on`, '在购买页上架', `商品 ${i + 1}`),
    ]),
    ...['0', '1', '2'].flatMap((index, i) => [
      text(`styles.${index}.title`, '风格名称', 16, false, `风格 ${i + 1}`),
      select(`styles.${index}.art`, '视觉素材', styleNames, `风格 ${i + 1}`),
      check(`styles.${index}.on`, '允许用户选择', `风格 ${i + 1}`),
      number(`styles.${index}.order`, '展示顺序', 1, 3, `风格 ${i + 1}`),
    ]),
  ]
  if (category === 'retention') return [
    { path: 'tags', label: '提醒标签', type: 'tags', hint: '用逗号分隔，1–10 个，每个最多 12 字', group: '留存' },
    { path: 'days', label: '提醒天数', type: 'numbers', hint: '用逗号分隔，1–3 个，范围 1–365', group: '留存' },
  ]
  if (category === 'discovery') return [
    select('order', '默认推荐顺序', { same: '先同型', recommend: '先推荐' }, '发现'),
    number('daily', '每日推荐数', 1, 30, '发现'),
    check('radar', '开启同型雷达', '发现'),
    select('radius', '雷达范围（米）', { 500: '500 米', 1000: '1000 米', 3000: '3000 米' }, '发现'),
    number('minimum', '雷达最少人数', 10, 200, '发现'),
  ]
  if (category === 'trade') return [
    number('ttl', '兑换码有效期（天）', 1, 120, '交易'),
    check('redeem', '允许兑换码', '交易'),
    select('selfRefund', '自助退款入口', { self: '用户自助', support: '联系客服' }, '交易'),
    number('refundDays', '退款期限（天）', 1, 30, '交易'),
  ]
  if (category === 'imageRecipes') return [
    select('recipe', '形象方案', { portrait: '人像优先', balanced: '均衡', style: '风格优先' }, '形象'),
  ]
  if (category === 'aiRuntime') return [
    { path: 'mode', label: '运行模式', type: 'text', hint: '当前固定为 UNCONFIGURED', group: '图像服务' },
    select('size', '生成尺寸', { '960*1280': '960×1280', '1024*1024': '1024×1024', '720*1280': '720×1280' }, '图像服务'),
    number('timeout', '超时（秒）', 20, 180, '图像服务'),
  ]
  if (category === 'payments') return channelNames.slice(0, 2).flatMap(([key, name]) => [
    check(`${key}.enabled`, '允许本渠道新下单', name),
    select(`${key}.mode`, '交易环境', { mock: '模拟 · 不扣款', live: '正式收款' }, name),
    text(`${key}.merchantLabel`, '收款方展示名（1–40 字）', 40, false, name),
    text(`${key}.appId`, 'AppID（wx 开头 18 位）', 64, false, name),
    text(`${key}.appSecretRef`, 'AppSecret 凭据引用', 256, false, name),
    text(`${key}.mchId`, '微信支付商户号 MchID', 64, false, name),
    text(`${key}.serialNo`, '商户证书序列号', 64, false, name),
    text(`${key}.publicKeyId`, '微信支付公钥 ID（PUB_KEY_ID_…）', 80, false, name),
    text(`${key}.notifyUrl`, '支付通知地址（HTTPS）', 240, false, name),
    text(`${key}.refundNotifyUrl`, '退款通知地址（HTTPS）', 240, false, name),
    text(`${key}.privateKeyRef`, '商户签名私钥引用', 256, false, name),
    text(`${key}.apiV3KeyRef`, 'APIv3 密钥引用', 256, false, name),
    text(`${key}.platformPublicKeyRef`, '微信支付验签公钥引用', 256, false, name),
  ])
  if (category === 'copy') return [
    { path: 'stages', label: '阶段选项', type: 'tags', hint: '用逗号分隔，1–20 项，每项最多 24 字', group: '测试选项' },
    { path: 'recentStatuses', label: '最近状态选项', type: 'tags', hint: '用逗号分隔，1–20 项，每项最多 24 字', group: '测试选项' },
    { path: 'interests', label: '兴趣选项', type: 'tags', hint: '用逗号分隔，1–30 项，每项最多 16 字', group: '测试选项' },
    number('maxInterests', '最多可选兴趣数', 1, 10, '测试选项'),
    text('compare.title', '对比页标题第一行', 40, false, '对比页'),
    text('compare.accent', '对比页标题第二行', 40, false, '对比页'),
    text('compare.description', '对比页说明', 160, true, '对比页'),
    text('compare.emptyTitle', '空态标题第一行', 40, false, '对比页'),
    text('compare.emptyAccent', '空态标题第二行', 40, false, '对比页'),
    text('compare.emptyDescription', '空态说明', 160, true, '对比页'),
    ...pageTitles.map(([route, label]) => text(`pages.${route}`, label, 30, false, '页面标题')),
  ]
  if (category === 'assessment') return [
    { path: 'question_bank_version', label: '题库版本', type: 'text', max: 96, group: '题库',
      hint: '改题干或选项文案，发布后答题立即生效；调整反转计分或题目结构必须升级版本号（历史版本不可变）' },
    ...dimensions.flatMap((dimension, d) => Array.from({ length: 3 }, (_, k) => {
      const index = d + k * 4, group = `第 ${index + 1} 题 · ${dimension}`
      return [
        text(`questions.${index}.prompt`, '题干', 100, true, group),
        text(`questions.${index}.options.0.label`, '选项 A', 70, false, group),
        text(`questions.${index}.options.1.label`, '选项 B', 70, false, group),
        check(`questions.${index}.reverse`, `反转计分（默认 A→${dimension[0]}，勾选后 A→${dimension[1]}）`, group),
      ]
    })).flat(),
  ]
  if (category === 'personas') return personaCodes.flatMap(code => [
    text(`${code}.title`, '人格角色', 18, false, code),
    text(`${code}.quote`, '一句个人宣言', 48, false, code),
    text(`${code}.recharge`, '如何给我充电', 90, true, code),
    text(`${code}.communication`, '怎样和我沟通', 90, true, code),
    text(`${code}.care`, '我在意的相处细节', 90, true, code),
  ])
  return []
}

export function readPath(source: unknown, path: string): unknown {
  let cursor = source
  for (const key of path.split('.')) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor
}

/** Returns a cloned value with the path replaced; missing objects are created. */
export function writePath(source: unknown, path: string, value: unknown): Record<string, unknown> {
  const root = source && typeof source === 'object' && !Array.isArray(source)
    ? JSON.parse(JSON.stringify(source)) as Record<string, unknown>
    : {}
  const keys = path.split('.')
  let cursor: Record<string, unknown> | unknown[] = root
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!
    const next = (cursor as Record<string, unknown>)[key]
    if (!next || typeof next !== 'object') (cursor as Record<string, unknown>)[key] = /^\d+$/.test(keys[i + 1]!) ? [] : {}
    cursor = (cursor as Record<string, unknown>)[key] as Record<string, unknown>
  }
  ;(cursor as Record<string, unknown>)[keys[keys.length - 1]!] = value
  return root
}

export function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.join('，')
  if (value === null || value === undefined) return ''
  return String(value)
}

/** Converts the raw input of a field back to the category shape. */
export function parseField(field: FieldDef, raw: string): unknown {
  if (field.type === 'checkbox') return raw === 'true'
  if (field.type === 'number') return raw === '' ? 0 : Number(raw)
  if (field.type === 'select') return field.options?.find(option => String(option.value) === raw)?.value ?? raw
  if (field.type === 'tags') return raw.split(/[，,]/).map(item => item.trim()).filter(Boolean)
  if (field.type === 'numbers') return raw.split(/[，,]/).map(item => item.trim()).filter(Boolean).map(Number)
  return raw
}

/** Technical skeleton for categories whose shape requires ids or fixed system fields. */
export function skeletonFor(category: string): Record<string, unknown> | null {
  if (category === 'catalog') return {
    shop: [
      { id: 'studio_tier_1', title: '', cents: 0, desc: '', on: false },
      { id: 'studio_tier_2', title: '', cents: 0, desc: '', on: false },
    ],
    styles: [
      { id: 'editorial', title: '', art: 'editorial', on: false, order: 1 },
      { id: 'illustration', title: '', art: 'illustration', on: false, order: 2 },
      { id: 'game', title: '', art: 'game', on: false, order: 3 },
    ],
  }
  if (category === 'payments') return Object.fromEntries(channelNames.map(([key]) =>
    [key, { enabled: false, mode: 'mock', merchantLabel: '', appId: '', appSecretRef: '', mchId: '', serialNo: '',
      publicKeyId: '', notifyUrl: '', refundNotifyUrl: '', privateKeyRef: '', apiV3KeyRef: '', platformPublicKeyRef: '' }]))
  if (category === 'aiRuntime') return { mode: 'UNCONFIGURED', size: '1024*1024', timeout: 60 }
  if (category === 'assessment') return {
    question_bank_version: '',
    questions: Array.from({ length: 12 }, (_, index) => {
      const dimension = dimensions[index % 4]
      return { id: `q${index + 1}`, index: index + 1, dimension, prompt: '',
        options: [{ id: dimension[0].toLowerCase(), label: '' }, { id: dimension[1].toLowerCase(), label: '' }], reverse: false }
    }),
  }
  if (category === 'personas') return Object.fromEntries(personaCodes.map(code =>
    [code, { title: '', quote: '', recharge: '', communication: '', care: '' }]))
  if (category === 'copy') return {
    stages: ['日常生活', '新学期', '新工作', '新城市', '生活转折', '项目冲刺', '假期休息'],
    recentStatuses: ['不记录', '轻松', '平稳', '忙碌', '疲惫'],
    interests: ['摄影', '阅读', '音乐', '散步', '电影', '咖啡', '运动', '游戏'],
    maxInterests: 3,
    compare: { title: '变了多少，', accent: '让答案自己说。', description: '比较你选择的两个阶段；没有高低阶，也没有“更好的人格”。',
      emptyTitle: '再留一份记录，', emptyAccent: '就能看见前后差别。', emptyDescription: '只比较同一题目、计分规则和回顾时间窗下的两次结果。' },
    pages: Object.fromEntries(pageTitles.map(([route, label]) => [route, label])),
  }
  return null
}

/** Labels of visible fields the server would reject as empty. */
export function missingFields(fields: FieldDef[], value: unknown): string[] {
  return fields.filter(field => {
    const current = readPath(value, field.path)
    if (field.type === 'checkbox') return false
    if (field.type === 'number') return typeof current !== 'number' || !Number.isFinite(current) || current < (field.min ?? 1)
    if (field.type === 'tags' || field.type === 'numbers') return !Array.isArray(current) || current.length === 0
    return typeof current !== 'string' || !current.trim()
  }).map(field => field.label)
}
