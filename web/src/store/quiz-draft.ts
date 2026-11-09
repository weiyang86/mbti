import { baseURL, useMock } from '../api/client'
import type { QuizSession, QuizVersionPayload } from '../api/types'

export interface QuizDraft {
  sessionId: string
  questionBankVersion: string
  questionBank?: QuizVersionPayload
  answers: Record<string, string>
  index: number
  updatedAt: string
}

const legacyKey = 'mbti_quiz_draft_v1'
const key = `${legacyKey}:${useMock() ? 'mock' : baseURL}`
export const recoveryMessage = '无法恢复这次测验的原题库，请重新开始；已有历史结果会保留'

export function loadQuizDraft(): QuizDraft | null {
  const raw = uni.getStorageSync(key) || uni.getStorageSync(legacyKey)
  if (!raw || typeof raw !== 'object' || typeof raw.sessionId !== 'string') return null
  return raw as QuizDraft
}

export function isRestorableDraft(draft: QuizDraft | null): draft is QuizDraft & { questionBank: QuizVersionPayload } {
  if (!draft?.questionBank || draft.questionBankVersion !== draft.questionBank.question_bank_version) return false
  const questions = draft.questionBank.questions
  if (!Array.isArray(questions) || questions.length !== 12) return false
  if (!questions.every((q) => q && typeof q.id === 'string' && typeof q.prompt === 'string' && Array.isArray(q.options) && q.options.length >= 2 && q.options.every((o) => o && typeof o.id === 'string' && typeof o.label === 'string'))) return false
  if (new Set(questions.map((q) => q.id)).size !== 12) return false
  if (!draft.answers || typeof draft.answers !== 'object' || !Number.isInteger(draft.index) || draft.index < 0 || draft.index >= questions.length) return false
  return Object.entries(draft.answers).every(([qid, oid]) => questions.some((q) => q.id === qid && q.options.some((o) => o.id === oid)))
}

export function saveQuizDraft(draft: QuizDraft): void {
  // Surface storage failure: a session without its frozen questions cannot be recovered safely.
  uni.setStorageSync(key, draft)
}

export function createQuizDraft(session: QuizSession, questionBank: QuizVersionPayload): QuizDraft {
  if (session.question_bank_version !== questionBank.question_bank_version) {
    throw new Error(recoveryMessage)
  }
  const draft: QuizDraft = {
    sessionId: session.id,
    questionBankVersion: session.question_bank_version,
    questionBank,
    answers: Object.fromEntries(session.answers.map((a) => [a.question_id, a.option_id])),
    index: 0,
    updatedAt: new Date().toISOString(),
  }
  if (!isRestorableDraft(draft)) throw new Error(recoveryMessage)
  saveQuizDraft(draft)
  return draft
}

export function clearQuizDraft(): void {
  uni.removeStorageSync(key)
  uni.removeStorageSync(legacyKey)
}
