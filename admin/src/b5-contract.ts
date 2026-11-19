import { CONFIG_CONTRACT_VERSION, C2_DEPENDENCY, type Unavailable } from './config-contract-v1'

/** Consumer extension only. No HTTP routes, public/private payloads or revision IDs are inferred. */
export type B5Scope = 'ai-settings' | 'payment-settings' | 'trade-settings' | 'release'
export type B5Unknown = Readonly<{
  status: 'needs_human_review'
  value: unknown
  reason: string
}>
export const b5Unknowns: Readonly<Record<'schema' | 'authorization' | 'secretReferences' | 'revision' | 'history' | 'snapshots', B5Unknown>> = {
  schema: { status: 'needs_human_review', value: undefined, reason: 'C2 字段、公开/受限投影和端点映射尚未定稿。' },
  authorization: { status: 'needs_human_review', value: undefined, reason: '须由真实会话和服务端授权；客户端能力仅用于呈现。' },
  secretReferences: { status: 'needs_human_review', value: undefined, reason: '尚无获批的 MBTI 凭据引用投影；不接受引用或凭据输入。' },
  revision: { status: 'needs_human_review', value: undefined, reason: '预期版本、并发冲突和回滚目标均须服务端不透明标识。' },
  history: { status: 'needs_human_review', value: undefined, reason: '版本与审计列表、字段脱敏和分页尚未接通。' },
  snapshots: { status: 'needs_human_review', value: undefined, reason: '旧订单、未知规则及历史测评快照必须保留，兼容语义待 C2 核实。' },
}
export interface B5ConsumerBoundary {
  readonly version: typeof CONFIG_CONTRACT_VERSION
  readonly persistence: false
  read(scope: B5Scope): Promise<Unavailable>
  saveDraft(scope: B5Scope, candidate: B5Unknown): Promise<Unavailable>
  publish(expectedRevision: B5Unknown): Promise<Unavailable>
  rollback(target: B5Unknown, expectedRevision: B5Unknown): Promise<Unavailable>
}
export function unavailableB5Consumer(): B5ConsumerBoundary {
  const unavailable = async (): Promise<Unavailable> => ({ status: 'unavailable', reason: C2_DEPENDENCY })
  return { version: CONFIG_CONTRACT_VERSION, persistence: false, read: unavailable, saveDraft: unavailable, publish: unavailable, rollback: unavailable }
}
