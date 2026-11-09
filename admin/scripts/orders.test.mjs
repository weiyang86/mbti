import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'

const require = createRequire(import.meta.url)
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function evaluate(code, modules = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => modules[name] ?? require(name), ...globals })
  return module.exports
}
const model = evaluate(compile(source('../src/ops-order.ts')))
const id = 'MBTI-00000000-0000-4000-8000-000000000001'
// Synthetic contract fixture only. Never a real database order or acceptance result.
const fixture = (extra = {}) => ({ id, result_id: 'result-synthetic', product_code: 'basic', amount: 990, currency: 'CNY', status: 'pending', unlocked: false, created_at: '2026-11-10T00:00:00.000Z', payment_availability: 'unconfigured', pricing_mode: 'controlled_test_fixture', ...extra })
const apiCode = compile(source('../src/ops-api.ts'))
function client(respond, clock = { setTimeout, clearTimeout }) {
  const calls = []
  const api = evaluate(apiCode, { './ops-order': model }, {
    window: clock, AbortController, DOMException, Headers,
    fetch: async (path, init) => { calls.push({ path, init }); return respond(path, init, calls.length) },
  })
  return { api, calls }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

test('order identifier trims only edges, preserves case and rejects unsafe/oversized input before HTTP', async () => {
  assert.equal(model.normalizeOrderId('  MBTI-a_B-1  '), 'MBTI-a_B-1')
  assert.equal(model.orderPath(id), `/admin/mbti/orders/${encodeURIComponent(id)}`)
  const b = client(() => { throw new Error('must not request') })
  for (const value of ['', '   ', '../orders', 'MBTI/a', 'MBTI%2Fa', 'MBTI?a=1', 'MBTI#hash', '<script>', 'MBTI\u0000x', 'MBTI a', 'a'.repeat(129)]) {
    await assert.rejects(b.api.readOrder(value))
  }
  assert.equal(b.calls.length, 0)
})

test('reads raw MBTI response with exact same number/amount/currency and retains only public fields', async () => {
  const b = client(() => json(fixture({ provider_secret: 'synthetic-secret', pay_params: { secret: 'synthetic-secret' }, private_answers: ['synthetic-private'], contact: 'synthetic-contact' })))
  const order = await b.api.readOrder(` ${id} `)
  assert.equal(JSON.stringify(order), JSON.stringify(fixture()))
  assert.equal(b.calls[0].path, `/api/admin/mbti/orders/${id}`)
  assert.equal(b.calls[0].init.credentials, 'same-origin')
  assert.equal(b.calls[0].init.cache, 'no-store')
  assert.equal(b.calls[0].init.method ?? 'GET', 'GET')
  assert.equal(b.calls[0].init.headers.get('Authorization'), null)
  assert.doesNotMatch(JSON.stringify(order), /secret|private|contact|pay_params/)
})

test('rejects malformed, wrapped or mismatched 200 bodies instead of pretending a successful order', async () => {
  for (const payload of [null, {}, [], { success: true, data: fixture() }, fixture({ id: 'another-order' }), fixture({ amount: '990' }), fixture({ amount: -1 }), fixture({ amount: 1.1 }), fixture({ currency: 'cny' }), fixture({ unlocked: 'false' }), fixture({ created_at: 'invalid' }), fixture({ paid_at: null }), fixture({ status: '<script>' })]) {
    const b = client(() => json(payload))
    await assert.rejects(b.api.readOrder(id), error => error.status === 502 && error.code === 'INVALID_ORDER_RESPONSE')
  }
})

test('403, 404 and 5xx stay distinct and arbitrary server error text is never exposed', async () => {
  for (const status of [403, 404, 500, 502, 503]) {
    const b = client(() => json({ code: 'ERROR', message: 'synthetic-private-server-detail' }, status))
    await assert.rejects(b.api.readOrder(id), error => error.status === status && !error.message.includes('synthetic-private'))
    assert.equal(b.calls.length, 1)
  }
})

test('401 refresh uses Foundation envelopes then retries the raw endpoint once', async () => {
  let reads = 0
  const b = client(path => {
    if (path.endsWith('/auth/session')) return json({ success: true, data: { user: {}, csrfToken: 'synthetic-csrf' } })
    if (path.endsWith('/ops/session')) return json({ success: true, data: { capabilities: { orders: true } } })
    if (path.endsWith('/auth/logout')) return json({ success: true, data: {} })
    return ++reads === 1 ? json({}, 401) : json(fixture())
  })
  assert.equal((await b.api.readOrder(id)).id, id)
  assert.deepEqual(b.calls.map(call => call.path), [`/api/admin/mbti/orders/${id}`, '/api/auth/session', '/api/admin/mbti/ops/session', `/api/admin/mbti/orders/${id}`])
  await b.api.logout()
  assert.equal(b.calls.at(-1).init.headers.get('X-AIJ-CSRF'), 'synthetic-csrf')
  assert.equal(b.calls.at(-1).init.method, 'POST')
})

test('expired or repeatedly rejected sessions return 401 with no refresh loop', async () => {
  const expired = client(() => json({}, 401))
  await assert.rejects(expired.api.readOrder(id), error => error.status === 401)
  assert.equal(expired.calls.length, 2)
  const denied = client(path => path.endsWith('/auth/session') ? json({ success: true, data: { csrfToken: 'synthetic-csrf' } }) : path.endsWith('/ops/session') ? json({ success: true, data: {} }) : json({}, 401))
  await assert.rejects(denied.api.readOrder(id), error => error.status === 401)
  assert.equal(denied.calls.length, 4)
})

test('network and abort timeout fail safely', async () => {
  const offline = client(() => { throw new Error('synthetic-private-network-detail') })
  await assert.rejects(offline.api.readOrder(id), error => error.status === 0 && /网络/.test(error.message) && !error.message.includes('synthetic-private'))
  const timeout = client((_path, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))), { setTimeout: fn => setTimeout(fn, 1), clearTimeout })
  await assert.rejects(timeout.api.readOrder(id), error => error.status === 0 && /超时/.test(error.message))
})

