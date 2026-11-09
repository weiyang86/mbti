import { request, useMock } from './client'
import type { SharePreviewResponse } from './types'
import * as mock from './mock/store'

export async function createSharePreview(body: {
  result_id: string
  template_id?: string
  scene?: 'moments' | 'avatar' | 'meet_card'
}) {
  if (useMock()) return mock.createSharePreview(body)
  const preview = await request<SharePreviewResponse>('/share/preview', { method: 'POST', data: body })
  if (preview.status !== 'ready' || !/^https?:\/\//i.test(preview.preview_url || '')) {
    throw new Error('分享预览未就绪')
  }
  return preview
}
