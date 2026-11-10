import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function evaluate(code, modules, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => { if (!(name in modules)) throw Error('Unexpected module: '+name); return modules[name] }, ...globals })
  return module.exports
}
class OpsApiError extends Error { constructor(status, message) { super(message); this.status = status } }
const calls = []
const projection = (view, system = true) => ({ schema: 'mbti-config-candidate/v1', status: 'needs_human_review', unknowns: ['approval pending'], view, state: 'published', expectedVersion: 1, expectedDraftVersion: view === 'draft' ? 2 : 0, source: { projectId: 'fixture-project', environment: 'test', pluginCode: 'mbti-config' }, authorization: { canSaveDraft: true, canPublish: system, canReadSystem: system }, categories: { content: { headline: view === 'draft' ? '草稿' : '旧发布' } }, diff: view === 'draft' ? ['content'] : [] })
const adapter = evaluate(compile(source('../src/config-api.ts')), { './ops-api': { request: async (...args) => { calls.push(args); return projection('draft') } } })
const plain = value => JSON.parse(JSON.stringify(value))
const component = compile(compileScript(parse(source('../src/config-server.vue')).descriptor, { id: 'c2-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content)
const flush = async () => { for (let i = 0; i < 12; i++) await Vue.nextTick() }
function mount(api, page = 'content') {
  class Element {}
  const document = { activeElement: null }; globalThis.document = document
  const window = { confirm: () => true }
  const node = (type, text = '') => ({ type, text, children: [], props: {}, parent: null, value: '', tagName: type.toUpperCase(), addEventListener() {}, removeEventListener() {}, focus() {}, querySelectorAll() { return [] } })
  const renderer = Vue.createRenderer({ createElement: type => node(type), createText: text => node('#text', text), createComment: text => node('#comment', text), insert(el, parent, anchor) { if (el.parent) this.remove(el); el.parent = parent; const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, el) }, remove(el) { const i = el.parent?.children.indexOf(el) ?? -1; if (i >= 0) el.parent.children.splice(i, 1); el.parent = null }, setText(el, text) { el.text = text }, setElementText(el, text) { el.text = text; el.children = [] }, parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null, patchProp(el, key, old, value) { el.props[key] = value; if (key === 'value') el.value = value } })
  const C = evaluate(component, { vue: Vue, './config-api': { ...adapter, configApi: api }, './ops-api': { OpsApiError } }, { document, window, HTMLElement: Element }).default
  const root = node('root'), dirty = [], app = renderer.createApp(C, { page, api, onDirty: value => dirty.push(value) }); app.mount(root)
  const nodes = () => { const all = []; const walk = n => { all.push(n); n.children.forEach(walk) }; walk(root); return all }
  const button = label => nodes().find(n => n.type === 'button' && n.text === label)
  const text = () => nodes().filter(n => n.type !== '#comment').map(n => n.text).join(' ')
  const click = async label => { const n = button(label); assert.ok(n, label); assert.ok(!n.props.disabled, label); await n.props.onClick(); await flush() }
  const edit = async value => { const n = nodes().find(n => n.props['aria-label'] === '服务端类别草稿'); n.props['onUpdate:modelValue'](value); await flush() }
  return { app, nodes, text, button, click, edit, dirty }
}
function fixture(system = true) {
  const log = [], draft = projection('draft', system), published = projection('published', system)
  const api = { read: async view => { log.push(['read', view]); return structuredClone(view === 'draft' ? draft : published) },
    save: async (category, value, revision) => { log.push(['save', category, value, revision]); draft.categories[category] = value; draft.expectedDraftVersion++; return structuredClone(draft) },
    publish: async (...args) => { log.push(['publish', ...args]); published.expectedVersion++; draft.expectedVersion++; published.categories = structuredClone(draft.categories); draft.diff = []; return { version: published.expectedVersion, auditLogId: 'fixture-audit' } },
    rollback: async (...args) => { log.push(['rollback', ...args]); published.expectedVersion++; draft.expectedVersion++; published.categories.content = { headline: '旧发布' }; return { version: published.expectedVersion, auditLogId: 'fixture-rollback' } },
    versions: async () => [{ version: 1, event: 'mbti.published', auditLogId: 'fixture-audit', createdAt: '2026-01-01', categories: ['content'] }], audit: async () => [{ id: 'fixture-event', version: 2, event: 'mbti.draft.saved', auditLogId: 'fixture-audit', createdAt: '2026-01-01', categories: ['content'] }], version: async version => ({ version, categories: { content: { headline: '旧发布' } } }) }
  return { api, log, draft, published }
}
test('candidate HTTP adapter sends exact C1 paths, integer CAS bodies and no scope/role override', async () => {
  calls.length = 0
  await adapter.configApi.read('draft'); await adapter.configApi.save('content', { headline: '候选' }, 2)
  await adapter.configApi.publish(1, 3); await adapter.configApi.rollback(1, 2); await adapter.configApi.versions(); await adapter.configApi.audit(); await adapter.configApi.version(1)
  assert.deepEqual(calls.map(c => c[0]), ['/plugins/mbti-config/draft', '/plugins/mbti-config/draft/content', '/plugins/mbti-config/publish', '/plugins/mbti-config/versions/1/rollback', '/plugins/mbti-config/versions', '/plugins/mbti-config/audit', '/plugins/mbti-config/versions/1'])
  assert.deepEqual(JSON.parse(calls[1][1].body), { value: { headline: '候选' }, expectedDraftVersion: 2 })
  assert.deepEqual(JSON.parse(calls[2][1].body), { expectedVersion: 1, expectedDraftVersion: 3 })
  assert.throws(() => adapter.configApi.publish('1', 3)); assert.throws(() => adapter.configApi.rollback(0, 2))
  assert.throws(() => adapter.validateProjection({ ...projection('draft'), authorization: undefined }))
})
test('mounted server consumer distinguishes published and draft, saves one category and uses actual revision/diff', async () => {
  const f = fixture(), p = mount(f.api); await flush()
  assert.match(p.text(), /旧发布/); assert.match(p.text(), /服务端差异：content/)
  await p.edit('{bad'); await p.click('保存此类别草稿'); assert.match(p.text(), /JSON 格式无效/); assert.equal(f.log.some(c => c[0] === 'save'), false)
  await p.edit(JSON.stringify({ headline: '新草稿' })); await p.click('保存此类别草稿')
  assert.deepEqual(plain(f.log.find(c => c[0] === 'save')), ['save', 'content', { headline: '新草稿' }, 2])
  assert.equal(f.published.categories.content.headline, '旧发布'); assert.match(p.text(), /尚未发布/); assert.equal(p.dirty.at(-1), false)
  await p.click('发布已核对草稿'); assert.deepEqual(f.log.find(c => c[0] === 'publish'), ['publish', 1, 3]); assert.match(p.text(), /已发布版本 2/)
  await p.click('发布版本与回滚'); await p.click('查看版本 1'); assert.match(p.text(), /旧发布/)
  await p.click('回滚版本 1 为新版本'); assert.deepEqual(f.log.find(c => c[0] === 'rollback'), ['rollback', 1, 2]); assert.equal(f.draft.categories.content.headline, '新草稿'); assert.equal(f.published.categories.content.headline, '旧发布')
  await p.click('操作日志'); assert.match(p.text(), /mbti.draft.saved/); p.app.unmount()
})
test('B1 capabilities cannot grant publication: only server authorization controls release/history', async () => {
  const f = fixture(false), p = mount(f.api); await flush()
  for (const name of ['发布已核对草稿', '发布版本与回滚', '操作日志']) assert.equal(p.button(name), undefined)
  await p.edit('{"headline":"运营草稿"}'); await p.click('保存此类别草稿'); assert.ok(f.log.some(row => row[0] === 'save')); p.app.unmount()
})
test('401/403/404/409/503 and failed save clear stale projection/authority without simulated success or auto overwrite', async () => {
  for (const status of [400, 401, 403, 404, 409, 503]) {
    const f = fixture(), p = mount(f.api); await flush(); f.api.save = async () => { throw new OpsApiError(status, 'fixture refusal') }
    await p.edit('{"headline":"拒绝"}'); await p.click('保存此类别草稿'); assert.match(p.text(), new RegExp(`HTTP ${status}`)); assert.equal(p.button('发布已核对草稿'), undefined); assert.equal(p.button('保存此类别草稿'), undefined); assert.doesNotMatch(p.text(), /草稿已保存/); p.app.unmount()
  }
})
test('version changing during read fails closed and unmounted/in-flight reads cannot restore stale state', async () => {
  const f = fixture(); f.published.expectedVersion = 9; const p = mount(f.api); await flush(); assert.match(p.text(), /HTTP 409/); assert.equal(p.button('保存此类别草稿'), undefined); p.app.unmount()
  let release; const pending = new Promise(resolve => { release = resolve }); const q = mount({ ...fixture().api, read: () => pending }); q.app.unmount(); release(projection('draft')); await flush(); assert.equal(q.dirty.at(-1), false)
})
