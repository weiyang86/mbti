/** UI_CONTRACT v1: normalized consumer operations, NOT an HTTP or authoritative payload schema.
 * C1/C2 must supply the adapter, permission checks, mapping and opaque revision semantics.
 * Endpoint, server fields, revision/conflict behavior: needs_human_review.
 */
export const CONFIG_CONTRACT_VERSION = 'mbti-config-consumer/v1' as const
export const C2_DEPENDENCY = 'C2 配置服务未接通，持久化不可用。' as const
export type ConfigScope = 'content' | 'catalog' | 'assessment'
export type ConfigView = 'draft' | 'published'
export type Unavailable = { status: 'unavailable'; reason: string }
export type ConsumerResult<T> = Unavailable | { status: 'ready'; value: T; revision: unknown }
export interface ConfigConsumerV1<T> {
  readonly version: typeof CONFIG_CONTRACT_VERSION
  readonly persistence: boolean
  read(scope: ConfigScope, view: ConfigView): Promise<ConsumerResult<T>>
  saveDraft(scope: ConfigScope, value: T, expectedRevision: unknown): Promise<ConsumerResult<T>>
  publish(expectedRevision: unknown): Promise<ConsumerResult<T>>
}
// No fallback persistence, simulated success, credentials, endpoint or browser storage.
export function unavailableConsumer<T>(): ConfigConsumerV1<T> {
  const unavailable = async (): Promise<Unavailable> => ({ status: 'unavailable', reason: C2_DEPENDENCY })
  return { version: CONFIG_CONTRACT_VERSION, persistence: false, read: unavailable, saveDraft: unavailable, publish: unavailable }
}
