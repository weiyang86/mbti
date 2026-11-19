import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'

export const BASE = 'https://mbti-dev.bestshizhongyu.com/api/v1'
export const API_BASELINE = '81279efd6f4c085060b7ab237236c16ec5a700ba'
export const GROUPS = [
  { id: 'F1', title: '基础与测评', description: '从独立游客到两次测评结果', count: 8 },
  { id: 'F2', title: '结果与分享', description: '本人历史、自选、对比与真实图片', count: 5 },
  { id: 'F3', title: '测试订单', description: '服务端商品、测试下单与本人权益', count: 5 },
  { id: 'F4', title: '名片与搭子', description: '字段可见性、屏蔽与双向交换', count: 12 },
  { id: 'F5', title: '联系方式授权', description: '明确渠道，批准后单向读取', count: 8 },
  { id: 'F6', title: '雷达参与', description: '参与可用，真实人数暂不可用', count: 3 },
]
export const SOURCES = [
  { id: 'F12', path: 'docs/integration/fastlane/MBTI-WebAPI-13.openapi.yaml', title: 'F1 / F2 原始候选', count: 13 },
  { id: 'F3', path: 'docs/integration/MBTI-F3-candidate.openapi.yaml', title: 'F3 交易候选', count: 5 },
  { id: 'F4', path: 'docs/integration/MBTI-F4-runtime-candidate.openapi.yaml', title: 'F4 名片交换候选', count: 12 },
  { id: 'F5', path: 'docs/integration/MBTI-F5-runtime-candidate.openapi.yaml', title: 'F5 联系授权候选', count: 8 },
  { id: 'F6', path: 'docs/integration/MBTI-F6-runtime-candidate.openapi.yaml', title: 'F6 参与及不可用候选', count: 3 },
]

// Existing requirement numbers and implemented routes; these are presentation labels,
// not new request/response fields or additional business rules.
const DEFINITIONS = [
  [1, 'F1', 'get', '/health', '业务探活'],
  [2, 'F1', 'post', '/auth/guest', '领取独立游客凭证'],
  [4, 'F1', 'get', '/quiz/versions/current', '读取当前 12 题题库'],
  [5, 'F1', 'post', '/quiz/sessions', '创建测评会话'],
  [6, 'F1', 'put', '/quiz/sessions/{session_id}/answers', '保存本次答案'],
  [7, 'F1', 'post', '/quiz/sessions/{session_id}/submit', '交卷并生成结果'],
  [8, 'F1', 'get', '/results', '读取本人结果列表'],
  [9, 'F1', 'get', '/results/{id}', '读取本人结果详情'],
  [10, 'F2', 'delete', '/results/{id}', '删除本人结果'],
  [11, 'F2', 'get', '/results/compare', '对比本人两次结果'],
  [12, 'F2', 'post', '/results', '保存自选类型结果'],
  [14, 'F2', 'get', '/types', '读取 16 型元数据'],
  [17, 'F2', 'post', '/share/preview', '生成真实分享预览图'],
  [47, 'F3', 'get', '/products', '读取服务端测试商品'],
  [48, 'F3', 'post', '/orders', '创建或复用本人测试订单'],
  [49, 'F3', 'get', '/orders', '读取本人订单列表'],
  [50, 'F3', 'get', '/orders/{id}', '查询本人订单状态'],
  [53, 'F3', 'get', '/entitlements/me', '读取本人权益'],
  [24, 'F4', 'get', '/cards/me', '读取本人私密名片'],
  [25, 'F4', 'put', '/cards/me', '保存本人名片及可见性'],
  [26, 'F4', 'get', '/cards/{card_id}', '读取当前允许的公开名片'],
  [27, 'F4', 'get', '/buddies', '发现公开搭子'],
  [28, 'F4', 'get', '/buddies/blocked', '读取本人屏蔽列表'],
  [29, 'F4', 'get', '/buddies/{buddy_id}', '读取搭子详情'],
  [30, 'F4', 'post', '/buddies/{buddy_id}/block', '屏蔽搭子'],
  [31, 'F4', 'delete', '/buddies/{buddy_id}/block', '解除本人发起的屏蔽'],
  [32, 'F4', 'get', '/card-exchanges', '读取本人名片交换记录'],
  [33, 'F4', 'post', '/card-exchanges', '发起名片交换'],
  [34, 'F4', 'post', '/card-exchanges/{id}/respond', '本人接受或拒绝名片交换'],
  [35, 'F4', 'delete', '/card-exchanges/{id}', '撤回本人发起的名片交换'],
  [36, 'F5', 'get', '/contacts/me', '读取本人私密联系渠道'],
  [37, 'F5', 'put', '/contacts/me', '整份替换本人联系渠道'],
  [38, 'F5', 'delete', '/contacts/me', '清除本人联系渠道'],
  [39, 'F5', 'get', '/contact-requests', '读取本人联系方式申请'],
  [40, 'F5', 'post', '/contact-requests', '申请对方的明确渠道'],
  [41, 'F5', 'post', '/contact-requests/{id}/respond', '本人批准或拒绝渠道申请'],
  [42, 'F5', 'delete', '/contact-requests/{id}', '撤回渠道申请或授权'],
  [43, 'F5', 'get', '/contact-requests/{id}/granted', '实时读取本次获批渠道'],
  [44, 'F6', 'get', '/radar/participation', '读取本人参与选择'],
  [45, 'F6', 'put', '/radar/participation', '保存本人加入或退出'],
  [46, 'F6', 'get', '/radar/same-type', '查询同型统计的可用状态'],
]

