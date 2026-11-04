import { request, useMock } from './client'
import type { SharePreviewResponse } from './types'
import * as mock from './mock/store'

export function createSharePreview(body: {
  result_id: string
  template_id?: string
  scene?: 'moments' | 'avatar' | 'meet_card'
}) {
  if (useMock()) return mock.createSharePreview(body)
  return request<SharePreviewResponse>('/share/preview', { method: 'POST', data: body })
}
