import { request, useMock } from './client'
import type { CompareResult, ResultSnapshot, ResultSnapshotSummary } from './types'
import * as mock from './mock/store'

export function listResults(params?: { limit?: number; cursor?: string }) {
  if (useMock()) return mock.listResults(params)
  const q = new URLSearchParams()
  if (params?.limit) q.set('limit', String(params.limit))
  if (params?.cursor) q.set('cursor', params.cursor)
  const suffix = q.toString() ? `?${q.toString()}` : ''
  return request<{ items: ResultSnapshotSummary[]; next_cursor?: string | null }>(
    `/results${suffix}`,
  )
}

export function getResult(id: string) {
  if (useMock()) return mock.getResult(id)
  return request<ResultSnapshot>(`/results/${id}`)
}

export function deleteResult(id: string) {
  if (useMock()) return mock.deleteResult(id)
  return request<void>(`/results/${id}`, { method: 'DELETE' })
}

export function compareResults(baselineId: string, targetId: string) {
  if (useMock()) return mock.compareResults(baselineId, targetId)
  return request<CompareResult>(
    `/results/compare?baseline_id=${encodeURIComponent(baselineId)}&target_id=${encodeURIComponent(targetId)}`,
  )
}

export function createSelfSelectResult(body: {
  type_code: string
  source: 'self_select'
  life_stage?: string
  recent_status?: string
}) {
  if (useMock()) return mock.createSelfSelectResult(body)
  return request<ResultSnapshot>('/results', { method: 'POST', data: body })
}