const canonical = path => path.replace(/\{[^}]+\}/g, '{}')
const key = (method, path) => `${method.toLowerCase()} ${canonical(path)}`
const definitions = new Map(DEFINITIONS.map(([number, group, method, path, summary]) => [key(method, path), { number, group, summary }]))

function migrateSchemas(value) {
  if (Array.isArray(value)) return value.map(migrateSchemas)
  if (!value || typeof value !== 'object') return value
  // Annotation values are domain data, not nested Schema Objects.
  const literals = new Set(['example', 'examples', 'default', 'enum', 'const'])
  const result = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, literals.has(name) ? structuredClone(child) : migrateSchemas(child)]))
  if (Object.hasOwn(result, 'nullable')) {
    if (result.nullable === true) {
      if (typeof result.type === 'string') result.type = [result.type, 'null']
      else if (Array.isArray(result.type) && !result.type.includes('null')) result.type.push('null')
      else if (result.$ref) {
        const reference = result.$ref
        delete result.$ref
        result.anyOf = [{ $ref: reference }, { type: 'null' }]
      }
      if (Array.isArray(result.enum) && !result.enum.includes(null)) result.enum.push(null)
    }
    delete result.nullable
  }
  for (const [exclusive, inclusive] of [['exclusiveMinimum', 'minimum'], ['exclusiveMaximum', 'maximum']]) {
    if (typeof result[exclusive] === 'boolean') {
      if (result[exclusive] && typeof result[inclusive] === 'number') {
        result[exclusive] = result[inclusive]
        delete result[inclusive]
      } else delete result[exclusive]
    }
  }
  return result
}

