import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import * as Vue from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { makeGateway } from '../vendor/mbti-image-kit/core.mjs'

const require = createRequire(import.meta.url), source = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const compile = s => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const effects = []
const forbidden = name => () => { effects.push(name); throw Error('Forbidden B4 side effect: ' + name) }
const trap = name => new Proxy({}, { get: forbidden(name), set: forbidden(name) })
const isolation = { fetch: forbidden('fetch'), XMLHttpRequest: forbidden('xhr'), WebSocket: forbidden('socket'), localStorage: trap('localStorage'), sessionStorage: trap('sessionStorage'), indexedDB: trap('indexedDB'), history: trap('history'), navigator: trap('navigator'), postMessage: forbidden('message'), console: trap('log') }
function evaluate(code, modules = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => modules[name] ?? require(name), Error, Date, Uint8ClampedArray, Uint8Array, Request, Response, Headers, Blob, structuredClone, performance, ...isolation, ...globals })
  return module.exports
}
const model = evaluate(compile(source('../src/b4-model.ts')))
const image = evaluate(compile(source('../src/b4-image.ts')), { '../vendor/mbti-image-kit/core.mjs': { makeGateway } })
const contract = evaluate(compile(source('../src/config-contract-v1.ts')))
const plain = value => JSON.parse(JSON.stringify(value))
const flush = async () => { for (let i = 0; i < 5; i++) await Vue.nextTick() }
// Synthetic PNG-signature inputs exercise the kit validator; canvas decoding is
// separately checked in the isolated browser. No real person/file enters tests.
const data = n => 'data:image/png;base64,' + Buffer.from([137,80,78,71,13,10,26,10,...Array(48).fill(n)]).toString('base64')
const pair = overrides => ({ portrait: data(20), style: data(80), consent: true, recipe: 'balanced', mode: 'offline', ...overrides })

