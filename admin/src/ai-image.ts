import { OpsApiError, request } from './ops-api'

export type ImageSize = '960*1280' | '1024*1024' | '720*1280'
export interface ImageTrialInput {
  requestId: string
  portrait: string
  style: string
  prompt: string
  size: ImageSize
  consent: true
}
export interface ImageTrialResult {
  contract: 'mbti-image/v1'
  requestId: string
  image: string
}

const sizes: ImageSize[] = ['960*1280', '1024*1024', '720*1280']

export async function generateAiImage(input: ImageTrialInput): Promise<ImageTrialResult> {
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(input.requestId)) throw new OpsApiError(422, '请求标识无效。')
  if (!sizes.includes(input.size)) throw new OpsApiError(422, '生成尺寸无效。')
  if (!input.prompt.trim() || input.prompt.length > 1800) throw new OpsApiError(422, '生成指令需为 1–1800 字。')
  if (input.consent !== true || !input.portrait || !input.style) throw new OpsApiError(422, '请先确认授权并选择两张图片。')
  const value = await request<unknown>('/admin/mbti/ai/image', { method: 'POST', body: JSON.stringify(input) }, true, false, 180_000)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new OpsApiError(502, '图像模型响应格式不正确。')
  const row = value as Record<string, unknown>
  if (row.contract !== 'mbti-image/v1' || row.requestId !== input.requestId ||
    typeof row.image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(row.image)) {
    throw new OpsApiError(502, '图像模型响应格式不正确。')
  }
  return { contract: 'mbti-image/v1', requestId: input.requestId, image: row.image }
}

export function imageTrialError(error: unknown): string {
  const status = error instanceof OpsApiError ? error.status : 0
  if (status === 401) return '登录已失效，请重新登录。'
  if (status === 403) return '当前账号缺少 admin.config.manage 权限。'
  if (status === 413) return '两张图片过大，请选择更小的图片。'
  if (status === 422) return '图片或生成参数无效。'
  if (status === 429) return '调用过于频繁，请稍后重试。'
  if (status === 503) return '请先在「AI 模型接入」中配置阿里云百炼、万相图像模型和 API Key。'
  if (status === 504) return '图像模型响应超时，请稍后重试。'
  if (status >= 500) return '图像模型暂不可用，请稍后重试。'
  return error instanceof Error ? error.message : '图像生成失败，请重试。'
}
