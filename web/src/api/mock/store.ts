import type {
  Answer,
  CompareResult,
  DimensionCounts,
  Question,
  QuizSession,
  QuizVersionPayload,
  ResultSnapshot,
  ResultSnapshotSummary,
  SharePreviewResponse,
  TypeMeta,
} from '../types'
import { MOCK_QUESTIONS, QUESTION_BANK_VERSION } from './questions'
import { scoreQuizAnswers } from './scoring'
import { TYPE_METAS } from './type-metas'

const STORAGE_KEY = 'mbti_mock_results_v1'

interface MockState {
  sessions: Record<string, QuizSession>
  results: ResultSnapshot[]
}

function loadState(): MockState {
  try {
    const raw = uni.getStorageSync(STORAGE_KEY)
    if (raw && typeof raw === 'object') {
      return {
        sessions: raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {},
        results: Array.isArray(raw.results) ? raw.results : [],
      }
    }
  } catch {
    /* ignore */
  }
  return { sessions: {}, results: [] }
}

function saveState() {
  try {
    uni.setStorageSync(STORAGE_KEY, {
      sessions: state.sessions,
      results: state.results,
    })
  } catch {
    /* ignore */
  }
}

let state = loadState()

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function getHealth() {
  return Promise.resolve({ status: 'ok', version: '0.1-draft-mock' })
}

export function getCurrentQuizVersion(): Promise<QuizVersionPayload> {
  return Promise.resolve({
    question_bank_version: QUESTION_BANK_VERSION,
    lookback_hint: '请按最近四周的通常状态作答',
    questions: MOCK_QUESTIONS,
  })
}

export function createQuizSession(body?: { question_bank_version?: string }): Promise<QuizSession> {
  const session: QuizSession = {
    id: uid('sess'),
    question_bank_version: body?.question_bank_version || QUESTION_BANK_VERSION,
    status: 'in_progress',
    answers: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  state.sessions[session.id] = session
  saveState()
  return Promise.resolve({ ...session })
}

export function updateQuizSessionAnswers(
  sessionId: string,
  answers: Answer[],
): Promise<QuizSession> {
  const session = state.sessions[sessionId]
  if (!session) {
    return Promise.reject({ code: 'not_found', message: 'session not found' })
  }
  if (session.status === 'submitted') {
    return Promise.reject({ code: 'conflict', message: 'session already submitted' })
  }
  const map = new Map(session.answers.map((a) => [a.question_id, a]))
  answers.forEach((a) => map.set(a.question_id, a))
  session.answers = Array.from(map.values())
  session.updated_at = new Date().toISOString()
  saveState()
  return Promise.resolve({ ...session })
}

export function submitQuizSession(
  sessionId: string,
  body?: { life_stage?: string; recent_status?: string },
): Promise<ResultSnapshot> {
  const session = state.sessions[sessionId]
  if (!session) {
    return Promise.reject({ code: 'not_found', message: 'session not found' })
  }
  if (session.status === 'submitted') {
    return Promise.reject({ code: 'conflict', message: 'already submitted' })
  }
  if (session.answers.length < 12) {
    return Promise.reject({ code: 'unprocessable', message: 'need 12 answers' })
  }

  const { type_code, dimension_counts } = scoreQuizAnswers(
    MOCK_QUESTIONS,
    session.answers,
  )
  session.status = 'submitted'

  const snapshot: ResultSnapshot = {
    id: uid('res'),
    source: 'quiz',
    type_code,
    dimension_counts,
    question_bank_version: session.question_bank_version,
    submitted_at: new Date().toISOString(),
    life_stage: body?.life_stage,
    recent_status: body?.recent_status,
    session_id: session.id,
  }
  state.results = [snapshot, ...state.results]
  saveState()
  return Promise.resolve({ ...snapshot })
}

export function listResults(params?: { limit?: number }) {
  const limit = params?.limit ?? 20
  const items: ResultSnapshotSummary[] = state.results.slice(0, limit).map((r) => ({
    id: r.id,
    source: r.source,
    type_code: r.type_code,
    question_bank_version: r.question_bank_version,
    submitted_at: r.submitted_at,
    life_stage: r.life_stage,
  }))
  return Promise.resolve({ items, next_cursor: null })
}

export function getResult(id: string) {
  const found = state.results.find((r) => r.id === id)
  if (!found) {
    return Promise.reject({ code: 'not_found', message: 'result not found' })
  }
  return Promise.resolve({ ...found })
}

export function deleteResult(id: string) {
  state.results = state.results.filter((r) => r.id !== id)
  saveState()
  return Promise.resolve(undefined)
}

export function compareResults(baselineId: string, targetId: string): Promise<CompareResult> {
  const baseline = state.results.find((r) => r.id === baselineId)
  const target = state.results.find((r) => r.id === targetId)
  if (!baseline || !target) {
    return Promise.reject({ code: 'not_found', message: 'snapshot not found' })
  }
  if (baseline.question_bank_version !== target.question_bank_version) {
    return Promise.reject({
      code: 'unprocessable',
      message: 'question_bank_version mismatch',
    })
  }
  const deltas: Record<string, number> = {}
  if (baseline.dimension_counts && target.dimension_counts) {
    ;(Object.keys(baseline.dimension_counts) as (keyof DimensionCounts)[]).forEach((k) => {
      deltas[k] = target.dimension_counts![k] - baseline.dimension_counts![k]
    })
  }
  return Promise.resolve({
    baseline_id: baselineId,
    target_id: targetId,
    question_bank_version: baseline.question_bank_version,
    type_changed: baseline.type_code !== target.type_code,
    baseline_type_code: baseline.type_code,
    target_type_code: target.type_code,
    dimension_deltas: deltas,
    stability_notes:
      baseline.type_code === target.type_code ? ['类型相同，可查看四维计数差异'] : [],
  })
}

export function createSelfSelectResult(body: {
  type_code: string
  source: 'self_select'
  life_stage?: string
  recent_status?: string
}): Promise<ResultSnapshot> {
  const snapshot: ResultSnapshot = {
    id: uid('res'),
    source: 'self_select',
    type_code: body.type_code,
    question_bank_version: 'n/a-self-select',
    submitted_at: new Date().toISOString(),
    life_stage: body.life_stage,
    recent_status: body.recent_status,
  }
  state.results = [snapshot, ...state.results]
  saveState()
  return Promise.resolve({ ...snapshot })
}

export function listTypes(): Promise<{ items: TypeMeta[] }> {
  return Promise.resolve({ items: TYPE_METAS })
}

export function createSharePreview(body: {
  result_id: string
  scene?: string
}): Promise<SharePreviewResponse> {
  return Promise.resolve({
    preview_url: `/static/share-mock.png?result=${encodeURIComponent(body.result_id)}`,
    status: 'ready',
  })
}

/** Reload results from storage (e.g. on app launch) */
export function refreshMockResultsFromStorage() {
  state = loadState()
}