test('vendored image-kit core matches the supplied zip hash without requiring the untracked input package', () => {
  const original = readFileSync(new URL('../vendor/mbti-image-kit/core.mjs', import.meta.url))
  assert.equal(createHash('sha256').update(original).digest('hex'), '8b4e8d8f64ba5710a4d0121c29d13d6c5dc07187c10f2df747247f5052e50a82')
})
test('all absent-image/consent combinations and real mode stop before rendering, gateway or network', async () => {
  let renders = 0
  for (const portrait of ['', data(20)]) for (const style of ['', data(80)]) for (const consent of [false, true]) {
    if (portrait && style && consent) continue
    await assert.rejects(image.runOfflineSample(pair({ portrait, style, consent }), { render: async () => { renders++; throw Error('should not render') } }))
  }
  await assert.rejects(image.runOfflineSample(pair({ mode: 'real' })), /UI_CONTRACT/)
  await assert.rejects(image.localFile({ type: 'image/png', size: 500 }, false), /LOCAL_CONSENT/)
  assert.equal(renders, 0); assert.deepEqual(effects, [])
})
test('actual offline API uses kit ordered inputs; replacing second image changes pixels and output deterministically', async () => {
  const portrait = new Uint8ClampedArray([20,30,40,255,50,60,70,255]), a = new Uint8ClampedArray([100,50,20,255,120,60,30,255]), b = new Uint8ClampedArray([20,50,100,255,30,60,120,255])
  const render = async (p, s, recipe) => {
    assert.equal(p, data(20)); assert.ok([data(80), data(90)].includes(s))
    return new Uint8Array([137,80,78,71,...image.mixPixels(portrait, s === data(80) ? a : b, recipe)])
  }
  const first = await image.runOfflineSample(pair(), { render }), repeat = await image.runOfflineSample(pair(), { render }), second = await image.runOfflineSample(pair({ style: data(90) }), { render })
  assert.equal(first, repeat); assert.notEqual(first, second)
  assert.notDeepEqual(plain(image.mixPixels(portrait,a,'balanced')), plain(image.mixPixels(portrait,b,'balanced')))
  assert.match(first, /^data:image\/png;base64,/); assert.deepEqual(effects, [])
})
test('offline failure and retry stay local; the log is an explicit sanitized allowlist', async () => {
  await assert.rejects(image.runOfflineSample(pair(), { fail: true }), /LOCAL_FAILURE/)
  const out = await image.runOfflineSample(pair(), { render: async () => new Uint8Array([137,80,78,71,0]) })
  assert.match(out, /^data:image\/png/)
  for (const status of ['success','failed']) {
    const row = image.sanitizedRecord(status, 'balanced', 12.8)
    assert.deepEqual(Object.keys(row), ['source','mode','status','recipe','at','durationMs','errorCategory'])
    assert.doesNotMatch(JSON.stringify(row), /data:image|base64|portrait|prompt|key|authorization|file/i)
    assert.equal(row.durationMs, 13)
  }
  assert.deepEqual(effects, [])
})
test('kit health and dual-image contract status checks are in-memory response classifications, not live HTTP', async () => {
  let calls = 0
  const gateway = makeGateway({ upstream: async () => { calls++; throw Error('unexpected') } })
  const health = await gateway(new Request('https://offline.invalid/api/mbti-image/health'), {}, 'loopback')
  assert.equal(health.status, 200); assert.equal((await health.json()).ready, false)
  const request = body => new Request('https://offline.invalid/api/mbti-image/generate', { method:'POST', headers:{Origin:'https://offline.invalid','Content-Type':'application/json'}, body:JSON.stringify(body) })
  const body = { contract:'mbti-image/v1', requestId:'offline_test_0001', model:'wan2.6-image',adapter:'wan',size:'960*1280',n:1,prompt:'fixed nonpersonal fixture',consent:true,images:[{role:'portrait',data:data(20)},{role:'style',data:data(80)}] }
  assert.equal((await gateway(request(body), {}, 'loopback')).status,503)
  const env = { DASHSCOPE_API_KEY:'OFFLINE_MODE_MARKER_NOT_A_CREDENTIAL' }
  assert.equal((await gateway(request({...body,consent:false}),env,'loopback')).status,403)
  assert.equal((await gateway(request({...body,images:[...body.images].reverse()}),env,'loopback')).status,422)
  assert.equal((await gateway(request({...body,images:body.images.slice(0,1)}),env,'loopback')).status,422)
  assert.equal(calls,0); assert.deepEqual(effects,[])
})
test('prototype lifecycle limits reject duplicates/ranges; no mutation of prior snapshots', () => {
  const original = model.initialLifecycle()
  assert.deepEqual(plain(model.lifecycleInput('新阶段\n回归生活','90，30')), {tags:['新阶段','回归生活'],days:[30,90]})
  for(const tags of ['', '相同\n相同', '长'.repeat(13), '<script>',Array.from({length:11},(_,i)=>'阶段'+i).join('\n')]) assert.throws(()=>model.lifecycleInput(tags,'30'))
  for(const days of ['', '0','366','1.5','30，30','1,2,3,4','NaN']) assert.throws(()=>model.lifecycleInput('阶段',days))
  assert.deepEqual(plain(original.days),[30,90]); assert.equal(original.tags[0],'日常生活'); assert.deepEqual(effects,[])
})
test('mature cohort excludes <45 days; day52 is only a complete comparison observation window', () => {
  for(const age of [0,28,44,44.99,NaN]) assert.equal(model.cohortWindow(age).retestDenominatorEligible,false)
  assert.deepEqual(plain(model.cohortWindow(45)),{retestDenominatorEligible:true,comparisonObservationComplete:false})
  assert.equal(model.cohortWindow(51).comparisonObservationComplete,false); assert.equal(model.cohortWindow(52).comparisonObservationComplete,true)
  assert.match(model.cohortSemantics.join(' '), /不是第 52 天推送计划/)
})
test('social validation and privacy output never reveal below-threshold counts; H5 unavailable remains distinct', () => {
  const base = model.initialSocial()
  for(const change of [{daily:0},{daily:31},{daily:1.5},{order:'unknown'},{radius:200},{minimum:9},{minimum:201},{minimum:10.5},{radar:'yes'}]) assert.throws(()=>model.socialInput({...base,...change}))
  for (const minimum of [10,11,99,200]) {
    for(const count of [0,minimum-1]) assert.deepEqual(plain(model.radarProjection(true,minimum,count)),{status:'hidden',count:null,label:'人数较少'})
    const out=model.radarProjection(true,minimum,minimum)
    assert.equal(out.count,Math.floor(minimum/10)*10); assert.match(out.label,/^\d+\+$/)
  }
  assert.equal(model.radarProjection(false,10,100).count,null)
  assert.equal(model.radarProjection(true,10,null).status,'unavailable')
  // The supplied mobile prototype's rule is count < k ? '人数较少' : floor(count/10)*10+'+'.
  for (const count of [9,10,18,20,43,96]) assert.equal(model.radarProjection(true,10,count).label,count<10?'人数较少':Math.floor(count/10)*10+'+')
})

