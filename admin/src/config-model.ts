import fixture from './config-fixture.json'
import type { Answer, DimensionCounts, Question, TypeMeta } from '../../web/src/api/types'

// Prototype presentation fields only. These are not new server/API fields.
export type Dimension = Question['dimension']
export const dimensions: Dimension[] = ['EI', 'SN', 'TF', 'JP']
export const channels = [
  { id: 'wechat', label: '微信小程序' }, { id: 'xhs', label: '小红书小程序' },
  { id: 'douyin', label: '抖音小程序' }, { id: 'mp', label: '公众号 H5' },
] as const
export type Channel = typeof channels[number]['id']
export const landingPages = { home: '首页', pricing: '付费购买页', 'test-intro': '测试与阶段选择', discover: '换名片', history: '我的轨迹' }
export const previewPages = { ...landingPages, test: '首道测试题', result: '人格结果与说明书', create: '形象工作台', share: '分享配文' }
export type Landing = keyof typeof landingPages
export type PreviewPage = keyof typeof previewPages
export type Art = 'editorial' | 'illustration' | 'game'
export type Content = { headline: string; accent: string; sub: string; cta: string; moments: string; avatar: string; meet: string; caption: string }
export type UiPackage = { id: string; title: string; cents: number; desc: string; on: boolean }
export type Style = { id: Art; title: string; art: Art; on: boolean; order: number }
export type Persona = { title: string; quote: string; recharge: string; communication: string; care: string }
export type DraftQuestion = Question & { reverse: boolean }
export interface UiConfiguration {
  content: Content
  channels: Record<Channel, { name: string; landing: Landing; badge: string }>
  shop: UiPackage[]
  styles: Style[]
  personas: Record<TypeMeta['type_code'], Persona>
  quiz: { question_bank_version: string; questions: DraftQuestion[] }
}
export function referenceConfiguration(): UiConfiguration {
  return { ...structuredClone(fixture), quiz: { ...structuredClone(fixture.quiz), questions: fixture.quiz.questions.map(q => ({ ...structuredClone(q), reverse: false })) } } as UiConfiguration
}
export type EditKind = 'hero' | 'scenes' | 'channel' | 'sku' | 'style' | 'question' | 'persona'
export type Field = { key: string; label: string; value: string | boolean; type?: 'textarea' | 'checkbox' | 'select' | 'number'; max?: number; options?: { value: string; label: string }[] }
export type EditValues = Record<string, string | boolean>
const text = (key: string, label: string, value: string, max: number, long = false): Field => ({ key, label, value, max, type: long ? 'textarea' : undefined })
const select = (key: string, label: string, value: string, options: Record<string, string>): Field => ({ key, label, value, type: 'select', options: Object.entries(options).map(([value, label]) => ({ value, label })) })
export function fieldsFor(c: UiConfiguration, kind: EditKind, key = ''): Field[] {
  if (kind === 'hero') return [text('headline', '主标题', c.content.headline, 26), text('accent', '强调语', c.content.accent, 28), text('sub', '首屏说明', c.content.sub, 80), text('cta', '免费测试按钮', c.content.cta, 20)]
  if (kind === 'scenes') return (['moments', 'avatar', 'meet', 'caption'] as const).map((k, i) => text(k, ['朋友圈场景标题', '头像场景标题', '见面场景标题', '朋友圈默认配文'][i]!, c.content[k], 100, true))
  if (kind === 'channel') return [select('landing', '打开后的首个页面', c.channels[key as Channel].landing, landingPages), text('badge', '渠道首页栏目语', c.channels[key as Channel].badge, 26)]
  if (kind === 'sku') { const p = c.shop.find(p => p.id === key)!; return [text('title', '商品名称', p.title, 24), { key: 'price', label: '售价（元）', value: (p.cents / 100).toFixed(2), type: 'number' }, text('desc', '权益说明', p.desc, 100, true), { key: 'on', label: '在购买页上架', value: p.on, type: 'checkbox' }] }
  if (kind === 'style') { const p = c.styles.find(p => p.id === key)!; return [text('title', '风格名称', p.title, 16), select('art', '视觉素材', p.art, Object.fromEntries(fixture.styles.map(p => [p.id, p.title + '原画']))), select('order', '展示顺序', String(p.order), { 1: '第 1 位', 2: '第 2 位', 3: '第 3 位' }), { key: 'on', label: '允许用户选择此风格', value: p.on, type: 'checkbox' }] }
  if (kind === 'question') { const q = c.quiz.questions.find(q => q.id === key)!; return [text('prompt', '题干', q.prompt, 100, true), text('a', '选项 A', q.options[0]!.label, 70), text('b', '选项 B', q.options[1]!.label, 70), select('reverse', '选项计分方向', q.reverse ? '1' : '0', { 0: `A → ${q.dimension[0]}；B → ${q.dimension[1]}`, 1: `A → ${q.dimension[1]}；B → ${q.dimension[0]}` })] }
  const p = c.personas[key]!
  return [text('title', '人格角色', p.title, 18), text('quote', '一句个人宣言', p.quote, 48), text('recharge', '如何给我充电', p.recharge, 90, true), text('communication', '怎样和我沟通', p.communication, 90, true), text('care', '我在意的相处细节', p.care, 90, true)]
}
export function priceInFen(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw Error('价格须精确到分，范围 0.01–9999.99 元。')
  const n = Math.round(Number(value) * 100)
  if (!Number.isSafeInteger(n) || n < 1 || n > 999999) throw Error('单价应在 0.01–9999.99 元之间。')
  return n
}
export function validateQuestions(questions: DraftQuestion[]): void {
  if (questions.length !== 12 || dimensions.some(d => questions.filter(q => q.dimension === d).length !== 3)) throw Error('须保留 12 题，每维度 3 题。')
  if (new Set(questions.map(q => q.id)).size !== 12) throw Error('题目编号不能重复。')
  for (const q of questions) {
    if (!q.prompt.trim() || q.prompt.length > 100 || /[<>"'&]/.test(q.prompt)) throw Error('题干须为非空纯文本，最多 100 字。')
    if (q.options.length !== 2 || new Set(q.options.map(o => o.id)).size !== 2 || q.options.some(o => !o.label.trim() || o.label.length > 70 || /[<>"'&]/.test(o.label))) throw Error('每题须有两个有效、不重复编号的选项。')
    if (q.options[0]!.label.trim() === q.options[1]!.label.trim()) throw Error('两个选项须不同。')
    if (typeof q.reverse !== 'boolean' || q.options.some(o => !q.dimension.toLowerCase().split('').includes(o.id))) throw Error('非法选项计分映射。')
  }
}
export function validateConfiguration(c: UiConfiguration): void {
  if (c.shop.length !== 2 || new Set(c.shop.map(p => p.id)).size !== 2) throw Error('保留两档固定套装。')
  if (!c.shop.some(p => p.on)) throw Error('至少保留一个上架套装。')
  if (c.shop.some(p => !Number.isInteger(p.cents) || p.cents < 1 || p.cents > 999999)) throw Error('单价应在 0.01–9999.99 元之间。')
  if (c.shop[1]!.cents < c.shop[0]!.cents) throw Error('本人形象套装售价不能低于基础晒图套装。')
  if (!c.styles.some(p => p.on)) throw Error('至少保留一个启用风格。')
  if (c.styles.length !== 3 || new Set(c.styles.map(s => s.id)).size !== 3 || c.styles.some(s => !['editorial', 'illustration', 'game'].includes(s.art)) || c.styles.map(s => s.order).sort().join() !== '1,2,3') throw Error('模板须使用三个内置素材与不重复的展示顺序。')
  validateQuestions(c.quiz.questions)
}
export function questionVersion(questions: DraftQuestion[]): string {
  if (JSON.stringify(questions) === JSON.stringify(referenceConfiguration().quiz.questions)) return fixture.quiz.question_bank_version
  let hash = 2166136261
  for (const char of JSON.stringify(questions)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return `preview-only-${(hash >>> 0).toString(36)}`
}
export function applyEdit(current: UiConfiguration, kind: EditKind, key: string, values: EditValues): UiConfiguration {
  const c = structuredClone(current), fields = fieldsFor(c, kind, key)
  const s = (k: string) => String(values[k] ?? '').trim()
  for (const f of fields) {
    const v = s(f.key)
    if (f.type === 'checkbox') { if (typeof values[f.key] !== 'boolean') throw Error('开关值无效。'); continue }
    if (!v || /[<>"'&]/.test(v)) throw Error('请填写非空纯文本，不含 HTML 符号或英文引号。')
    if (f.max && v.length > f.max) throw Error(`${f.label}最多 ${f.max} 字。`)
    if (f.options && !f.options.some(o => o.value === v)) throw Error('非法选项计分方向、入口或素材。')
  }
  if (kind === 'hero' || kind === 'scenes') for (const f of fields) c.content[f.key as keyof Content] = s(f.key)
  if (kind === 'channel') Object.assign(c.channels[key as Channel], { landing: s('landing'), badge: s('badge') })
  if (kind === 'sku') Object.assign(c.shop.find(p => p.id === key)!, { title: s('title'), desc: s('desc'), cents: priceInFen(s('price')), on: values.on })
  if (kind === 'style') {
    const p = c.styles.find(p => p.id === key)!
    Object.assign(p, { title: s('title'), art: s('art'), on: values.on })
    const ordered = c.styles.filter(p => p.id !== key).sort((a, b) => a.order - b.order)
    ordered.splice(Number(s('order')) - 1, 0, p); ordered.forEach((p, i) => { p.order = i + 1 })
  }
  if (kind === 'question') {
    const q = c.quiz.questions.find(q => q.id === key)!
    q.prompt = s('prompt'); q.options[0]!.label = s('a'); q.options[1]!.label = s('b'); q.reverse = s('reverse') === '1'
    c.quiz.question_bank_version = questionVersion(c.quiz.questions)
  }
  if (kind === 'persona') for (const f of fields) c.personas[key]![f.key as keyof Persona] = s(f.key)
  validateConfiguration(c)
  return c
}
/** Pure 12-choice calculation: no ResultSnapshot, session, ledger, API or history. */
export function simulate(questions: DraftQuestion[], answers: Answer[]): { type: string; counts: DimensionCounts } {
  validateQuestions(questions)
  if (answers.length !== 12 || new Set(answers.map(a => a.question_id)).size !== 12) throw Error('须为 12 道题各选一个有效答案，题号不可重复。')
  const counts: DimensionCounts = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 }
  for (const q of questions) {
    const a = answers.find(a => a.question_id === q.id), index = q.options.findIndex(o => o.id === a?.option_id)
    if (index < 0) throw Error('答案包含缺失题号或非法选项。')
    const side = q.dimension[q.reverse ? 1 - index : index] as keyof DimensionCounts
    counts[side]++
  }
  return { type: dimensions.map(d => counts[d[0] as keyof DimensionCounts] > counts[d[1] as keyof DimensionCounts] ? d[0] : d[1]).join(''), counts }
}
