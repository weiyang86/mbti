/** Public published projection (candidate schema); values come from the approved anonymous route. */
import { publicRequest, useMock } from './client'
export const publicChannelNames = { '微信小程序': 'wechat', '公众号 H5': 'mp', '抖音小程序': 'douyin', '小红书小程序': 'xhs' } as const
export type PublicChannelName = keyof typeof publicChannelNames
export type PublicChannel = typeof publicChannelNames[PublicChannelName]
export function publicChannel(name: unknown): PublicChannel | null {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(publicChannelNames, name) ? publicChannelNames[name as PublicChannelName] : null
}
export interface PublishedPersona { title: string; quote: string; recharge: string; communication: string; care: string }
export interface PublishedDiscovery { order: 'same' | 'recommend'; daily: number; radar: boolean; radius: number; minimum: number }
export interface PublishedContent { headline: string; accent: string; sub: string; cta: string; moments?: string; avatar?: string; meet?: string; caption?: string }
export interface PublishedStyle { id: string; title: string; art: string; on: boolean; order: number }
export interface PublishedCopy {
  stages: string[]
  recentStatuses: string[]
  interests: string[]
  maxInterests: number
  compare: { title: string; accent: string; description: string; emptyTitle: string; emptyAccent: string; emptyDescription: string }
  pages?: Record<string, string>
}
export interface PublishedPreview {
  projectId: string
  channel: PublicChannel
  publishedVersion: number
  cacheIdentity: string
  content: PublishedContent | null
  entry: { name: string; landing: string; badge: string } | null
  products: { id: string; title: string; desc: string; amount: number; on: boolean }[]
  styles: PublishedStyle[]
  personas: Record<string, PublishedPersona> | null
  discovery: PublishedDiscovery | null
  copy: PublishedCopy | null
}
const allowed = ['content', 'channels', 'catalog', 'assessment', 'personas', 'imageRecipes', 'retention', 'discovery', 'copy']
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100 && !/[<>\u0000-\u001f]/.test(value)
export function publishedPreview(value: unknown, channel: PublicChannel): PublishedPreview | null {
  if (!record(value) || value.schema !== 'mbti-config-candidate/v1' || value.view !== 'published' || value.channel !== channel ||
      typeof value.projectId !== 'string' || !value.projectId || !Number.isSafeInteger(value.publishedVersion) || Number(value.publishedVersion) < 1 ||
      value.cacheIdentity !== JSON.stringify([value.projectId, channel, value.publishedVersion]) || !record(value.categories) ||
      Object.keys(value.categories).some(key => !allowed.includes(key))) return null
  const c = value.categories as Record<string, unknown>
  const content = c.content, channels = c.channels, catalog = c.catalog, rawPersonas = c.personas, rawDiscovery = c.discovery
  if (channels !== null && (!record(channels) || Object.keys(channels).length !== 1 || !Object.prototype.hasOwnProperty.call(channels, channel))) return null
  const entry = record(channels) ? channels[channel] : null
  if (content !== null && (!record(content) || !['headline', 'accent', 'sub', 'cta'].every(key => text(content[key])))) return null
  if (record(content) && ['moments', 'avatar', 'meet', 'caption'].some(key => content[key] !== undefined && !text(content[key]))) return null
  if (entry !== null && (!record(entry) || !text(entry.name) || !text(entry.badge) || !['home', 'pricing', 'test-intro', 'discover', 'history'].includes(String(entry.landing)))) return null
  if (catalog !== null && (!record(catalog) || !Array.isArray(catalog.shop))) return null
  const products: PublishedPreview['products'] = []
  if (record(catalog) && Array.isArray(catalog.shop)) {
    for (const product of catalog.shop) {
      if (!record(product) || !text(product.id) || !text(product.title) || !text(product.desc) || typeof product.on !== 'boolean') return null
      products.push({ id: product.id, title: product.title, desc: product.desc, amount: Number(product.cents), on: product.on })
    }
  }
  const styles: PublishedStyle[] = []
  if (record(catalog) && Array.isArray(catalog.styles)) {
    for (const style of catalog.styles) {
      if (!record(style) || !text(style.id) || !text(style.title) || !text(style.art) || typeof style.on !== 'boolean' ||
          !Number.isSafeInteger(style.order)) return null
      styles.push({ id: style.id, title: style.title, art: style.art, on: style.on, order: Number(style.order) })
    }
    styles.sort((a, b) => a.order - b.order)
  }
  const personaCodes = ['E', 'I'].flatMap(a => ['S', 'N'].flatMap(b => ['T', 'F'].flatMap(d => ['J', 'P'].map(e => a + b + d + e))))
  let personas: PublishedPreview['personas'] = null
  if (rawPersonas !== null) {
    if (!record(rawPersonas)) return null
    const parsed: Record<string, PublishedPersona> = {}
    for (const code of personaCodes) {
      const item = rawPersonas[code]
      if (!record(item) || !['title', 'quote', 'recharge', 'communication', 'care'].every(key => text(item[key]))) return null
      parsed[code] = { title: item.title as string, quote: item.quote as string, recharge: item.recharge as string,
        communication: item.communication as string, care: item.care as string }
    }
    personas = parsed
  }
  let discovery: PublishedPreview['discovery'] = null
  if (rawDiscovery !== null) {
    if (!record(rawDiscovery) || !['same', 'recommend'].includes(String(rawDiscovery.order)) ||
        !Number.isSafeInteger(rawDiscovery.daily) || Number(rawDiscovery.daily) < 1 || Number(rawDiscovery.daily) > 30 ||
        typeof rawDiscovery.radar !== 'boolean' || ![500, 1000, 3000].includes(Number(rawDiscovery.radius)) ||
        !Number.isSafeInteger(rawDiscovery.minimum) || Number(rawDiscovery.minimum) < 10 || Number(rawDiscovery.minimum) > 200) return null
    discovery = { order: rawDiscovery.order as 'same' | 'recommend', daily: Number(rawDiscovery.daily), radar: rawDiscovery.radar,
      radius: Number(rawDiscovery.radius), minimum: Number(rawDiscovery.minimum) }
  }
  const rawCopy = c.copy
  let copy: PublishedPreview['copy'] = null
  if (rawCopy !== null) {
    const list = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(text)
    const compare = record(rawCopy) ? rawCopy.compare : null
    if (!record(rawCopy) || !list(rawCopy.stages) || !list(rawCopy.recentStatuses) || !list(rawCopy.interests) ||
        !Number.isSafeInteger(rawCopy.maxInterests) || Number(rawCopy.maxInterests) < 1 || Number(rawCopy.maxInterests) > 10 ||
        !record(compare) || !['title', 'accent', 'description', 'emptyTitle', 'emptyAccent', 'emptyDescription'].every(key => text(compare[key]))) return null
    const pages: Record<string, string> = {}
    const rawPages = record(rawCopy) ? rawCopy.pages : undefined
    if (rawPages !== undefined && rawPages !== null) {
      if (!record(rawPages)) return null
      for (const [route, title] of Object.entries(rawPages)) if (text(title)) pages[route] = title
    }
    copy = { stages: rawCopy.stages, recentStatuses: rawCopy.recentStatuses, interests: rawCopy.interests,
      maxInterests: Number(rawCopy.maxInterests),
      compare: { title: compare.title as string, accent: compare.accent as string, description: compare.description as string,
        emptyTitle: compare.emptyTitle as string, emptyAccent: compare.emptyAccent as string, emptyDescription: compare.emptyDescription as string },
      ...(Object.keys(pages).length ? { pages } : {}) }
  }
  // Copy only compatible display fields. Candidate prices/questions cannot overwrite business snapshots.
  return { projectId: value.projectId, channel, publishedVersion: Number(value.publishedVersion), cacheIdentity: value.cacheIdentity as string,
    content: record(content) ? { headline: content.headline as string, accent: content.accent as string, sub: content.sub as string, cta: content.cta as string,
      ...(text(content.moments) ? { moments: content.moments } : {}), ...(text(content.avatar) ? { avatar: content.avatar } : {}),
      ...(text(content.meet) ? { meet: content.meet } : {}), ...(text(content.caption) ? { caption: content.caption } : {}) } : null,
    entry: record(entry) ? { name: entry.name as string, landing: entry.landing as string, badge: entry.badge as string } : null,
    products, styles, personas, discovery, copy }
}
/** Every call revalidates the source; no localStorage, shared response cache, draft, guest or private payload. */
export async function readPublishedPreview(name: unknown): Promise<PublishedPreview | null> {
  const channel = publicChannel(name)
  if (!channel || useMock()) return null
  try { return publishedPreview(await publicRequest<unknown>(`/config/published?channel=${channel}`), channel) }
  catch { return null } // Includes hard-disabled/uninstalled/403/503: caller keeps its existing fallback.
}
export const landingRoutes: Record<string, string> = { home: '/pages/index/index', pricing: '/pages/pricing/pricing', 'test-intro': '/pages/index/index', discover: '/pages/discover/discover', history: '/pages/history/list' }
