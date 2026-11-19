// UI-only prototype vocabulary. All durable fields / service mappings are unknowns,
// needs_human_review; this does not extend the config-contract-v1 wire boundary.
export type B4Page = 'ai' | 'retention' | 'social'
export type Lifecycle = { tags: string[]; days: number[] }
export type SocialRules = { order: 'same' | 'recommend'; daily: number; radar: boolean; radius: number; minimum: number }
export const initialLifecycle = (): Lifecycle => ({ tags: ['日常生活', '新学期', '新工作', '新城市', '生活转折', '项目冲刺', '假期休息'], days: [30, 90] })
export const initialSocial = (): SocialRules => ({ order: 'recommend', daily: 8, radar: true, radius: 500, minimum: 10 })
const plain = (value: string) => !/[<>"'&]/.test(value)
export function lifecycleInput(tagsText: string, daysText: string): Lifecycle {
  const tags = tagsText.split(/[\n,，、]+/).map(s => s.trim()).filter(Boolean)
  const days = daysText.trim().split(/[\s,，、]+/).map(Number)
  if (!tags.length || tags.length > 10 || tags.some(t => t.length > 12 || !plain(t)) || new Set(tags).size !== tags.length) throw Error('请填写 1–10 个不重复的纯文本标签，每个最多 12 字。')
  if (!days.length || days.length > 3 || days.some(n => !Number.isInteger(n) || n < 1 || n > 365) || new Set(days).size !== days.length) throw Error('请填写 1–3 个不同的整数天数，范围 1–365。')
  return { tags, days: days.sort((a, b) => a - b) }
}
export function socialInput(value: SocialRules): SocialRules {
  if (!['same', 'recommend'].includes(value.order) || !Number.isInteger(value.daily) || value.daily < 1 || value.daily > 30) throw Error('推荐方式须为同型或共同兴趣优先；每日上限须为 1–30 的整数。')
  if (typeof value.radar !== 'boolean' || ![500, 1000, 3000].includes(value.radius) || !Number.isInteger(value.minimum) || value.minimum < 10 || value.minimum > 200) throw Error('半径须为 500 / 1000 / 3000 米；匿名阈值须为 10–200 的整数。')
  return { ...value }
}
export function radarProjection(enabled: boolean, minimum: number, count: number | null) {
  if (!enabled) return { status: 'disabled', count: null, label: '同型雷达暂未开放' } as const
  if (count === null || !Number.isInteger(count) || count < 0 || !Number.isInteger(minimum) || minimum < 10 || minimum > 200) return { status: 'unavailable', count: null, label: '尚未接通自愿位置来源，暂时无法统计所选范围的同型人数。' } as const
  if (count < minimum) return { status: 'hidden', count: null, label: '人数较少' } as const
  const bucket = Math.floor(count / 10) * 10
  return { status: 'bucket', count: bucket, label: `${bucket}+` } as const
}
// A rules example, never a fabricated cohort or metric result. day 52 is an
// observation horizon (last eligible retest day 45 + 7), not a reminder time.
export function cohortWindow(ageDays: number) {
  return { retestDenominatorEligible: Number.isFinite(ageDays) && ageDays >= 45, comparisonObservationComplete: Number.isFinite(ageDays) && ageDays >= 52 }
}
export const cohortSemantics = [
  '第 0 天完成首次测试；当天重测不计长期复测。第 28–45 天完成同版本复测作为候选分子。',
  '阶段复测率分母仅纳入首测满 45 天的队列，明确排除不足 45 天者；按成熟日期归入所选周期和首测渠道，分子与分母须为同一队列。',
  '对比打开率保留第 52 天观察窗：让最后一次合格复测留足后续 7 天；分母为同批、观察窗已满的同版复测者，分子为后续 7 天打开对比者。不是第 52 天推送计划。',
  '零分母或事实来源未连接均显示 —；渠道、去重、题库版本、归属时区、截止时点、首测与复测关联及对比事件映射为 unknowns / needs_human_review。',
] as const
