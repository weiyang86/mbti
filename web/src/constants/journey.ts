import type {
  CompareResult,
  DimensionCounts,
  ResultSnapshot,
  ResultSnapshotSummary,
} from '@/api/types'
import { QUESTION_BANK_VERSION } from '@/api/mock/questions'

export type DimKey = 'EI' | 'SN' | 'TF' | 'JP'
export type DimLetter = keyof DimensionCounts

export interface DimMeta {
  key: DimKey
  left: DimLetter
  right: DimLetter
  leftLabel: string
  rightLabel: string
  name: string
}

/** 四维元信息，与 UIhtml/mbti-dazi-mobile-v04.html 的 DIM_META 保持一致 */
export const DIM_LIST: DimMeta[] = [
  { key: 'EI', left: 'E', right: 'I', leftLabel: '外向 E', rightLabel: '内向 I', name: '社交充电' },
  { key: 'SN', left: 'S', right: 'N', leftLabel: '实感 S', rightLabel: '直觉 N', name: '关注方式' },
  { key: 'TF', left: 'T', right: 'F', leftLabel: '思考 T', rightLabel: '情感 F', name: '决策方式' },
  { key: 'JP', left: 'J', right: 'P', leftLabel: '判断 J', rightLabel: '知觉 P', name: '安排方式' },
]

export const DIM_MAP: Record<DimKey, DimMeta> = DIM_LIST.reduce(
  (acc, item) => {
    acc[item.key] = item
    return acc
  },
  {} as Record<DimKey, DimMeta>,
)

/** 仅用于「先看示例」的虚构阶段，不写入真实记录 */
export interface JourneyRecord extends ResultSnapshot {
  demo_title?: string
  /** 示例记录独有的 0/1 作答，用于演示“几道题不同”，真实接口不下发 */
  demo_answers?: number[]
}

const DAY = 86400000

function daysAgo(days: number) {
  return new Date(Date.now() - days * DAY).toISOString()
}

export const DEMO_RECORDS: JourneyRecord[] = [
  {
    id: 'demo-stage-0',
    source: 'quiz',
    type_code: 'INFP',
    dimension_counts: { E: 1, I: 2, S: 1, N: 2, T: 1, F: 2, J: 1, P: 2 },
    question_bank_version: QUESTION_BANK_VERSION,
    submitted_at: daysAgo(90),
    life_stage: '新城市',
    recent_status: '忙碌',
    demo_title: '毕业后的夏天',
    demo_answers: [1, 1, 1, 1, 1, 0, 1, 0, 0, 1, 0, 1],
  },
  {
    id: 'demo-stage-1',
    source: 'quiz',
    type_code: 'ENFP',
    dimension_counts: { E: 2, I: 1, S: 1, N: 2, T: 1, F: 2, J: 1, P: 2 },
    question_bank_version: QUESTION_BANK_VERSION,
    submitted_at: daysAgo(45),
    life_stage: '新工作',
    recent_status: '平稳',
    demo_title: '慢慢适应新生活',
    demo_answers: [0, 1, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1],
  },
  {
    id: 'demo-stage-2',
    source: 'quiz',
    type_code: 'ENFP',
    dimension_counts: { E: 3, I: 0, S: 0, N: 3, T: 1, F: 2, J: 0, P: 3 },
    question_bank_version: QUESTION_BANK_VERSION,
    submitted_at: daysAgo(0),
    life_stage: '日常生活',
    recent_status: '轻松',
    demo_title: '更愿意主动认识人',
    demo_answers: [0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1],
  },
]

export function dateLabel(value?: string, short = false): string {
  if (!value) return '日期未知'
  const d = new Date(value)
  if (!Number.isFinite(+d)) return '日期未知'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return short ? `${m}.${dd}` : `${y}.${m}.${dd}`
}

export function daysBetween(a: ResultSnapshot, b: ResultSnapshot): number {
  const diff = Math.abs(new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime())
  return Math.floor(diff / DAY)
}

/** 两次快照是否可比较：同题库版本、均为测验来源、且都有四维计数 */
export function isComparable(a?: ResultSnapshot | null, b?: ResultSnapshot | null): boolean {
  return (
    !!a &&
    !!b &&
    a.id !== b.id &&
    a.source === 'quiz' &&
    b.source === 'quiz' &&
    a.question_bank_version === b.question_bank_version &&
    !!a.dimension_counts &&
    !!b.dimension_counts
  )
}

