/** Internal C2 candidate. Public server route is hard disabled pending Remy's approval. */
import { publicRequest, useMock } from './client'
export const publicChannelNames = { '微信小程序': 'wechat', '公众号 H5': 'mp', '抖音小程序': 'douyin', '小红书小程序': 'xhs' } as const
export type PublicChannelName = keyof typeof publicChannelNames
export type PublicChannel = typeof publicChannelNames[PublicChannelName]
export function publicChannel(name: unknown): PublicChannel | null {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(publicChannelNames, name) ? publicChannelNames[name as PublicChannelName] : null
}
export interface PublishedPreview {
  projectId: string
  channel: PublicChannel
  publishedVersion: number
  cacheIdentity: string
  content: { headline: string; accent: string; sub: string; cta: string } | null
  entry: { name: string; landing: string; badge: string } | null
  products: { id: string; title: string; desc: string }[]
}
const allowed = ['content', 'channels', 'catalog', 'assessment', 'personas', 'imageRecipes', 'retention', 'discovery']
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100 && !/[<>\u0000-\u001f]/.test(value)
export function publishedPreview(value: unknown, channel: PublicChannel): PublishedPreview | null {
  if (!record(value) || value.schema !== 'mbti-config-candidate/v1' || value.view !== 'published' || value.channel !== channel ||
      typeof value.projectId !== 'string' || !value.projectId || !Number.isSafeInteger(value.publishedVersion) || Number(value.publishedVersion) < 1 ||
      value.cacheIdentity !== JSON.stringify([value.projectId, channel, value.publishedVersion]) || !record(value.categories) ||
      Object.keys(value.categories).some(key => !allowed.includes(key))) return null
  const c = value.categories, content = c.content, channels = c.channels, catalog = c.catalog
  if (channels !== null && (!record(channels) || Object.keys(channels).length !== 1 || !Object.prototype.hasOwnProperty.call(channels, channel))) return null
  const entry = record(channels) ? channels[channel] : null
  if (content !== null && (!record(content) || !['headline', 'accent', 'sub', 'cta'].every(key => text(content[key])))) return null
  if (entry !== null && (!record(entry) || !text(entry.name) || !text(entry.badge) || !['home', 'pricing', 'test-intro', 'discover', 'history'].includes(String(entry.landing)))) return null
  if (catalog !== null && (!record(catalog) || !Array.isArray(catalog.shop))) return null
  const products: PublishedPreview['products'] = []
  if (record(catalog) && Array.isArray(catalog.shop)) {
    for (const product of catalog.shop) {
      if (!record(product) || !text(product.id) || !text(product.title) || !text(product.desc) || typeof product.on !== 'boolean') return null
      if (product.on) products.push({ id: product.id, title: product.title, desc: product.desc })
    }
  }
  // Copy only compatible display fields. Candidate prices/questions/personas cannot overwrite business snapshots.
  return { projectId: value.projectId, channel, publishedVersion: Number(value.publishedVersion), cacheIdentity: value.cacheIdentity as string,
    content: record(content) ? { headline: content.headline as string, accent: content.accent as string, sub: content.sub as string, cta: content.cta as string } : null,
    entry: record(entry) ? { name: entry.name as string, landing: entry.landing as string, badge: entry.badge as string } : null, products }
}
/** Every call revalidates the source; no localStorage, shared response cache, draft, guest or private payload. */
export async function readPublishedPreview(name: unknown): Promise<PublishedPreview | null> {
  const channel = publicChannel(name)
  if (!channel || useMock()) return null
  try { return publishedPreview(await publicRequest<unknown>(`/config/published?channel=${channel}`), channel) }
  catch { return null } // Includes hard-disabled/uninstalled/403/503: caller keeps its existing fallback.
}
export const landingRoutes: Record<string, string> = { home: '/pages/index/index', pricing: '/pages/pricing/pricing', 'test-intro': '/pages/index/index', discover: '/pages/discover/discover', history: '/pages/history/list' }