const {descriptor}=parse(source('../src/b4.vue'))
const componentCode=compile(compileScript(descriptor,{id:'b4',inlineTemplate:true,templateOptions:{compilerOptions:{hoistStatic:false}}}).content)
function mountPage(page, canEdit = true, imageOverrides = {}) {
  const document={activeElement:null}, dirty=[]
  globalThis.document = document
  const node=(type,text='')=>({type,text,children:[],props:{},parent:null,tagName:type.toUpperCase(),value:'',get options(){return this.children.filter(n=>n.type==='option')},addEventListener(){},removeEventListener(){},focus(){document.activeElement=this}})
  const renderer=Vue.createRenderer({createElement:type=>node(type),createText:text=>node('#text',text),createComment:text=>node('#comment',text),insert(el,parent,anchor=null){if(el.parent)this.remove(el);el.parent=parent;const i=parent.children.indexOf(anchor);parent.children.splice(i<0?parent.children.length:i,0,el)},remove(el){const i=el.parent?.children.indexOf(el)??-1;if(i>=0)el.parent.children.splice(i,1);el.parent=null},setText(el,t){el.text=t},setElementText(el,t){el.text=t;el.children=[]},parentNode:el=>el.parent,nextSibling:el=>el.parent?.children[el.parent.children.indexOf(el)+1]??null,patchProp(el,k,_old,v){el.props[k]=v;if(k==='value')el.value=v}})
  const component=evaluate(componentCode,{vue:Vue,'./b4-model':model,'./b4-image':{...image,...imageOverrides},'./config-contract-v1':contract,'./config.css':{},'./b4.css':{}},{document,window:trap('window')}).default
  const root=node('root'), props=Vue.reactive({page,canEdit}), app=renderer.createApp({render:()=>Vue.h(component,{...props,onDirty:v=>dirty.push(v)})}); app.mount(root)
  const nodes=()=>{const a=[];const walk=n=>{a.push(n);n.children.forEach(walk)};walk(root);return a}
  const button=label=>nodes().find(n=>n.type==='button'&&n.text===label), control=label=>nodes().find(n=>n.props['aria-label']===label)
  const text=()=>nodes().filter(n=>n.type!=='#comment').map(n=>n.text).join(' ')
  const click=async label=>{assert.ok(button(label),label);await button(label).props.onClick();await flush()}
  const set=async(label,value)=>{const n=control(label);n.props['onUpdate:modelValue'](value);await flush()}
  const consent=async value=>{control('图片授权与本地处理同意').props.onChange({target:{checked:value}});await flush()}
  const choose=async(role,value)=>{const n=control(role==='portrait'?'选择人像图片':'选择风格图片');const p=n.props.onChange({target:{files:[value],value:'selected'}});await flush();return p}
  const submit=async label=>{control(label).props.onSubmit({preventDefault(){},stopPropagation(){}});await flush()}
  return {app,props,dirty,nodes,text,button,control,click,set,consent,choose,submit}
}
const disabled=n=>n.props.disabled===true||n.props.disabled===''
test('three real components keep save/publish disabled, work without session/HTTP/storage/history/message access',async()=>{
  for(const page of ['ai','retention','social']){
    const p=mountPage(page);await flush();assert.ok(disabled(p.button('保存草稿 · C2 未接通')));assert.ok(disabled(p.button('发布 · C2 未接通')))
    await p.click('查看手机效果');assert.match(p.text(),/本机预览 · 不发送请求/);p.app.unmount()
  }
  assert.deepEqual(effects,[])
})
test('actual component gates file selection and generation, independent reset, style replacement, consent revoke and real mode',async()=>{
  let calls=0
  const p=mountPage('ai',true,{localFile:async f=>f,runOfflineSample:async input=>{calls++;assert.equal(input.consent,true);return input.style}});await flush()
  assert.ok(disabled(p.control('选择人像图片')));await p.click('生成离线本地样例');assert.equal(calls,0)
  await p.consent(true);await p.choose('portrait',data(20));await p.click('生成离线本地样例');assert.equal(calls,0)
  await p.choose('style',data(80));await p.click('生成离线本地样例');assert.equal(calls,1)
  assert.ok(p.nodes().some(n=>n.type==='img'&&n.props.alt==='离线双图合成样例，非模型输出'))
  await p.choose('style',data(90));assert.equal(p.nodes().some(n=>n.props.alt==='离线双图合成样例，非模型输出'),false)
  assert.ok(p.nodes().some(n=>n.props.alt==='本机选定的人像，仅内存'&&n.props.src===data(20)))
  await p.click('生成离线本地样例');assert.equal(calls,2)
  await p.click('重置风格');assert.ok(disabled(p.button('生成离线本地样例')));assert.ok(p.nodes().some(n=>n.props.alt==='本机选定的人像，仅内存'))
  await p.choose('style',data(90));await p.set('运行模式','real');await p.click('生成离线本地样例');assert.equal(calls,2);assert.match(p.text(),/NOT_RUN/)
  await p.consent(false);assert.equal(p.nodes().filter(n=>n.type==='img').length,0)
  await p.click('调用记录');assert.match(p.text(),/尚无本机试跑记录/);p.app.unmount();assert.deepEqual(effects,[])
})
test('stale generation and file decode cannot restore images after replace/reset/unmount',async()=>{
  let resolveRun,resolveFile
  const p=mountPage('ai',true,{localFile:f=>typeof f==='string'?Promise.resolve(f):new Promise(resolve=>{resolveFile=resolve}),runOfflineSample:()=>new Promise(resolve=>{resolveRun=resolve})});await flush();await p.consent(true)
  await p.choose('portrait',data(20));await p.choose('style',data(80))
  const running=p.button('生成离线本地样例').props.onClick();await flush();await p.click('重置风格');resolveRun(data(90));await running;await flush()
  assert.equal(p.nodes().some(n=>n.props.alt==='离线双图合成样例，非模型输出'),false)
  // Do not await pending selection: invalidate it by revoking consent.
  const pending=p.choose('style',{});await flush();await p.consent(false);resolveFile(data(80));await pending;await flush()
  assert.equal(p.nodes().filter(n=>n.type==='img').length,0)
  p.app.unmount();assert.deepEqual(effects,[])
})
test('actual component failure/retry and recipe actions keep sanitized records in memory only',async()=>{
  let attempts=0
  const p=mountPage('ai',true,{localFile:async f=>f,runOfflineSample:async (_input,options)=>{attempts++;if(options.fail)throw Error('private-file-name data:image secret upstream text');return data(80)}})
  await flush();await p.consent(true);await p.choose('portrait',data(20));await p.choose('style',data(80));await p.click('失败演练（仅本机）')
  assert.match(p.text(),/本机试片失败/);assert.doesNotMatch(p.text(),/private-file-name|secret upstream/)
  await p.click('重试本机试片');assert.equal(attempts,2)
  await p.click('调用记录');assert.match(p.text(),/离线成功/);assert.match(p.text(),/离线失败/);assert.doesNotMatch(p.text(),/private-file-name|secret upstream|data:image/)
  await p.click('风格配方');await p.set('配方优先级','style');await p.click('带入试跑');assert.equal(p.control('本地配方').selectedIndex,2)
  assert.ok(disabled(p.button('保存试片 · 未接通')))
  await p.click('风格配方');assert.ok(disabled(p.button('保存配方 · 未接通')));await p.click('恢复内置配方');await p.click('双图调试台');assert.equal(p.control('本地配方').selectedIndex,1)
  p.props.canEdit=false;await flush();assert.equal(p.nodes().filter(n=>n.type==='img').length,0);p.app.unmount();assert.deepEqual(effects,[])
})
test('actual components apply validated memory drafts, reject invalid edits and clear on remount',async()=>{
  const p=mountPage('retention');await flush();await p.set('阶段标签','新阶段\n新阶段');await p.submit('阶段计划编辑');assert.match(p.text(),/不重复/)
  await p.set('阶段标签','新的生活');await p.set('快捷回访天数','45，90');await p.submit('阶段计划编辑');await p.click('查看手机效果');assert.match(p.text(),/新的生活/);assert.match(p.text(),/45 \/ 90 天/);assert.match(p.text(),/未发送提醒/)
  p.app.unmount();const fresh=mountPage('retention');await flush();assert.equal(fresh.control('阶段标签').value,'日常生活\n新学期\n新工作\n新城市\n生活转折\n项目冲刺\n假期休息');fresh.app.unmount()
  const s=mountPage('social');await flush();await s.set('匿名最低人数阈值',9);await s.submit('交换与雷达编辑');assert.match(s.text(),/10–200/)
  await s.set('匿名最低人数阈值',20);await s.set('推荐顺序','same');await s.set('每人每日申请上限',3);await s.submit('交换与雷达编辑');await s.click('查看手机效果');await s.set('雷达呈现条件','below')
  assert.match(s.text(),/人数较少/);assert.match(s.text(),/count: null/);assert.match(s.text(),/每日最多 3 次/);assert.ok(disabled(s.button('发起申请 · 预览中不可发送')))
  await s.set('开放同型雷达',false);await s.submit('交换与雷达编辑');assert.match(s.text(),/同型雷达暂未开放/);s.app.unmount();assert.deepEqual(effects,[])
})
test('capability false blocks all B4 mutation handlers, even direct disabled-click invocation',async()=>{
  let reads=0,runs=0
  const p=mountPage('ai',false,{localFile:async()=>{reads++},runOfflineSample:async()=>{runs++}});await flush();await p.consent(true);await p.choose('portrait',data(20));await p.click('生成离线本地样例');assert.equal(reads,0);assert.equal(runs,0);p.app.unmount()
  for(const [page,label] of [['retention','阶段计划编辑'],['social','交换与雷达编辑']]){const p=mountPage(page,false);await flush();await p.submit(label);assert.equal(p.dirty.length,0);p.app.unmount()}
  assert.deepEqual(effects,[])
})
test('route mounts use existing server capability and v1 boundary remains unchanged; no B4 external effect imports',()=>{
  const ops=source('../src/ops.vue');assert.match(ops,/<B4Page v-if="b4Scope && visiblePage"/);assert.match(ops,/:can-edit="sessionState.capabilities.draft"/)
  assert.equal(contract.CONFIG_CONTRACT_VERSION,'mbti-config-consumer/v1')
  for(const f of ['b4.vue','b4-model.ts','b4-image.ts'])assert.doesNotMatch(source('../src/'+f),/\bfetch\s*\(|localStorage|sessionStorage|indexedDB|createOrder|sendBeacon|postMessage|\.\.\/\.\.\/web/)
  assert.deepEqual(effects,[])
})