/** 列表摘要没有四维计数时，用来源与版本判断是否属于同一条可比较轨迹 */
export function isComparableSummary(
  a: ResultSnapshotSummary,
  b: ResultSnapshotSummary,
): boolean {
  return (
    a.id !== b.id &&
    a.source === 'quiz' &&
    b.source === 'quiz' &&
    a.question_bank_version === b.question_bank_version
  )
}

export function changedAnswerCount(a: ResultSnapshot, b: ResultSnapshot): number | null {
  const left = (a as JourneyRecord).demo_answers
  const right = (b as JourneyRecord).demo_answers
  if (!left || !right || left.length !== right.length) return null
  return left.reduce((sum, value, i) => sum + (value === right[i] ? 0 : 1), 0)
}

export interface DimCompareRow extends DimMeta {
  before: number
  after: number
  delta: number
}

export function dimCompareRows(a: ResultSnapshot, b: ResultSnapshot): DimCompareRow[] {
  return DIM_LIST.map((dim) => {
    const before = a.dimension_counts?.[dim.right] ?? 0
    const after = b.dimension_counts?.[dim.right] ?? 0
    return { ...dim, before, after, delta: after - before }
  })
}

export function summaryText(a: ResultSnapshot, b: ResultSnapshot): string {
  const changed = changedAnswerCount(a, b)
  const rows = dimCompareRows(a, b)
  const changedDims = rows.filter((r) => r.delta !== 0)
  if (a.type_code === b.type_code) {
    if (changed === 0) return '这两次选择一致。稳定，也值得被记录。'
    if (changed !== null) {
      return `类型仍是 ${b.type_code}，但有 ${changed} 道题的选择不同。`
    }
    if (changedDims.length === 0) {
      return `类型仍是 ${b.type_code}，四个维度的题数一致。`
    }
    return `类型仍是 ${b.type_code}，有 ${changedDims.length} 个维度的题数不同。`
  }
  if (changed !== null) {
    return `结果从 ${a.type_code} 到 ${b.type_code}，有 ${changed} 道题的选择不同。`
  }
  return `结果从 ${a.type_code} 到 ${b.type_code}，${changedDims.length} 个维度的题数发生变化。`
}

/** 示例记录在本地完成对比，不调用后端 */
export function localCompare(a: ResultSnapshot, b: ResultSnapshot): CompareResult {
  const deltas: Record<string, number> = {}
  if (a.dimension_counts && b.dimension_counts) {
    ;(Object.keys(a.dimension_counts) as DimLetter[]).forEach((key) => {
      deltas[key] = (b.dimension_counts?.[key] ?? 0) - (a.dimension_counts?.[key] ?? 0)
    })
  }
  return {
    baseline_id: a.id,
    target_id: b.id,
    question_bank_version: a.question_bank_version,
    type_changed: a.type_code !== b.type_code,
    baseline_type_code: a.type_code,
    target_type_code: b.type_code,
    dimension_deltas: deltas,
    stability_notes:
      a.type_code === b.type_code ? ['类型相同，可查看四维计数差异'] : [],
  }
}

/** 列表摘要选对：缺省取最新两次并按时间升序 */
export function chooseSummaryPair<T extends ResultSnapshotSummary>(
  rows: T[],
  baselineId?: string,
  targetId?: string,
): [T | null, T | null] {
  if (rows.length < 2) return [null, null]
  let to = rows.find((r) => r.id === targetId) || rows[0]
  let from =
    rows.find((r) => r.id === baselineId && r.id !== to.id) ||
    rows.find((r) => r.id !== to.id)
  if (!from || !to) return [null, null]
  if (from.submitted_at > to.submitted_at) [from, to] = [to, from]
  return [from, to]
}

/** 从候选记录中选出「之前 / 这次」两份，缺省取最新两次并按时间升序 */
export function pickPair<T extends ResultSnapshot>(
  rows: T[],
  baselineId?: string,
  targetId?: string,
): [T | null, T | null] {
  const valid = rows
    .filter((r) => r.source === 'quiz' && r.dimension_counts)
    .slice()
    .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))
  if (valid.length < 2) return [null, null]
  let to = targetId ? valid.find((r) => r.id === targetId) : valid[valid.length - 1]
  let from = baselineId ? valid.find((r) => r.id === baselineId) : undefined
  if (!to) to = valid[valid.length - 1]
  if (!from || from.id === to.id) {
    from = valid.filter((r) => r.id !== to?.id).slice(-1)[0]
  }
  if (!from || !to) return [null, null]
  return from.submitted_at <= to.submitted_at ? [from, to] : [to, from]
}
