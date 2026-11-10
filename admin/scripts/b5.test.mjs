import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const effects = []
const forbidden = name => () => { effects.push(name); throw Error('Forbidden B5 side effect: ' + name) }
const trap = name => new Proxy({}, { get: forbidden(name), set: forbidden(name) })
const isolation = { fetch: forbidden('fetch'), XMLHttpRequest: forbidden('xhr'), WebSocket: forbidden('socket'), EventSource: forbidden('sse'), localStorage: trap('localStorage'), sessionStorage: trap('sessionStorage'), indexedDB: trap('indexedDB'), navigator: trap('navigator'), postMessage: forbidden('message'), console: trap('log'), history: trap('history') }
function evaluate(code, modules = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => { if (!(name in modules)) throw Error('Unexpected module: ' + name); return modules[name] }, Error, Date, JSON, ...isolation, ...globals })
  return module.exports
}
const core = evaluate(compile(source('../src/config-contract-v1.ts')))
const contract = evaluate(compile(source('../src/b5-contract.ts')), { './config-contract-v1': core })
const model = evaluate(compile(source('../src/b5-model.ts')))
const plain = value => JSON.parse(JSON.stringify(value))
const flush = async () => { for (let i = 0; i < 7; i++) await Vue.nextTick() }
const sfc = path => compile(compileScript(parse(source(path)).descriptor, { id: 'b5-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content)
const componentCode = sfc('../src/b5.vue'), opsCode = sfc('../src/ops.vue')
function host() {
  const document = { activeElement: null, querySelector: () => null, querySelectorAll: () => [] }
  globalThis.document = document
  const node = (type, text = '') => ({ type, text, children: [], props: {}, parent: null, tagName: type.toUpperCase(), value: '', get options() { return this.children.filter(n => n.type === 'option') }, addEventListener() {}, removeEventListener() {}, focus() { document.activeElement = this } })
  const renderer = Vue.createRenderer({ createElement: type => node(type), createText: text => node('#text', text), createComment: text => node('#comment', text), insert(el, parent, anchor = null) { if (el.parent) this.remove(el); el.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, el) }, remove(el) { const i = el.parent?.children.indexOf(el) ?? -1; if (i >= 0) el.parent.children.splice(i, 1); el.parent = null }, setText(el, text) { el.text = text }, setElementText(el, text) { el.text = text; el.children = [] }, parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null, patchProp(el, key, _old, value) { el.props[key] = value; if (key === 'value') el.value = value } })
  const root = node('root'), listeners = new Map(), window = { addEventListener: (k, f, capture) => listeners.set(k + (capture ? ':capture' : ''), f), removeEventListener: k => listeners.delete(k), confirm: forbidden('confirm') }
  return { document, renderer, root, listeners, window }
}
function component(globals) { return evaluate(componentCode, { vue: Vue, './b5-model': model, './b5-contract': contract, './b5.css': {} }, globals).default }
function inspection(app, h) {
  const nodes = () => { const out = []; const walk = n => { out.push(n); n.children.forEach(walk) }; walk(h.root); return out }
  const text = () => nodes().filter(n => n.type !== '#comment').map(n => n.text).join(' ')
  const button = label => nodes().find(n => n.type === 'button' && n.text === label)
  const control = label => nodes().find(n => n.props['aria-label'] === label)
  const click = async label => { const n = button(label); assert.ok(n, label); assert.equal(disabled(n), false, label + ' disabled'); await n.props.onClick(); await flush() }
  const set = async (label, value) => { const n = control(label); assert.ok(n, label); assert.equal(disabled(n), false, label); n.props['onUpdate:modelValue'](value); await flush() }
  const submit = async label => { const n = control(label); await n.props.onSubmit({ preventDefault() {}, stopPropagation() {} }); await flush() }
  return { app, ...h, nodes, text, button, control, click, set, submit }
}
const disabled = n => n.props.disabled === true || n.props.disabled === ''
function mount(page, permissions = {}) {
  const h = host(), dirty = [], props = Vue.reactive({ page, canEdit: true, canRelease: true, canOpenStudio: true, ...permissions })
  const C = component({ document: h.document, window: h.window })
  const app = h.renderer.createApp({ render: () => Vue.h(C, { ...props, onDirty: v => dirty.push(v) }) }); app.mount(h.root)
  return { ...inspection(app, h), props, dirty }
}

test('consumer extension is unavailable for every durable action, unknowns are explicitly reviewed', async () => {
  const c = contract.unavailableB5Consumer(), unknown = contract.b5Unknowns.schema
  assert.equal(c.version, core.CONFIG_CONTRACT_VERSION); assert.equal(c.persistence, false)
  for (const scope of ['ai-settings', 'payment-settings', 'trade-settings', 'release']) {
    assert.equal((await c.read(scope)).status, 'unavailable'); assert.equal((await c.saveDraft(scope, unknown)).status, 'unavailable')
  }
  assert.equal((await c.publish(unknown)).status, 'unavailable'); assert.equal((await c.rollback(unknown, unknown)).status, 'unavailable')
  for (const u of Object.values(contract.b5Unknowns)) { assert.equal(u.status, 'needs_human_review'); assert.equal(u.value, undefined) }
  assert.deepEqual(effects, [])
})
test('prototype parameter limits reject noninteger and out-of-range values without changing prior references', () => {
  const ai = model.initialAI(), trade = model.initialTrade()
  for (const timeout of [19, 181, 20.5, NaN]) assert.ok(model.validateAI({ ...ai, timeout }).length)
  for (const timeout of [20, 180]) assert.equal(model.validateAI({ ...ai, timeout }).length, 0)
  for (const size of ['960*1280', '1024*1024', '720*1280']) assert.equal(model.validateAI({ ...ai, size }).length, 0)
  assert.ok(model.validateAI({ ...ai, mode: 'unknown' }).length)
  for (const change of [{ ttl: 0 }, { ttl: 121 }, { ttl: 1.5 }, { refundDays: 0 }, { refundDays: 31 }, { refundDays: 2.5 }, { redeem: 'yes' }, { selfRefund: 'unknown' }]) assert.ok(model.validateTrade({ ...trade, ...change }).length)
  for (const change of [{ ttl: 1, refundDays: 1 }, { ttl: 120, refundDays: 30 }]) assert.equal(model.validateTrade({ ...trade, ...change }).length, 0)
  assert.deepEqual(plain(trade), { ttl: 30, redeem: true, selfRefund: 'self', refundDays: 7 })
  assert.equal(model.validatePayment(model.initialPayment()).length, 0)
  assert.ok(model.validatePayment({ ...model.initialPayment(), merchantLabel: 'arbitrary unapproved value' }).length)
})
test('four callback scenarios are isolated decision values, repeated runs create no orders or shared entitlement state', () => {
  for (const [scenario, count, steps] of [['paid', 1, 1], ['dup', 1, 2], ['amount', 0, 1], ['sign', 0, 1]]) {
    for (let i = 0; i < 3; i++) { const result = model.simulateCallback(scenario); assert.equal(result.illustratedGrants, count); assert.equal(result.steps.length, steps); assert.deepEqual(Object.keys(result), ['steps', 'illustratedGrants']) }
  }
  assert.throws(() => model.simulateCallback('unknown')); assert.deepEqual(effects, [])
})
test('all four mounted pages show UI_CONTRACT and disable durable actions for every capability combination', async () => {
  for (const page of ['ai-settings', 'payment-settings', 'trade-settings', 'release']) for (const canEdit of [true, false]) {
    const p = mount(page, { canEdit, canRelease: canEdit }); await flush()
    assert.match(p.text(), /UI_CONTRACT/)
    const durable = p.nodes().filter(n => n.type === 'button' && /保存.*草稿|确认发布|回滚为新版本|执行退款|读取配置/.test(n.text))
    assert.ok(durable.length >= 1)
    for (const n of durable) { assert.ok(disabled(n), n.text); assert.equal(n.props.onClick, undefined, n.text) }
    p.app.unmount()
  }
  assert.deepEqual(effects, [])
})
test('AI real mode is UNCONFIGURED, no prompt/connection/secret input can be submitted', async () => {
  const p = mount('ai-settings'); await flush()
  for (const label of ['供应商适配器', '模型 ID', '业务网关路径（同源）', '全局生成指令']) assert.ok(disabled(p.control(label)), label)
  await p.set('运行模式', 'gateway'); assert.match(p.text(), /REAL · UNCONFIGURED/)
  assert.equal(p.dirty.at(-1), true); assert.ok(disabled(p.button('检查网关连接 · 未接通')))
  await p.set('最长等待秒数', 19); await p.submit('AI 参数预览'); assert.match(p.text(), /20–180 秒/)
  await p.set('最长等待秒数', 180); await p.submit('AI 参数预览'); assert.match(p.text(), /未验证凭据/)
  await p.click('本机输入差异'); assert.match(p.text(), /不是草稿 \/ 线上差异/)
  assert.doesNotMatch(p.text(), /R\d{3}|已保存|已发布|连接检查通过/)
  assert.equal(p.nodes().filter(n => n.type === 'b' && n.text === 'UNCONFIGURED').length, 4)
  p.app.unmount(); assert.deepEqual(effects, [])
})
test('payment unsaved channel guard retains or discards inputs and every channel keeps its own prototype field family', async () => {
  const p = mount('payment-settings'); await flush(); await p.set('交易环境', 'live')
  const channelButton = key => p.nodes().find(n => n.type === 'button' && n.children.some(c => c.type === 'span' && c.children.some(x => x.text === model.channels[key].title)))
  channelButton('mp').props.onClick(); await flush(); assert.match(p.text(), /当前表单有未保存输入/)
  await p.click('返回继续编辑'); assert.equal(p.control('交易环境').selectedIndex, 1); assert.equal(channelButton('wechat').props['aria-pressed'], true)
  channelButton('mp').props.onClick(); await flush(); await p.click('放弃输入并切换')
  assert.equal(p.control('交易环境').selectedIndex, 0); assert.equal(p.dirty.at(-1), false); assert.ok(p.control('商户证书序列号'))
  for (const key of ['douyin', 'xhs', 'wechat']) {
    channelButton(key).props.onClick(); await flush(); assert.equal(channelButton(key).props['aria-pressed'], true)
    assert.equal(!!p.control('商户证书序列号'), key === 'wechat')
    for (const label of ['应用 AppID', '商户标识', '支付通知地址（HTTPS）', '退款通知地址（HTTPS）']) assert.ok(disabled(p.control(label)))
    assert.equal(p.nodes().filter(n => n.type === 'input' && /ref|密钥|私钥|凭据/i.test(n.props['aria-label'] || '')).length, 0)
    assert.match(p.text(), /未提供获批引用/)
  }
  p.app.unmount(); assert.deepEqual(effects, [])
})
test('actual simulator drawer covers success duplicate amount and signature with no HTTP/storage/order effects', async () => {
  const p = mount('payment-settings'); await flush(); await p.click('打开回调演练')
  for (const [scenario, count] of [['paid', 1], ['dup', 1], ['amount', 0], ['sign', 0]]) {
    await p.set('通知场景', scenario); await p.submit('回调本机演练')
    assert.ok(p.text().includes(`样例权益计数：${count} 次 · 实际发放：未执行`)); assert.match(p.text(), /不创建订单、不发起 HTTP/)
  }
  p.listeners.get('keydown:capture')({ key: 'Escape', stopImmediatePropagation() {} }); await flush()
  assert.equal(p.nodes().some(n => n.props.role === 'dialog'), false)
  p.app.unmount(); assert.deepEqual(effects, [])
})
test('trade rejects invalid local preview, valid preview preserves old/unknown snapshots and refund remains disabled', async () => {
  const p = mount('trade-settings'); await flush(); await p.set('付款时限（分钟）', 121); await p.click('预览交易规则')
  assert.equal(p.nodes().some(n => n.props.role === 'dialog'), false); assert.match(p.text(), /1–120/)
  await p.set('付款时限（分钟）', 20); await p.set('自助售后期限（天）', 9); await p.set('允许体验码兑换', false); await p.click('预览交易规则')
  assert.match(p.text(), /付款时限 20 分钟/); assert.match(p.text(), /旧订单与未知快照均保留/)
  for (const n of p.nodes().filter(n => n.type === 'button' && n.text === '执行退款 · UI_CONTRACT')) assert.ok(disabled(n))
  p.app.unmount(); const fresh = mount('trade-settings'); await flush(); assert.equal(fresh.control('付款时限（分钟）').value, 30); fresh.app.unmount(); assert.deepEqual(effects, [])
})
test('release note and tabs guard, details/diffs/logs are placeholders without version IDs, audit history or success', async () => {
  const p = mount('release'); await flush(); await p.set('发布说明', '本机排版样例')
  await p.click('草稿差异'); assert.match(p.text(), /当前表单有未保存输入/); await p.click('返回继续编辑'); assert.equal(p.control('发布说明').value, '本机排版样例')
  await p.click('草稿差异'); await p.click('放弃输入并切换'); assert.equal(p.control('发布说明').value, ''); assert.match(p.text(), /未知不等于零差异/)
  await p.click('打开差异抽屉'); assert.match(p.text(), /不会生成版本标识/); await p.click('关闭预览')
  await p.click('发布记录'); await p.click('版本详情占位'); assert.match(p.text(), /未知 · 未提供/); await p.click('关闭预览')
  await p.click('查看回滚说明'); assert.ok(disabled(p.button('确认回滚并发布 · UI_CONTRACT'))); assert.match(p.text(), /保留未发布草稿/); await p.click('关闭预览')
  await p.click('操作日志'); await p.click('日志详情占位'); assert.match(p.text(), /没有伪造操作日志/)
  assert.doesNotMatch(p.text(), /R\d{3}|已保存|已发布|发布成功|回滚成功|TEST-/)
  p.app.unmount(); assert.deepEqual(effects, [])
})
test('loading/error states are explicitly local rehearsals, projected draft/live source unavailable, revocation clears memory', async () => {
  const p = mount('ai-settings'); await flush(); await p.click('演练加载状态'); assert.equal(p.control('配置来源状态').props['aria-busy'], true)
  await p.click('演练错误状态'); assert.match(p.text(), /读取失败（本机状态演练）/); await p.click('返回未接通状态')
  await p.click('草稿 / 线上预览'); for (const view of ['draft', 'live']) { await p.set('配置投影视图', view); assert.match(p.text(), /投影未提供/) }
  await p.click('关闭预览'); await p.set('最长等待秒数', 120); p.props.canEdit = false; await flush(); assert.equal(p.control('最长等待秒数').value, 90); assert.equal(p.dirty.at(-1), false)
  assert.equal(p.nodes().some(n => n.type === 'input' && n.props.type === 'file'), false)
  p.app.unmount(); assert.deepEqual(effects, [])
})
test('actual app routes mount B5 and shared dirty guard blocks sidebar, direct hash, logout and refresh loss', async () => {
  const h = host(), navigations = [], confirmations = []; let allow = false, logouts = 0
  h.window.confirm = message => { confirmations.push(message); return allow }
  const location = { hash: '#/ai-settings' }, history = { replaceState: (_a, _b, url) => navigations.push(url), back() {} }
  const session = { user: { id: 'component-only', username: 'component-only', realName: '组件验收', isSuperAdmin: false }, role: 'owner', platformSuperAdmin: false, permissions: [], capabilities: Object.fromEntries(['access', 'orders', 'draft', 'systemRead', 'systemWrite', 'release', 'export', 'moderation'].map(k => [k, true])) }
  const B5 = component({ document: h.document, window: h.window })
  const Stub = { render: () => null }
  const Ops = evaluate(opsCode, { vue: Vue, './ops-api': { session: async () => session, logout: async () => { logouts++ }, login: async () => session }, './config-server.vue': { default: Stub }, './orders.vue': { default: Stub }, './workspace.vue': { default: Stub }, './config.vue': { default: Stub }, './b4.vue': { default: Stub }, './b5.vue': { default: B5 } }, { document: h.document, window: h.window, location, history }).default
  const app = h.renderer.createApp(Ops); app.mount(h.root); const p = inspection(app, h); await flush()
  const nav = label => p.nodes().find(n => n.type === 'button' && n.children.some(c => c.type === '#text' && c.text.includes(label)))
  for (const [label, field] of [['支付参数配置', '交易环境'], ['交易与售后规则', '付款时限（分钟）'], ['发布与日志', '发布说明'], ['AI 参数配置', '运行模式']]) { assert.ok(nav(label), label); nav(label).props.onClick(); await flush(); assert.ok(p.control(field), field) }
  await p.set('最长等待秒数', 120); nav('支付参数配置').props.onClick(); await flush(); assert.ok(p.control('运行模式'))
  location.hash = '#/release'; h.listeners.get('hashchange')(); await flush(); assert.ok(p.control('运行模式')); assert.deepEqual(navigations, ['#/ai-settings'])
  await p.control('退出登录').props.onClick(); await flush(); assert.equal(logouts, 0)
  let prevented = false; const unload = { preventDefault() { prevented = true }, returnValue: undefined }; h.listeners.get('beforeunload')(unload); assert.equal(prevented, true); assert.equal(unload.returnValue, '')
  nav('AI 参数配置').props.onClick(); await flush(); assert.equal(p.control('最长等待秒数').value, 120)
  allow = true; nav('支付参数配置').props.onClick(); await flush(); assert.ok(p.control('交易环境')); assert.ok(confirmations.length >= 4)
  app.unmount(); assert.deepEqual(effects, [])
})
