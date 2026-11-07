/** 答题草稿：保存到本机，用于中途离开后的断点续答 */
export interface QuizDraft {
  sessionId: string
  questionBankVersion: string
  answers: Record<string, string>
  index: number
  updatedAt: string
}

const KEY = 'mbti_quiz_draft_v1'

export function loadQuizDraft(): QuizDraft | null {
  try {
    const raw = uni.getStorageSync(KEY)
    if (!raw || typeof raw !== 'object') return null
    const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : ''
    if (!sessionId) return null
    const answers: Record<string, string> = {}
    if (raw.answers && typeof raw.answers === 'object') {
      Object.entries(raw.answers).forEach(([qid, oid]) => {
        if (typeof oid === 'string') answers[qid] = oid
      })
    }
    return {
      sessionId,
      questionBankVersion:
        typeof raw.questionBankVersion === 'string' ? raw.questionBankVersion : '',
      answers,
      index: typeof raw.index === 'number' && raw.index >= 0 ? raw.index : 0,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    }
  } catch {
    return null
  }
}

export function saveQuizDraft(draft: QuizDraft) {
  try {
    uni.setStorageSync(KEY, draft)
  } catch {
    /* ignore */
  }
}

export function clearQuizDraft() {
  try {
    uni.removeStorageSync(KEY)
  } catch {
    /* ignore */
  }
}

/** 已作答题目数（仅统计当前会话的答案） */
export function quizDraftAnswerCount(draft: QuizDraft | null): number {
  return draft ? Object.keys(draft.answers).length : 0
}
