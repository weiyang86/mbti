import { request } from './client'

// F6 internal fallback candidate / needs_human_review, not a published contract.
export interface RadarParticipation { enrolled: boolean }
export type RadarRadius = 500 | 1000 | 3000
export interface SameTypeCount {
  count: null
  status: 'unavailable'
  reason: 'not_enrolled' | 'location_source_not_configured'
}

function objectWithKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}
export function parseRadarParticipation(value: unknown): RadarParticipation {
  if (!objectWithKeys(value, ['enrolled']) || typeof value.enrolled !== 'boolean') {
    throw new Error('参与状态响应格式不符合当前约定，请重新读取。')
  }
  return { enrolled: value.enrolled }
}
export function parseSameTypeCount(value: unknown): SameTypeCount {
  if (!objectWithKeys(value, ['count', 'status', 'reason']) || value.count !== null
    || value.status !== 'unavailable'
    || (value.reason !== 'not_enrolled' && value.reason !== 'location_source_not_configured')) {
    throw new Error('统计响应格式不符合当前约定，请重新读取。')
  }
  return { count: null, status: 'unavailable', reason: value.reason }
}
export async function getRadarParticipation() {
  return parseRadarParticipation(await request<unknown>('/radar/participation'))
}
export async function updateRadarParticipation(body: RadarParticipation) {
  return parseRadarParticipation(await request<unknown>('/radar/participation', {
    method: 'PUT', data: { enrolled: body.enrolled },
  }))
}
export async function getSameTypeCount(params: { type_code?: string; radius_m?: RadarRadius } = {}) {
  const query: string[] = []
  if (params.type_code !== undefined) query.push(`type_code=${encodeURIComponent(params.type_code)}`)
  if (params.radius_m !== undefined) query.push(`radius_m=${encodeURIComponent(String(params.radius_m))}`)
  return parseSameTypeCount(await request<unknown>(`/radar/same-type${query.length ? `?${query.join('&')}` : ''}`))
}
