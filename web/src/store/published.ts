import { reactive } from 'vue'
import { readPublishedPreview, type PublishedContent, type PublishedCopy, type PublishedDiscovery, type PublishedPersona, type PublishedStyle } from '@/api/published-config'
import { DECLARATIONS, TYPE_NAMES } from '@/constants/types'
import { LIMITS } from '@/constants/copy'
import { INTERESTS, RECENT_STATES, STAGES } from '@/store/profile'
import { PLAN_NAMES, STUDIO_STYLES } from '@/store/studio'

/** Published display configuration shared by pages; local constants stay the fallback. */
export const published = reactive<{
  personas: Record<string, PublishedPersona> | null
  discovery: PublishedDiscovery | null
  content: PublishedContent | null
  styles: PublishedStyle[]
  copy: PublishedCopy | null
}>({ personas: null, discovery: null, content: null, styles: [], copy: null })

let loading: Promise<void> | null = null
let loaded = false

/** Loads once per app session; a browser refresh re-reads the published projection. */
export function ensurePublishedConfig(force = false): Promise<void> {
  if (loaded && !force) return Promise.resolve()
  if (loading) return loading
  loading = (async () => {
    try {
      const preview = await readPublishedPreview('微信小程序')
      if (!preview) return
      published.discovery = preview.discovery
      published.personas = preview.personas
      published.content = preview.content
      published.styles = preview.styles
      published.copy = preview.copy
      if (preview.copy) {
        const replace = (target: string[], source: string[]) => { target.splice(0, target.length, ...source) }
        replace(STAGES, preview.copy.stages)
        replace(RECENT_STATES, preview.copy.recentStatuses)
        replace(INTERESTS, preview.copy.interests)
        LIMITS.interests = preview.copy.maxInterests
      }
      if (preview.personas) {
        for (const [code, item] of Object.entries(preview.personas)) {
          TYPE_NAMES[code] = item.title
          DECLARATIONS[code] = item.quote
        }
      }
      for (const product of preview.products) {
        if (product.id === 'studio_tier_1') PLAN_NAMES[1] = product.title
        if (product.id === 'studio_tier_2') PLAN_NAMES[2] = product.title
      }
      for (const style of preview.styles) {
        const target = STUDIO_STYLES.find(item => item.key === style.id)
        if (target) target.label = style.title
      }
      loaded = true
    } finally { loading = null }
  })()
  return loading
}
