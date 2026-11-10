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
const forbidden = () => { throw Error('B3 cannot fetch, persist, create history or a personal result') }
const isolation = { Error, structuredClone, fetch: forbidden, localStorage: new Proxy({}, { get: forbidden }), sessionStorage: new Proxy({}, { get: forbidden }), indexedDB: new Proxy({}, { get: forbidden }) }
function evaluate(code, modules = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => modules[name] ?? require(name), ...isolation, ...globals })
  return module.exports
}
const fixture = JSON.parse(source('../src/config-fixture.json'))
const model = evaluate(compile(source('../src/config-model.ts')), { './config-fixture.json': { default: fixture } })
const contract = evaluate(compile(source('../src/config-contract-v1.ts')))
const componentCode = file => { const { descriptor } = parse(source(file)); return compile(compileScript(descriptor, { id: file, inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content) }
const previewCode = componentCode('../src/config-preview.vue'), pageCode = componentCode('../src/config.vue')
const json = value => JSON.parse(JSON.stringify(value))
const flush = async () => { await Vue.nextTick(); await Vue.nextTick() }
const valuesFor = (c, kind, key) => Object.fromEntries(model.fieldsFor(c, kind, key).map(f => [f.key, f.value]))
const edit = (c, kind, key, values) => model.applyEdit(c, kind, key, { ...valuesFor(c, kind, key), ...values })

test('fixture is the frozen 12-question candidate, never the old bank; only B3 prototype configuration', () => {
  const frozen = JSON.parse(source('../../docs/integration/fastlane/fixtures/quiz-candidate.json'))
  assert.deepEqual(fixture.quiz, frozen.payload)
  assert.deepEqual(Object.keys(fixture), ['content', 'channels', 'shop', 'styles', 'personas', 'quiz'])
  assert.equal(Object.keys(fixture.personas).length, 16)
  assert.equal(model.questionVersion(model.referenceConfiguration().quiz.questions), 'qb-v0.4-prototype-1')
  assert.deepEqual(fixture.shop.map(p => p.cents), [990, 1990])
})
test('money uses integer fen, exact range, and both tier relationship and last saleable package are enforced locally', () => {
  for (const [value, expected] of [['0.01', 1], ['9.90', 990], ['9999.99', 999999]]) assert.equal(model.priceInFen(value), expected)
  for (const v of ['0', '-1', '10000', '1.001', 'NaN', 'Infinity', '1e2', '']) assert.throws(() => model.priceInFen(v))
  let c = model.referenceConfiguration()
  assert.throws(() => edit(c, 'sku', 'portrait', { price: '9.89' }), /不能低于/)
  c = edit(c, 'sku', 'basic', { on: false })
  assert.throws(() => edit(c, 'sku', 'portrait', { on: false }), /至少保留一个上架/)
  assert.equal(c.shop[1].on, true)
  assert.throws(() => edit(c, 'sku', 'basic', { title: 'x'.repeat(25) }), /最多 24/)
  assert.equal(fixture.shop[0].on, true)
})
test('last enabled style, allowed material and order movement follow prototype without duplicated ordering', () => {
  let c = model.referenceConfiguration()
  c = edit(c, 'style', 'illustration', { order: '3', art: 'editorial', title: '新风格' })
  assert.deepEqual(json(c.styles).sort((a,b) => a.order-b.order).map(p => p.id), ['editorial', 'game', 'illustration'])
  assert.equal(c.styles.find(s => s.id === 'illustration').art, 'editorial')
  assert.throws(() => edit(c, 'style', 'illustration', { art: 'https://example.com/image' }), /非法/)
  assert.throws(() => edit(c, 'style', 'illustration', { order: '0' }), /非法/)
  c = edit(c, 'style', 'illustration', { on: false }); c = edit(c, 'style', 'game', { on: false })
  assert.throws(() => edit(c, 'style', 'editorial', { on: false }), /至少保留一个启用/)
})
test('pure text, empty text, max lengths, fixed channel choices and isolated channel editing are validated', () => {
  const c = model.referenceConfiguration(), changed = edit(c, 'channel', 'xhs', { landing: 'pricing', badge: '新栏目语' })
  assert.equal(changed.channels.xhs.landing, 'pricing'); assert.deepEqual(json(changed.channels.wechat), json(c.channels.wechat))
  assert.throws(() => edit(c, 'channel', 'wechat', { landing: 'https://example.com' }), /非法/)
  for (const text of ['', '  ', '<script>', 'a&b', 'a"b', "a'b"]) assert.throws(() => edit(c, 'hero', '', { headline: text }), /纯文本/)
  assert.throws(() => edit(c, 'scenes', '', { caption: 'x'.repeat(101) }), /最多 100/)
  assert.equal(edit(c, 'scenes', '', { caption: '我的 {type}' }).content.caption, '我的 {type}')
})
test('12 valid unique answers and exact four dimension counts reproduce golden and reverse cases without side effects', () => {
  const frozen = JSON.parse(source('../../docs/integration/fastlane/fixtures/quiz-candidate.json')), c = model.referenceConfiguration()
  for (const golden of frozen.golden_cases) {
    const result = model.simulate(c.quiz.questions, golden.answers)
    assert.equal(result.type, golden.expected_type_code); assert.deepEqual(json(result.counts), golden.expected_dimension_counts)
  }
  const answers = frozen.golden_cases[0].answers
  const rev = edit(edit(c, 'question', 'q1', { reverse: '1' }), 'question', 'q5', { reverse: '1' })
  assert.equal(model.simulate(rev.quiz.questions, answers).type, 'ISTJ')
  assert.deepEqual(json(model.simulate(rev.quiz.questions, answers).counts), { E:1, I:2, S:3, N:0, T:3, F:0, J:3, P:0 })
  assert.match(rev.quiz.question_bank_version, /^preview-only-/)
  assert.equal(c.quiz.question_bank_version, 'qb-v0.4-prototype-1')
  for (const bad of [answers.slice(1), [...answers.slice(0,11), answers[0]], [...answers.slice(0,11), { question_id:'q12', option_id:'x' }], [...answers.slice(0,11), { question_id:'unknown', option_id:'p' }]]) assert.throws(() => model.simulate(c.quiz.questions, bad))
  assert.throws(() => edit(c, 'question', 'q1', { a:'相同', b:'相同' }), /须不同/)
  assert.throws(() => edit(c, 'question', 'q1', { reverse:'2' }), /非法/)
  const duplicate = structuredClone(c.quiz.questions); duplicate[1].id = duplicate[0].id
  assert.throws(() => model.validateQuestions(duplicate), /题目编号不能重复/)
  const wrong = structuredClone(c.quiz.questions); wrong[0].options[0].id='n'
  assert.throws(() => model.validateQuestions(wrong), /非法选项/)
  const repeatedOption = structuredClone(c.quiz.questions); repeatedOption[0].options[1].id='e'
  assert.throws(() => model.validateQuestions(repeatedOption), /不重复编号/)
  assert.equal(Object.hasOwn(model.simulate(c.quiz.questions, answers), 'id'), false)
})
test('versioned consumer cannot claim durable read, save or publish; no inferred endpoint or runtime H5 imports', async () => {
  const consumer = contract.unavailableConsumer()
  assert.equal(consumer.version, 'mbti-config-consumer/v1'); assert.equal(consumer.persistence, false)
  for (const result of await Promise.all([consumer.read('content','draft'), consumer.read('catalog','published'), consumer.saveDraft('assessment', fixture, null), consumer.publish(null)])) {
    assert.equal(result.status, 'unavailable'); assert.match(result.reason, /C2/); assert.equal(result.value, undefined)
  }
  for (const file of ['config-model.ts', 'config.vue', 'config-preview.vue', 'config-contract-v1.ts']) {
    const s = source(`../src/${file}`)
    assert.doesNotMatch(s, /\bfetch\s*\(|localStorage|sessionStorage|indexedDB|createOrder|ResultSnapshot\s*\{/)
    assert.doesNotMatch(compile(s), /require\(["']\.\.\/\.\.\/web/)
  }
  const ops = source('../src/ops.vue')
  assert.match(ops, /<ConfigPage v-if="configScope && visiblePage"/)
  assert.match(ops, /\['content', 'catalog', 'assessment'\]/)
  assert.match(ops, /configPage\?\.openPreview/)
})

// Mount the actual Vue components in an isolated renderer, never an authenticated app.
function mountPage(page) {
  const listeners = new Map(), dirtyEvents = []
  class Element {}
  const document = { activeElement:null }
  const window = { addEventListener:(k,f) => listeners.set(k,f), removeEventListener:k=>listeners.delete(k), confirm:()=>true }
  globalThis.document = document
  const node = (type,text='') => ({ type,text,props:{},children:[],parent:null,tagName:type.toUpperCase(),value:'',get options(){return this.children.filter(n=>n.type==='option')},addEventListener(){},removeEventListener(){},focus(){document.activeElement=this},querySelectorAll(){return []} })
  const renderer = Vue.createRenderer({
    createElement:type=>node(type),createText:text=>node('#text',text),createComment:text=>node('#comment',text),
    insert(el,parent,anchor=null){if(el.parent)this.remove(el);el.parent=parent;const i=parent.children.indexOf(anchor);parent.children.splice(i<0?parent.children.length:i,0,el)},
    remove(el){const i=el.parent?.children.indexOf(el)??-1;if(i>=0)el.parent.children.splice(i,1);el.parent=null},
    setText(el,text){el.text=text},setElementText(el,text){el.text=text;el.children=[]},parentNode:el=>el.parent,nextSibling:el=>el.parent?.children[el.parent.children.indexOf(el)+1]??null,
    patchProp(el,key,_old,value){el.props[key]=value;if(key==='value')el.value=value},
  })
  const modules = { vue:Vue,'./config-model':model,'./config-contract-v1':contract,'./config.css':{},...Object.fromEntries(['editorial','illustration','game'].map(k=>[`./config-assets/${k}.webp`,{default:k}])) }
  const globals = { window,document,HTMLElement:Element }
  const preview = evaluate(previewCode,modules,globals)
  const component = evaluate(pageCode,{...modules,'./config-preview.vue':preview},globals).default
  const root=node('root'), app=renderer.createApp(component,{page,onDirty:v=>dirtyEvents.push(v)})
  app.mount(root)
  const nodes=()=>{const a=[];const visit=n=>{a.push(n);n.children.forEach(visit)};visit(root);return a}
  const text=()=>nodes().filter(n=>n.type!=='#comment').map(n=>n.text).join(' ')
  const button=label=>nodes().find(n=>n.type==='button' && n.text===label)
  const control=label=>nodes().find(n=>n.props['aria-label']===label)
  const set=async(label,value)=>{const n=control(label);if(n.props['onUpdate:modelValue'])n.props['onUpdate:modelValue'](value);else n.props.onInput({target:{value}});await flush()}
  const click=async label=>{assert.ok(button(label),label);button(label).props.onClick();await flush()}
  return {app,nodes,text,button,control,set,click,listeners,dirtyEvents}
}
const subtreeText = n => [n.text, ...n.children.map(subtreeText)].join(' ')
const disabled = n => n.props.disabled === true || n.props.disabled === ''
test('all three routes have the complete scopes and disabled Save/Publish, including drawers', async () => {
  for (const [page,labels] of [['content',['首页首屏','消费场景','平台入口']],['catalog',['商品套装','海报与头像模板','990 分']],['assessment',['题库与计分','人格与相处说明书','12 题','qb-v0.4-prototype-1']]]) {
    const p=mountPage(page);await flush()
    for(const label of labels)assert.ok(p.text().includes(label),label)
    assert.match(p.text(),/UI_CONTRACT/);assert.match(p.text(),/持久化不可用/)
    assert.ok(disabled(p.button('保存草稿 · C2 未接通')));assert.ok(disabled(p.button('发布 · C2 未接通')))
    p.app.unmount();assert.equal(p.listeners.size,0)
  }
})
test('content edit applies only to memory, discard guard is visible and published preview stays unavailable', async () => {
  const p=mountPage('content');await flush();await p.click('编辑首屏')
  assert.ok(disabled(p.button('保存草稿 · C2 未接通')))
  await p.set('主标题','内存标题');assert.equal(p.dirtyEvents.at(-1),true)
  await p.click('返回');assert.match(p.text(),/放弃尚未应用的输入/)
  await p.click('继续编辑')
  p.nodes().find(n=>n.type==='form'&&n.props.id==='b3-edit').props.onSubmit({preventDefault(){},stopPropagation(){}});await flush()
  assert.match(p.text(),/内存标题/);assert.match(p.text(),/未保存、未发布/)
  await p.click('查看手机效果');assert.match(p.text(),/内存草稿效果/)
  await p.set('预览配置版本','reference');assert.doesNotMatch(subtreeText(p.nodes().find(n => n.props['aria-label'] === '手机前台布局预览')), /内存标题/)
  await p.set('预览配置版本','published');assert.match(p.text(),/线上配置不可得/)
  assert.equal(p.nodes().some(n=>n.props['aria-label']==='手机前台布局预览'),false)
  p.app.unmount()
  const fresh = mountPage('content'); await flush(); assert.doesNotMatch(fresh.text(), /内存标题/); fresh.app.unmount()
})
test('all four channels edit independently and simulation opens selected landing and channel', async () => {
  const p=mountPage('content');await flush();await p.click('平台入口')
  assert.equal(p.nodes().filter(n=>n.type==='button'&&n.text==='编辑渠道').length,4)
  p.nodes().filter(n=>n.type==='button'&&n.text==='模拟进入')[1].props.onClick();await flush()
  assert.equal(p.control('预览渠道').selectedIndex,1);assert.equal(p.control('预览页面').selectedIndex,0)
  p.app.unmount()
})
test('catalog style material, enabled flag, ordering drawer and isolated purchase preview are present', async () => {
  const p=mountPage('catalog');await flush();await p.click('海报与头像模板')
  assert.equal(p.nodes().filter(n=>n.type==='img').length,3)
  p.nodes().filter(n=>n.type==='button'&&n.text==='编辑模板')[0].props.onClick();await flush()
  for(const label of ['风格名称','视觉素材','展示顺序','允许用户选择此风格'])assert.ok(p.control(label))
  assert.ok(disabled(p.button('保存草稿 · C2 未接通')))
  await p.click('返回');await p.click('商品套装')
  p.nodes().filter(n=>n.type==='button'&&n.text==='预览购买页')[1].props.onClick();await flush()
  assert.ok(disabled(p.button('购买 · 预览中不可下单')))
  p.app.unmount()
})
test('assessment filters each dimension, simulates all 12 choices, filters all personality groups and previews manual', async () => {
  const p=mountPage('assessment');await flush()
  for(const d of ['EI','SN','TF','JP']){await p.set('筛选维度',d);assert.equal(p.nodes().filter(n=>n.type==='th'&&n.props.scope==='row').length,3)}
  await p.click('试算结果')
  assert.equal(p.nodes().filter(n=>n.type==='fieldset').length,12)
  p.nodes().find(n=>n.type==='form'&&n.props.id==='b3-score').props.onSubmit({preventDefault(){},stopPropagation(){}});await flush()
  assert.match(p.text(),/试算结果：INFP/)
  p.listeners.get('keydown')({key:'Escape',stopImmediatePropagation(){}});await flush()
  await p.click('人格与相处说明书')
  for(const g of ['NT','NF','SJ','SP']){await p.set('人格分组',g);assert.match(p.text(),/4 \/ 16 类型/)}
  await p.set('人格分组','全部');await p.set('搜索人格','INFP');assert.match(p.text(),/1 \/ 16 类型/)
  p.control('INFP 手机预览').props.onClick();await flush()
  for(const label of ['如何给我充电','怎样和我沟通','我在意的相处细节'])assert.ok(p.text().includes(label))
  p.app.unmount()
})

test('invalid option edit leaves the existing bank intact and shows a local rejection in the actual drawer', async () => {
  const p=mountPage('assessment');await flush()
  p.control('编辑第 1 道题').props.onClick();await flush()
  await p.set('选项 A', '重复选项');await p.set('选项 B', '重复选项')
  p.nodes().find(n=>n.type==='form'&&n.props.id==='b3-edit').props.onSubmit({preventDefault(){},stopPropagation(){}});await flush()
  assert.match(p.text(),/两个选项须不同/);assert.equal(p.nodes().some(n=>n.props.role==='dialog'),true)
  assert.match(p.text(),/qb-v0.4-prototype-1/);assert.doesNotMatch(p.text(),/preview-only-[a-z0-9]+/)
  assert.ok(disabled(p.button('发布 · C2 未接通')))
  p.app.unmount()
})

test('prototype field limits and fixed landing choices stay exact across all seven edit drawers', () => {
  const c=model.referenceConfiguration()
  for (const [kind,key,expected] of [
    ['hero','',[26,28,80,20]], ['scenes','',[100,100,100,100]], ['channel','wechat',[undefined,26]],
    ['sku','basic',[24,undefined,100,undefined]], ['style','editorial',[16,undefined,undefined,undefined]],
    ['question','q1',[100,70,70,undefined]], ['persona','INFP',[18,48,90,90,90]],
  ]) assert.deepEqual(Array.from(model.fieldsFor(c,kind,key),f=>f.max),expected)
  assert.deepEqual(Array.from(model.fieldsFor(c,'channel','wechat')[0].options,o=>o.value),['home','pricing','test-intro','discover','history'])
  assert.equal(model.fieldsFor(c,'sku','basic').length,4)
})
