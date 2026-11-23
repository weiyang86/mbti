import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
class OpsApiError extends Error { constructor(status, message) { super(message); this.status = status } }
const png = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, ...Array(64).fill(7)]).toString('base64')
const input = { requestId: 'admin_image_0001', portrait: png, style: png, prompt: 'fixture', size: '960*1280', consent: true }

function load(reply) {
  const calls = [], module = { exports: {} }
  vm.runInNewContext(compile(source('../src/ai-image.ts')), { module, exports: module.exports, require: name => {
    if (name === './ops-api') return { request: async (...args) => { calls.push(args); return reply() }, OpsApiError }
    throw Error('Unexpected module: ' + name)
  } })
  return { api: module.exports, calls }
}

test('image trial posts the strict contract with a 180s timeout and validates the data URL', async () => {
  const { api, calls } = load(() => ({ contract: 'mbti-image/v1', requestId: input.requestId, image: png }))
  const result = await api.generateAiImage(input)
  assert.equal(result.image, png)
  assert.equal(calls[0][0], '/admin/mbti/ai/image')
  assert.equal(calls[0][4], 180_000)
  assert.deepEqual(JSON.parse(calls[0][1].body), input)
  const forged = load(() => ({ contract: 'mbti-image/v1', requestId: input.requestId, image: 'https://evil.example/x.png' }))
  await assert.rejects(forged.api.generateAiImage(input), error => error.status === 502)
})

test('image trial rejects invalid input before HTTP and keeps actionable errors', async () => {
  const { api, calls } = load(() => ({ contract: 'mbti-image/v1', requestId: input.requestId, image: png }))
  await assert.rejects(api.generateAiImage({ ...input, prompt: '' }), error => error.status === 422)
  await assert.rejects(api.generateAiImage({ ...input, consent: false }), error => error.status === 422)
  assert.equal(calls.length, 0)
  assert.match(api.imageTrialError(new OpsApiError(503, 'raw')), /阿里云百炼/)
  assert.match(api.imageTrialError(new OpsApiError(403, 'raw')), /admin\.config\.manage/)
  assert.doesNotMatch(api.imageTrialError(new OpsApiError(503, 'raw')), /raw/)
})
