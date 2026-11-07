import { request, useMock } from './client'
import type {
  QuizSession,
  QuizVersionPayload,
  ResultSnapshot,
  Answer,
} from './types'
import * as mock from './mock/store'

export function getCurrentQuizVersion() {
  if (useMock()) return mock.getCurrentQuizVersion()
  return request<QuizVersionPayload>('/quiz/versions/current')
}

export function createQuizSession(body?: { question_bank_version?: string }) {
  if (useMock()) return mock.createQuizSession(body)
  return request<QuizSession>('/quiz/sessions', { method: 'POST', data: body })
}

export function updateQuizSessionAnswers(sessionId: string, answers: Answer[]) {
  if (useMock()) return mock.updateQuizSessionAnswers(sessionId, answers)
  return request<QuizSession>(`/quiz/sessions/${encodeURIComponent(sessionId)}/answers`, {
    method: 'PUT',
    data: { answers },
  })
}

export function submitQuizSession(
  sessionId: string,
  body?: { life_stage?: string; recent_status?: string },
) {
  if (useMock()) return mock.submitQuizSession(sessionId, body)
  return request<ResultSnapshot>(`/quiz/sessions/${encodeURIComponent(sessionId)}/submit`, {
    method: 'POST',
    data: body,
  })
}
