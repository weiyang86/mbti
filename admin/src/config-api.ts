/** C1 internal candidate adapter; never the formal MBTI API contract. No cached drafts or persistence fallback. */
import { request } from './ops-api'
export const categoryKeys = ['content', 'channels', 'catalog', 'assessment', 'personas', 'imageRecipes', 'retention', 'discovery', 'aiRuntime', 'payments', 'trade'] as const
export type Category = typeof categoryKeys[number]
export interface Projection {
  schema: 'mbti-config-candidate/v1'
  status: 'needs_human_review'
  unknowns: unknown
  view: 'draft' | 'published'
  state: 'published' | 'UNCONFIGURED'
  expectedVersion: number
  expectedDraftVersion: number
  source: { projectId: string; environment: string; pluginCode: string }
  authorization: { canSaveDraft: boolean; canPublish: boolean; canReadSystem: boolean }
  categories: Partial<Record<Category, unknown>>
  diff: Category[]
}
export interface VersionRecord { version: number; event: string; auditLogId: string; createdAt: string; categories: Category[]; id?: string }
export type Commit = { version: number; auditLogId: string; diff: Category[] }
export const pageCategories: Record<string, Category[]> = {
  content: ['content', 'channels'], catalog: ['catalog'], assessment: ['assessment', 'personas'], ai: ['imageRecipes'],
  retention: ['retention'], social: ['discovery'], 'ai-settings': ['aiRuntime'], 'payment-settings': ['payments'], 'trade-settings': ['trade'], release: [...categoryKeys],
}
function revision(value: number) { if (!Number.isSafeInteger(value) || value < 0 || value > 2147483645) throw new Error('请重新读取服务端修订号。'); return value }
export function validateProjection(value: Projection): Projection {
  if (!value || value.schema !== 'mbti-config-candidate/v1' || value.status !== 'needs_human_review' || !['draft', 'published'].includes(value.view) ||
      !value.source?.projectId || value.source.pluginCode !== 'mbti-config' || !value.categories || !Array.isArray(value.diff) ||
      typeof value.authorization?.canPublish !== 'boolean' || typeof value.authorization?.canSaveDraft !== 'boolean' || typeof value.authorization?.canReadSystem !== 'boolean') throw new Error('配置响应格式不正确，请重新读取。')
  revision(value.expectedVersion); revision(value.expectedDraftVersion)
  return value
}
const root = '/plugins/mbti-config'
export const configApi = {
  async read(view: 'draft' | 'published') { return validateProjection(await request<Projection>(`${root}/${view}`)) },
  async save(category: Category, value: unknown, expectedDraftVersion: number) {
    if (!categoryKeys.includes(category)) throw new Error('不支持的配置类别。')
    return validateProjection(await request<Projection>(`${root}/draft/${category}`, { method: 'PATCH', body: JSON.stringify({ value, expectedDraftVersion: revision(expectedDraftVersion) }) }))
  },
  publish(expectedVersion: number, expectedDraftVersion: number) { return request<Commit>(`${root}/publish`, { method: 'POST', body: JSON.stringify({ expectedVersion: revision(expectedVersion), expectedDraftVersion: revision(expectedDraftVersion) }) }) },
  rollback(target: number, expectedVersion: number) { if (revision(target) < 1) throw new Error('请选择已发布版本。'); return request<Commit>(`${root}/versions/${target}/rollback`, { method: 'POST', body: JSON.stringify({ expectedVersion: revision(expectedVersion) }) }) },
  versions() { return request<VersionRecord[]>(`${root}/versions`) },
  audit() { return request<VersionRecord[]>(`${root}/audit`) },
  version(target: number) { if (revision(target) < 1) throw new Error('请选择已发布版本。'); return request<{ version: number; categories: Partial<Record<Category, unknown>> }>(`${root}/versions/${target}`) },
}
export type ConfigApi = typeof configApi
