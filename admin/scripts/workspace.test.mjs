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
const model = evaluate(compile(source('../src/ops-workspace.ts')))
const { descriptor } = parse(source('../src/workspace.vue'))
const componentCode = compile(compileScript(descriptor, { id: 'workspace-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content)

test('Beijing dates and previous equal windows remain correct across UTC midnight, leap days and years', () => {
  assert.equal(model.shanghaiToday(new Date('2026-11-09T16:00:00Z')), '2026-11-10')
  assert.equal(model.shanghaiToday(new Date('2026-11-09T15:59:59Z')), '2026-11-09')
  assert.equal(JSON.stringify(model.presetRange('近 7 天', '2026-01-03')), JSON.stringify({ from: '2025-12-28', to: '2026-01-03' }))
  const w = model.dateWindow('2024-02-28', '2024-03-01', '2026-11-10')
  assert.equal(w.days, 3); assert.equal(w.previousFrom, '2024-02-25'); assert.equal(w.previousTo, '2024-02-27')
  const today = model.dateWindow('2026-01-01', '2026-01-01', '2026-11-10')
  assert.equal(today.days, 1); assert.equal(today.previousFrom, '2025-12-31'); assert.equal(today.previousTo, '2025-12-31')
})
test('invalid, missing, reversed and future dates cannot become a query window', () => {
  for (const [from, to] of [['', '2026-11-10'], ['2026-02-29', '2026-03-01'], ['2026-11-11', '2026-11-10'], ['2026-11-10', '2026-11-11'], ['0000-01-01', '2026-11-10']]) {
    const result = model.dateWindow(from, to, '2026-11-10')
    assert.ok(result.error); assert.equal(result.days, undefined)
  }
})

// Real component, in-memory renderer; no login, service, database or HTTP evidence.
function mountPage(page, canExport = false, canModerate = false) {
  const listeners = new Map(), navigation = []
  const document = { activeElement: null, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) }
  globalThis.document = document
  class Element {}
  const node = (type, text = '') => ({ type, text, props: {}, children: [], parent: null, tagName: type.toUpperCase(), value: '', get options() { return this.children.filter(n => n.type === 'option') }, addEventListener() {}, removeEventListener() {}, focus() { document.activeElement = this } })
  const renderer = Vue.createRenderer({
    createElement: type => node(type), createText: text => node('#text', text), createComment: text => node('#comment', text),
    insert(el, parent, anchor = null) { if (el.parent) this.remove(el); el.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, el) },
    remove(el) { const i = el.parent?.children.indexOf(el) ?? -1; if (i >= 0) el.parent.children.splice(i, 1); el.parent = null },
    setText(el, text) { el.text = text }, setElementText(el, text) { el.text = text; el.children = [] },
    parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
    patchProp(el, key, _old, value) { el.props[key] = value; if (key === 'value') el.value = value },
  })
  const forbidden = () => { throw new Error('Workspace UI must not send a request or create a ledger') }
  const component = evaluate(componentCode, { vue: Vue, './ops-workspace': model, './workspace.css': {} }, { document, HTMLElement: Element, fetch: forbidden, localStorage: new Proxy({}, { get: forbidden }), sessionStorage: new Proxy({}, { get: forbidden }) }).default
  const root = node('root')
  const app = renderer.createApp(component, { page, canExport, canModerate, onNavigate: id => navigation.push(id) })
  app.mount(root)
  const nodes = () => { const all = []; const visit = n => { all.push(n); n.children.forEach(visit) }; visit(root); return all }
  const text = () => nodes().filter(n => n.type !== '#comment').map(n => n.text).join(' ')
  const button = label => nodes().find(n => n.type === 'button' && n.text === label)
  const control = label => nodes().find(n => n.props['aria-label'] === label)
  const set = async (label, value) => { control(label).props['onUpdate:modelValue'](value); await Vue.nextTick() }
  return { app, nodes, text, button, control, set, listeners, navigation }
}
const flush = async () => { await Vue.nextTick(); await Vue.nextTick() }
const disabled = node => node.props.disabled === true || node.props.disabled === ''

test('three pages retain prototype sections with unavailable metrics, and no fake rows or requests', () => {
  for (const [page, labels] of [
    ['overview', ['净实收', '支付订单', '测试完成率', '分享回流新客', '经营趋势', '渠道收入构成', '运营待办', '热门视觉模板']],
    ['growth', ['访问人次（日内去重）', '成图预览人次', '预览后 7 日付费率', '可归因新访客', '测评完成', '传播行为', '渠道表现']],
    ['moderation', ['互换申请', '名片同意率', '联系授权完成率', '待处理举报（全量）', '举报队列', '全部日期 · 匿名工单']],
  ]) {
    const p = mountPage(page)
    for (const label of labels) assert.ok(p.text().includes(label), label)
    assert.equal(p.nodes().filter(n => n.props['aria-label'] === '数据不可得').length, 4)
    assert.match(p.text(), /UI_CONTRACT/)
    assert.doesNotMatch(p.text(), /MOD-108|¥\d|\d+\.\d+%|导出成功|处理成功/)
    p.app.unmount(); assert.equal(p.listeners.size, 0)
  }
})
test('channel filter changes fixed channel rows; custom dates validate and definitions drawer closes with Escape', async () => {
  const p = mountPage('growth', true)
  assert.equal(p.nodes().filter(n => n.type === 'th' && n.props.scope === 'row').length, 4)
  await p.set('统计渠道', 'xhs')
  const rows = p.nodes().filter(n => n.type === 'th' && n.props.scope === 'row')
  assert.equal(rows.length, 1); assert.equal(rows[0].text, '小红书小程序')
  p.button('自定义').props.onClick(); await flush()
  await p.set('开始日期', '2026-03-02'); await p.set('结束日期', '2026-03-01')
  assert.match(p.text(), /开始日期不能晚于结束日期/); assert.equal(p.control('开始日期').props['aria-invalid'], true)
  await p.set('开始日期', '2026-02-28')
  assert.match(p.text(), /2026-02-26 — 2026-02-27/)
  assert.match(p.text(), /待服务接通后查询/)
  await p.button('指标口径').props.onClick(); await flush()
  assert.match(p.text(), /needs_human_review/); assert.match(p.text(), /未成熟样本剔除/)
  p.listeners.get('keydown')({ key: 'Escape', stopPropagation() {} }); await flush()
  assert.equal(p.nodes().some(n => n.props.role === 'dialog'), false)
  p.app.unmount()
})
test('export and moderation remain disabled with any presentation capability; no client write path', async () => {
  for (const capability of [false, true]) {
    for (const [page, label] of [['overview', '导出报表 · 未接通'], ['growth', '导出渠道表 · 未接通']]) {
      const p = mountPage(page, capability, capability)
      assert.ok(disabled(p.button(label))); assert.match(p.button(label).props.title, /缺同筛选/)
      if (!capability) assert.match(p.button(label).props.title, /mbti:ops:export/)
      if (page === 'overview') {
        assert.equal(disabled(p.button('查看治理 →')), !capability)
        if (capability) { p.button('查看治理 →').props.onClick(); assert.deepEqual(p.navigation, ['moderation']) }
      }
      p.app.unmount()
    }
    const p = mountPage('moderation', capability, capability)
    assert.ok(disabled(p.button('查看处理 · 未接通'))); assert.ok(disabled(p.button('查看记录 · 未接通')))
    await p.button('工单字段与处理说明').props.onClick(); await flush()
    assert.ok(disabled(p.nodes().find(n => n.type === 'fieldset')))
    assert.ok(disabled(p.button('记录处理结果 · 未接通')))
    assert.match(p.text(), /当前没有选中的真实工单/)
    assert.match(p.text(), /原子状态迁移、重复处理幂等和服务端审计/)
    p.button('返回治理').props.onClick(); await flush()
    assert.equal(p.nodes().some(n => n.props.role === 'dialog'), false)
    p.app.unmount()
  }
})
