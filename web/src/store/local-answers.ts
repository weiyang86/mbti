// TODO: 待 Remy 确认服务端「历史作答回放」接口（docs/api 未定义，当前 CompareResult 只返回四维计数）
// 现阶段仅在本机保存作答文本，用于「阶段记录」与「前后对比」的私密回看；不会进入任何分享图。
export interface LocalAnswerItem {
  question: string
  answer: string
}

export interface LocalAnswerRecord {
  question_bank_version: string
  submitted_at: string
  items: LocalAnswerItem[]
}

type AnswerStore = Record<string, LocalAnswerRecord>

const KEY = 'mbti_local_answers_v1'
const MAX_RECORDS = 30

function load(): AnswerStore {
  try {
    const raw = uni.getStorageSync(KEY)
    if (raw && typeof raw === 'object') return raw as AnswerStore
  } catch {
    /* ignore */
  }
  return {}
}

function persist(store: AnswerStore) {
  try {
    uni.setStorageSync(KEY, store)
  } catch {
    /* ignore */
  }
}

export function saveLocalAnswers(
  resultId: string,
  questionBankVersion: string,
  items: LocalAnswerItem[],
) {
  if (!resultId || !items.length) return
  const store = load()
  store[resultId] = {
    question_bank_version: questionBankVersion,
    submitted_at: new Date().toISOString(),
    items,
  }
  const ids = Object.keys(store)
  if (ids.length > MAX_RECORDS) {
    ids
      .sort((a, b) => store[a].submitted_at.localeCompare(store[b].submitted_at))
      .slice(0, ids.length - MAX_RECORDS)
      .forEach((id) => delete store[id])
  }
  persist(store)
}

export function getLocalAnswers(resultId: string): LocalAnswerRecord | null {
  if (!resultId) return null
  const record = load()[resultId]
  return record && Array.isArray(record.items) ? record : null
}