function namespace(value, prefix) {
  if (Array.isArray(value)) return value.map(child => namespace(child, prefix))
  if (!value || typeof value !== 'object') return value
  const result = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, namespace(child, prefix)]))
  if (typeof result.$ref === 'string' && result.$ref.startsWith('#/components/')) {
    result.$ref = result.$ref.replace(/^(#\/components\/[^/]+\/)([^/]+)/, `$1${prefix}_$2`)
  }
  if (Array.isArray(result.security)) result.security = result.security.map(requirement => Object.fromEntries(Object.entries(requirement).map(([name, scopes]) => [`${prefix}_${name}`, scopes])))
  if (result.discriminator?.mapping) {
    result.discriminator.mapping = Object.fromEntries(Object.entries(result.discriminator.mapping).map(([name, ref]) => [name, ref.startsWith('#/components/') ? ref.replace(/^(#\/components\/[^/]+\/)([^/]+)/, `$1${prefix}_$2`) : ref]))
  }
  return result
}

export function resolve(document, object) {
  let value = object
  const seen = new Set()
  while (value?.$ref) {
    const ref = value.$ref
    if (!ref.startsWith('#/')) throw new Error(`External reference is not bundled: ${ref}`)
    if (seen.has(ref)) throw new Error(`Reference cycle: ${ref}`)
    seen.add(ref)
    const target = ref.slice(2).split('/').reduce((node, segment) => node?.[segment.replace(/~1/g, '/').replace(/~0/g, '~')], document)
    if (!target) throw new Error(`Unresolved reference: ${ref}`)
    const { $ref: ignored, ...siblings } = value
    value = { ...target, ...siblings }
  }
  return value
}

export function validateReferences(document) {
  const visit = value => {
    if (!value || typeof value !== 'object') return
    if (value.$ref) resolve(document, value)
    for (const child of Object.values(value)) visit(child)
  }
  visit(document)
}

export function assemble(sources) {
  const document = {
    openapi: '3.1.1',
    info: {
      title: 'MBTI Web API · 开发联调参考',
      version: '0.4.0-reference-candidate.1',
      description: '内部候选 / needs_human_review。40项可联调，#46仅提供明确不可用分支；真实支付与真实位置统计未开放。此文件汇总现有候选，不替代docs/api正式契约。',
    },
    servers: [{ url: BASE, description: 'HTTPS 公网开发联调环境' }],
    tags: GROUPS.map(group => ({ name: group.id, description: `${group.title} · ${group.description}` })),
    'x-status': 'candidate / needs_human_review',
    'x-api-validated-revision': API_BASELINE,
    'x-real-payments': 'unconfigured',
    'x-real-location-aggregation': 'blocked_external / not_available',
    'x-sources': [],
    paths: {},
    components: {},
  }
  const seen = new Set()
  for (const source of sources) {
    const migrated = source.document.openapi.startsWith('3.0.') ? migrateSchemas(source.document) : source.document
    const prepared = namespace(migrated, source.id)
    document['x-sources'].push({ id: source.id, path: source.path, sha256: source.sha256, title: source.title, version: source.document.info.version, originalOpenapi: source.document.openapi })
    for (const [category, items] of Object.entries(prepared.components ?? {})) {
      document.components[category] ??= {}
      for (const [name, value] of Object.entries(items)) document.components[category][`${source.id}_${name}`] = value
    }
    let count = 0
    for (const [path, item] of Object.entries(prepared.paths)) {
      const common = item.parameters ?? []
      for (const [method, operation] of Object.entries(item)) {
        if (!['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method)) continue
        const id = key(method, path)
        const definition = definitions.get(id)
        if (!definition || seen.has(id)) throw new Error(`Unknown or duplicate operation: ${id}`)
        seen.add(id)
        const result = { ...operation }
        result.parameters = [...common, ...(operation.parameters ?? [])]
        if (!result.parameters.length) delete result.parameters
        result.security = operation.security ?? prepared.security ?? []
        result.tags = [definition.group]
        result.operationId = `mbti_${definition.number}_${method}`
        result['x-source-summary'] = operation.summary ?? ''
        result.summary = definition.summary
        result['x-requirement-number'] = definition.number
        result['x-delivery-wave'] = definition.group
        result['x-availability'] = definition.number === 46 ? 'unavailable' : 'ready'
        result['x-contract-source'] = source.path
        if (operation.servers) throw new Error(`Review operation-specific server before publishing: ${id}`)
        document.paths[path] ??= {}
        document.paths[path][method] = result
        count++
      }
    }
    if (count !== source.count) throw new Error(`Unexpected operation count in ${source.id}: ${count}`)
  }
  if (seen.size !== DEFINITIONS.length) throw new Error(`Expected 41 operations, got ${seen.size}`)
  validateReferences(document)
  return document
}

export async function loadSources(root) {
  return Promise.all(SOURCES.map(async source => {
    const content = await readFile(new URL(source.path, root), 'utf8')
    const document = parse(content, { uniqueKeys: true, maxAliasCount: 100 })
    return { ...source, document, sha256: createHash('sha256').update(content).digest('hex') }
  }))
}

export function embeddedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}
