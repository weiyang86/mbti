import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { assemble, embeddedJson, loadSources, resolve, validateReferences, GROUPS } from './reference.mjs'

const root = new URL('../../', import.meta.url)
const sources = await loadSources(root)
const document = assemble(sources)
const entries = Object.entries(document.paths).flatMap(([path, item]) => Object.entries(item).map(([method, operation]) => ({ path, method, operation })))
const byNumber = number => entries.find(item => item.operation['x-requirement-number'] === number)

test('all original candidate operations survive: 40 ready and exactly one unavailable', () => {
  assert.equal(entries.length, 41)
  assert.equal(new Set(entries.map(({ operation }) => operation.operationId)).size, 41)
  assert.equal(entries.filter(({ operation }) => operation['x-availability'] === 'ready').length, 40)
  assert.deepEqual(entries.filter(({ operation }) => operation['x-availability'] === 'unavailable').map(({ operation }) => operation['x-requirement-number']), [46])
  for (const group of GROUPS) assert.equal(entries.filter(({ operation }) => operation.tags[0] === group.id).length, group.count)
  assert.equal(document['x-real-payments'], 'unconfigured')
  assert.equal(document['x-real-location-aggregation'], 'blocked_external / not_available')
})

test('guest security and inherited path parameters are preserved separately from public endpoints', () => {
  assert.deepEqual(byNumber(1).operation.security, [])
  assert.deepEqual(byNumber(2).operation.security, [])
  for (const { operation } of entries.filter(item => ![1, 2].includes(item.operation['x-requirement-number']))) {
    assert.equal(operation.security.length, 1)
    const [scheme] = Object.keys(operation.security[0])
    assert.equal(document.components.securitySchemes[scheme].name, 'X-Guest-Token')
  }
  const parameter = resolve(document, byNumber(6).operation.parameters[0])
  assert.equal(parameter.in, 'path')
  assert.equal(parameter.required, true)
  assert.equal(parameter.name, 'session_id')
  assert.equal(byNumber(48).operation.parameters.find(item => item.name === 'Idempotency-Key').required, true)
})

test('colliding Error schemas/responses remain isolated and every bundled reference resolves', () => {
  validateReferences(document)
  for (const source of ['F12', 'F4', 'F5', 'F6']) assert.ok(document.components.schemas[`${source}_Error`])
  const damaged = structuredClone(document)
  delete damaged.components.schemas.F6_Error
  assert.throws(() => validateReferences(damaged), /Unresolved reference/)
})

test('3.0 nullable becomes 3.1 null type; annotation data is not rewritten', () => {
  const pagination = resolve(document, byNumber(49).operation.responses['200'].content['application/json'].schema)
  assert.deepEqual(pagination.properties.next_cursor.type, ['string', 'null'])
  const count = document.components.schemas.F6_Unavailable.properties.count
  assert.deepEqual(count.enum, [null])
  assert.ok(count.type.includes('null'))
  assert.equal(Object.hasOwn(count, 'nullable'), false)
  const copy = structuredClone(sources)
  copy[0].document.paths['/health'].get.responses['200'].content['application/json'].example = { type: 'string', nullable: true }
  const merged = assemble(copy)
  assert.deepEqual(merged.paths['/health'].get.responses['200'].content['application/json'].example, { type: 'string', nullable: true })
})

test('removing or duplicating operations fails the build instead of silently publishing partial docs', () => {
  const missing = structuredClone(sources)
  delete missing[1].document.paths['/products'].get
  assert.throws(() => assemble(missing), /Unexpected operation count/)
  assert.throws(() => assemble([...sources, sources[4]]), /Unknown or duplicate operation/)
})

test('radar stays unavailable and contact/ordering semantics retain their source response codes', () => {
  const radar = document.components.schemas.F6_Unavailable
  assert.deepEqual(radar.required, ['count', 'status', 'reason'])
  assert.deepEqual(radar.properties.status.enum, ['unavailable'])
  assert.deepEqual(radar.properties.reason.enum, ['not_enrolled', 'location_source_not_configured'])
  assert.ok(byNumber(48).operation.responses['201'])
  assert.ok(byNumber(33).operation.responses['201'])
  assert.ok(byNumber(33).operation.responses['200'])
  assert.ok(byNumber(43).operation.responses['404'])
  assert.equal(byNumber(38).operation.responses['204'].content, undefined)
})

test('embedded untrusted descriptions cannot end the JSON script element', () => {
  const original = { description: '</script><img src=x onerror=alert(1)>\u2028\u2029' }
  const encoded = embeddedJson(original)
  assert.equal(encoded.includes('<'), false)
  assert.deepEqual(JSON.parse(encoded), original)
})

test('standalone HTML has inline payload/assets and forbids API connections', async () => {
  const html = await readFile(new URL('index.html', import.meta.url), 'utf8')
  assert.match(html, /connect-src 'none'/)
  assert.equal(/<script[^>]+src=/i.test(html), false)
  assert.equal(/<link[^>]+stylesheet/i.test(html), false)
  const json = html.match(/<script id="reference-data" type="application\/json">([\s\S]*?)<\/script>/)[1]
  const data = JSON.parse(json)
  assert.deepEqual(data.document, document)
  assert.equal(data.quizExample.questions.length, 12)
  assert.equal(data.quizExample.question_bank_version, 'qb-v0.4-prototype-1')
  assert.deepEqual(JSON.parse(await readFile(new URL('openapi.json', import.meta.url), 'utf8')), document)
  const app = await readFile(new URL('page.js', import.meta.url), 'utf8')
  assert.ok(html.includes(`<script>${app}</script>`), 'inline script must be byte-identical, including literal replacement tokens')
})