// Exercise the actual Vue component with Vue's in-memory renderer. No browser login
// or live role acceptance is implied by these isolated component tests.
const { descriptor } = parse(source('../src/orders.vue'))
const componentCode = compile(compileScript(descriptor, { id: 'orders-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content)
function mountPage(readOrder) {
  globalThis.document = { activeElement: null }
  const node = (type, text = '') => ({ type, text, props: {}, children: [], parent: null, tagName: type.toUpperCase(), value: '', addEventListener() {}, removeEventListener() {} })
  const renderer = Vue.createRenderer({
    createElement: type => node(type), createText: text => node('#text', text), createComment: text => node('#comment', text),
    insert(el, parent, anchor = null) { if (el.parent) this.remove(el); el.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, el) },
    remove(el) { const i = el.parent?.children.indexOf(el) ?? -1; if (i >= 0) el.parent.children.splice(i, 1); el.parent = null },
    setText(el, text) { el.text = text }, setElementText(el, text) { el.text = text; el.children = [] },
    parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
    patchProp(el, key, _old, value) { el.props[key] = value },
  })
  const errors = client(() => json({})).api
  const component = evaluate(componentCode, { vue: Vue, './ops-order': model, './ops-api': { readOrder, OpsApiError: errors.OpsApiError }, './orders.css': {} }).default
  const root = node('root')
  let reauth = 0
  const app = renderer.createApp(component, { onReauthenticate: () => reauth++ })
  app.mount(root)
  const nodes = () => { const all = []; const visit = n => { all.push(n); n.children.forEach(visit) }; visit(root); return all }
  const text = () => nodes().filter(n => n.type !== '#comment').map(n => n.text).join(' ')
  const button = label => nodes().find(n => n.type === 'button' && n.text === label)
  const input = async value => { nodes().find(n => n.type === 'input').props['onUpdate:modelValue'](value); await Vue.nextTick() }
  const submit = async () => { const promise = nodes().find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); await Vue.nextTick(); return promise }
  return { app, nodes, text, button, input, submit, errors, reauth: () => reauth }
}
const flush = async () => { await Promise.resolve(); await Vue.nextTick(); await Vue.nextTick() }

test('component shows empty/loading/details, fen/currency, unknown codes and clears edited/late data', async () => {
  let resolve
  const p = mountPage(() => new Promise(done => { resolve = done }))
  assert.match(p.text(), /输入订单号开始核对/)
  await p.input(id)
  const pending = p.submit()
  await Vue.nextTick()
  assert.match(p.text(), /正在查询订单/)
  resolve(model.projectOrder(fixture(), id)); await pending; await flush()
  assert.match(p.text(), /990.*分 · CNY/)
  assert.match(p.text(), /待支付 · pending/)
  assert.match(p.text(), /未解锁/)
  assert.match(p.text(), new RegExp(id))
  await p.input('next-order')
  assert.doesNotMatch(p.text(), /990|result-synthetic/)
  const late = p.submit(); await Vue.nextTick()
  await p.input('different-order')
  resolve(model.projectOrder(fixture(), id)); await late; await flush()
  assert.doesNotMatch(p.text(), /990|result-synthetic/)
  p.app.unmount()
  const future = mountPage(async () => model.projectOrder(fixture({ status: 'future_status', amount: 0, paid_at: '2026-11-10T00:01:00.000Z' }), id))
  await future.input(id); await future.submit(); await flush()
  assert.match(future.text(), /未识别状态 · future_status/)
  assert.match(future.text(), /0.*分 · CNY/)
  assert.match(future.text(), /08:01:00/)
  future.app.unmount()
})

test('component maps real status values to separate denial/missing/login/error states and clears old details', async () => {
  for (const [status, title] of [[401, '登录已失效'], [403, '没有订单读取权限'], [404, '未找到此订单'], [500, '暂时无法查询'], [0, '暂时无法查询'], [502, '暂时无法查询']]) {
    let denied = false
    const p = mountPage(async () => { if (denied) throw new p.errors.OpsApiError(status, 'safe network message'); return model.projectOrder(fixture(), id) })
    await p.input(id); await p.submit(); await flush()
    assert.match(p.text(), /990/)
    denied = true; await p.submit(); await flush()
    assert.ok(p.text().includes(title), `${status}: ${p.text()}`)
    assert.doesNotMatch(p.text(), /990|result-synthetic/)
    if (status === 401) { p.button('重新核验登录').props.onClick(); assert.equal(p.reauth(), 1) }
    p.app.unmount()
  }
})

test('invalid input never requests; all unsupported order/fulfillment/code/local controls are disabled', async () => {
  let calls = 0
  const p = mountPage(async () => { calls++; return model.projectOrder(fixture(), id) })
  await p.input('../bad'); await p.submit(); await flush()
  assert.match(p.text(), /请检查订单号/); assert.equal(calls, 0)
  for (const label of ['交易订单', '生成任务', '体验兑换码', '本机前台订单']) {
    p.button(label).props.onClick(); await flush()
    assert.match(p.text(), /UI_CONTRACT/)
    const unsupported = p.nodes().filter(n => n.type === 'select' || n.type === 'button' && /未接通|上一页|下一页/.test(n.text))
    assert.ok(unsupported.length > 0)
    assert.ok(unsupported.every(n => n.props.disabled === '' || n.props.disabled === true))
  }
  assert.equal(calls, 0)
  p.app.unmount()
})

test('existing server order controller remains raw, no-store, and protected by exact Foundation guards/permission', () => {
  const controller = source('../../aij-foundation/apps/api/src/mbti/mbti-orders.controller.ts').split('// Existing Foundation Auth/RBAC')[1]
  assert.match(controller, /@SetMetadata\(MBTI_RAW, true\)/)
  assert.match(controller, /@UseGuards\(JwtAuthGuard, PermissionsGuard\)/)
  assert.match(controller, /@Get\(":id"\) @Permissions\("mbti:orders:read"\) @Header\("Cache-Control", "no-store"\)/)
  assert.doesNotMatch(controller, /@Post|@Patch|@Delete|@Put/)
})
