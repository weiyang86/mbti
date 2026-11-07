// TODO: 待 Remy 确认接口路径和字段（后端未开发，当前用 mock 数据支撑页面演示）
import { request, useMock } from './client'
import * as mock from './mock/radar'

export interface RadarParticipation {
  enrolled: boolean
}

export interface SameTypeCount {
  /** 同型参与者人数；null 表示「人数较少」，不展示精确人数 */
  count: number | null
}

export function getRadarParticipation() {
  if (useMock()) return mock.getRadarParticipation()
  return request<RadarParticipation>('/radar/participation')
}

export function updateRadarParticipation(body: { enrolled: boolean }) {
  if (useMock()) return mock.updateRadarParticipation(body)
  return request<RadarParticipation>('/radar/participation', { method: 'PUT', data: body })
}

export function getSameTypeCount(params: { type_code?: string; radius_m?: number }) {
  if (useMock()) return mock.getSameTypeCount(params)
  const parts: string[] = []
  if (params.type_code) parts.push(`type_code=${encodeURIComponent(params.type_code)}`)
  if (params.radius_m) parts.push(`radius_m=${encodeURIComponent(String(params.radius_m))}`)
  const suffix = parts.length ? `?${parts.join('&')}` : ''
  return request<SameTypeCount>(`/radar/same-type${suffix}`)
}