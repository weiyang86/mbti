import type {
  DimensionCounts,
  ResultSnapshot,
  ResultSnapshotSummary,
} from '@/api/types'

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

export type JourneyRecord = ResultSnapshot

const DAY = 86400000

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

/** 接口不下发原始作答，历史对比只用四维计数 */
export function changedAnswerCount(_a: ResultSnapshot, _b: ResultSnapshot): number | null {
  return null
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
