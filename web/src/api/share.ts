// TODO: 待 Remy 确认异步 job_id 的轮询端点与字段（docs/api Unknowns #5），当前仅本地渲染预览
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
