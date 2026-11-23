import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText

class OpsApiError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

function load(reply) {
  const calls = []
  const module = { exports: {} }
  const request = async (path, init) => { calls.push([path, init]); return reply(path, init) }
  vm.runInNewContext(compile(source('../src/ai-provider.ts')), { module, exports: module.exports, require: name => {
    if (name === './ops-api') return { request, OpsApiError }
    throw Error('Unexpected module: ' + name)
  }, URL })
  return { api: module.exports, calls }
}

const catalog = { schemaVersion: 1, providers: [
  { code: 'deepseek', label: 'DeepSeek', category: 'model', fields: [{ key: 'baseUrl', label: 'API Base URL', kind: 'url', required: true, maxLength: 512 }], credentials: [{ key: 'apiKey', label: 'API Key 引用', required: true }] },
  { code: 'aliyun', label: '阿里云百炼', category: 'model', fields: [], credentials: [{ key: 'apiKey', label: 'API Key 引用', required: true }] },
  { code: 'qiniu', label: '七牛云', category: 'storage', fields: [], credentials: [] },
] }
const view = { providerCode: 'deepseek', version: 2, fields: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }, credentialStates: { apiKey: true }, missingFields: [], configurationStatus: 'credentials_ready', runtimeEnabled: false, externalVerification: 'not_run' }

test('AI provider model reads only the two model providers and rejects foreign payloads', async () => {
  const { api } = load(() => catalog)
  const providers = await api.readProviders()
  assert.deepEqual(providers.map(row => row.code), ['deepseek', 'aliyun'])
  const broken = load(() => ({ ...catalog, providers: [catalog.providers[2]] }))
  await assert.rejects(broken.api.readProviders(), error => error.status === 502)
})

test('saving an API key posts the write-only secret value and binds the returned local reference', async () => {
  const { api, calls } = load(path => {
    if (path === '/admin/secret-references/values') return { id: 's1', ref: 'local://mbti-foundation/development/MBTI_AI_DEEPSEEK_API_KEY', provider: 'local', status: 'active', configured: true, updatedAt: '2026-11-23T00:00:00.000Z' }
    return view
  })
  const secret = await api.saveApiKey('deepseek', 'sk-' + 'a'.repeat(40))
  assert.equal(secret.ref, 'local://mbti-foundation/development/MBTI_AI_DEEPSEEK_API_KEY')
  assert.deepEqual(JSON.parse(calls[0][1].body), { name: 'MBTI_AI_DEEPSEEK_API_KEY', value: 'sk-' + 'a'.repeat(40) })
  await api.saveService('deepseek', 2, ' https://api.deepseek.com ', ' deepseek-chat ', secret.ref)
  assert.equal(calls[1][0], '/admin/external-services/deepseek')
  assert.deepEqual(JSON.parse(calls[1][1].body), { expectedVersion: 2, fields: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' }, credentialRefs: { apiKey: secret.ref } })
})

test('AI provider errors stay actionable without echoing server text', () => {
  const { api } = load(() => view)
  assert.match(api.errorMessage(new OpsApiError(403, 'raw server text')), /admin\.config\.manage/)
  assert.match(api.errorMessage(new OpsApiError(503, 'raw server text')), /AIJ_SECRET_STORE_KEY/)
  assert.doesNotMatch(api.errorMessage(new OpsApiError(403, 'raw server text')), /raw server text/)
})
