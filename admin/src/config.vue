<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import ConfigPreview from './config-preview.vue'
import { C2_DEPENDENCY, unavailableConsumer, type ConfigConsumerV1, type ConfigScope } from './config-contract-v1'
import { applyEdit, channels, dimensions, fieldsFor, landingPages, referenceConfiguration, simulate, type Art, type Channel, type EditKind, type EditValues, type Field, type PreviewPage, type UiConfiguration } from './config-model'
import editorial from './config-assets/editorial.webp'
import illustration from './config-assets/illustration.webp'
import game from './config-assets/game.webp'
import './config.css'
const props = defineProps<{ page: ConfigScope; consumer?: ConfigConsumerV1<UiConfiguration> }>()
const emit = defineEmits<{ dirty: [value: boolean] }>()
const consumer = props.consumer ?? unavailableConsumer<UiConfiguration>()
const reference = referenceConfiguration(), draft = ref(referenceConfiguration()), published = ref<UiConfiguration | null>(null)
const revision = ref<unknown>(), connected = ref(false), readNote = ref(C2_DEPENDENCY as string)
const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(reference))
const tab = ref('home'), dimension = ref('全部'), personaQuery = ref(''), personaGroup = ref('全部')
const modal = ref<'edit' | 'preview' | 'score' | ''>(''), title = ref(''), sheet = ref<HTMLElement | null>(null)
const editKind = ref<EditKind>('hero'), editKey = ref(''), fields = ref<Field[]>([]), values = ref<EditValues>({}), originalValues = ref(''), error = ref(''), notice = ref(''), confirmDiscard = ref(false)
let returnFocus: HTMLElement | null = null
const previewPage = ref<PreviewPage>('home'), previewChannel = ref<Channel>('wechat'), previewType = ref('INFP'), previewStyle = ref<Art>('illustration'), previewPlan = ref('basic')
const answers = ref<Record<string, string>>({}), result = ref<ReturnType<typeof simulate> | null>(null)
const assets = { editorial, illustration, game }
const tabs = computed(() => props.page === 'content' ? [['home', '首页与场景'], ['channels', '平台入口']] : props.page === 'catalog' ? [['shop', '商品套装'], ['styles', '海报与头像模板']] : [['bank', '题库与计分'], ['personas', '人格与相处说明书']])
const filteredQuestions = computed(() => draft.value.quiz.questions.filter(q => dimension.value === '全部' || q.dimension === dimension.value))
const filteredPersonas = computed(() => Object.entries(draft.value.personas).filter(([code, p]) => (personaGroup.value === '全部' || (personaGroup.value[0] === 'N' ? code[1] === 'N' && code[2] === personaGroup.value[1] : code[1] === 'S' && code[3] === personaGroup.value[1])) && `${code} ${p.title} ${p.quote}`.toLowerCase().includes(personaQuery.value.toLowerCase())))
const bufferDirty = computed(() => modal.value === 'edit' && JSON.stringify(values.value) !== originalValues.value)
watch([dirty, bufferDirty], ([a, b]) => emit('dirty', a || b))
watch(() => props.page, () => { tab.value = tabs.value[0]![0]!; modal.value = ''; confirmDiscard.value = false; notice.value = ''; emit('dirty', dirty.value) }, { immediate: true })
watch(answers, () => { result.value = null }, { deep: true })
async function readConfiguration() {
  // Static reference is never relabelled as a durable draft or live configuration.
  const [d, p] = await Promise.all([consumer.read(props.page, 'draft'), consumer.read(props.page, 'published')])
  if (d.status === 'ready') { draft.value = d.value; revision.value = d.revision; connected.value = true }
  else readNote.value = d.reason
  published.value = p.status === 'ready' ? p.value : null
}
async function open(kind: typeof modal.value, heading: string) {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  modal.value = kind; title.value = heading; error.value = ''; confirmDiscard.value = false
  await nextTick(); sheet.value?.focus()
}
function edit(kind: EditKind, key = '') {
  editKind.value = kind; editKey.value = key; fields.value = fieldsFor(draft.value, kind, key)
  values.value = Object.fromEntries(fields.value.map(f => [f.key, f.value])); originalValues.value = JSON.stringify(values.value)
  const headings = { hero: '编辑首页首屏', scenes: '编辑消费场景', channel: '编辑渠道入口', sku: '编辑商品套装', style: '编辑视觉模板', question: '编辑题干与计分方向', persona: `${key} 人格内容` }
  void open('edit', headings[kind])
}
function close(force = false) {
  if (!force && bufferDirty.value) { confirmDiscard.value = true; return }
  modal.value = ''; confirmDiscard.value = false; returnFocus?.focus()
}
function apply() {
  try {
    draft.value = applyEdit(toRaw(draft.value), editKind.value, editKey.value, toRaw(values.value))
    notice.value = '已应用到内存草稿预览；未保存、未发布，刷新即丢失。'; result.value = null; close(true)
  } catch (e) { error.value = e instanceof Error ? e.message : '请检查输入。' }
}
function preview(page: PreviewPage, channel: Channel = 'wechat', type = 'INFP', style: Art = 'illustration', plan = 'basic') {
  previewPage.value = page; previewChannel.value = channel; previewType.value = type; previewStyle.value = style; previewPlan.value = plan
  void open('preview', '前台效果预览')
}
function score() {
  answers.value = Object.fromEntries(draft.value.quiz.questions.map(q => [q.id, q.options[1]!.id])); result.value = null
  void open('score', '用 12 个选项试算')
}
function count(side: string) { return result.value?.counts[side as keyof ReturnType<typeof simulate>['counts']] ?? 0 }
function calculate() {
  try { result.value = simulate(toRaw(draft.value.quiz.questions), Object.entries(answers.value).map(([question_id, option_id]) => ({ question_id, option_id }))); error.value = '' }
  catch (e) { result.value = null; error.value = e instanceof Error ? e.message : '答案无效。' }
}
async function saveDraft() {
  if (!consumer.persistence || !connected.value) return
  const saved = await consumer.saveDraft(props.page, toRaw(draft.value), revision.value)
  if (saved.status === 'unavailable') { readNote.value = saved.reason; connected.value = false }
  else { revision.value = saved.revision; draft.value = saved.value }
}
function reset() { if (window.confirm('放弃全部内存草稿并恢复原稿参考？此操作不会改动线上配置。')) { draft.value = referenceConfiguration(); notice.value = '已恢复静态原稿参考。' } }
function onBeforeUnload(event: BeforeUnloadEvent) { if (dirty.value || bufferDirty.value) { event.preventDefault(); event.returnValue = '' } }
function onKey(event: KeyboardEvent) {
  if (!modal.value) return
  if (event.key === 'Escape') { event.stopImmediatePropagation(); close(); return }
  if (event.key !== 'Tab') return
  const nodes = sheet.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, [tabindex="0"]')
  if (!nodes?.length) { event.preventDefault(); return }
  const first = nodes[0]!, last = nodes[nodes.length - 1]!
  if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === sheet.value)) { event.preventDefault(); first.focus() }
}
defineExpose({ openPreview: () => preview(props.page === 'content' ? 'home' : props.page === 'catalog' ? 'pricing' : 'result') })
onMounted(() => { void readConfiguration(); window.addEventListener('beforeunload', onBeforeUnload); window.addEventListener('keydown', onKey, true) })
onUnmounted(() => { window.removeEventListener('beforeunload', onBeforeUnload); window.removeEventListener('keydown', onKey, true); emit('dirty', false) })
</script>

<template>
  <section class="config-page" :aria-label="`${page} 配置`">
    <div class="config-boundary"><div><b>UI_CONTRACT · {{ dirty ? '内存草稿有更改' : '静态原稿参考' }}</b><p>{{ readNote }} 编辑仅用于本页草稿预览，刷新即丢失。服务端约束与角色校验 NOT_RUN。</p></div><div class="config-actions"><button class="outline-button" :disabled="!dirty" @click="reset">放弃内存草稿</button><button class="primary" :disabled="!consumer.persistence || !connected" :title="C2_DEPENDENCY" @click="saveDraft">保存草稿 · C2 未接通</button><button class="outline-button" disabled :title="C2_DEPENDENCY">发布 · C2 未接通</button></div></div>
    <p v-if="notice" class="config-notice" role="status">{{ notice }}</p>
    <div class="config-tabbar"><div class="config-tabs" role="tablist" aria-label="配置栏目"><button v-for="t in tabs" :key="t[0]" role="tab" :aria-selected="tab === t[0]" :class="{ active: tab === t[0] }" @click="tab = t[0]!">{{ t[1] }}</button></div><button class="outline-button" @click="preview(page === 'content' ? 'home' : page === 'catalog' ? 'pricing' : 'result')">查看手机效果</button><button v-if="page === 'assessment'" class="primary" @click="score">试算结果</button></div>
    <template v-if="page === 'content'">
      <div v-if="tab === 'home'" class="config-grid">
        <article class="panel config-card"><div class="config-card-head"><div><p class="eyebrow">FIRST IMPRESSION</p><h2>首页首屏</h2><p>移动端首页与免费测试按钮</p></div><button class="outline-button" @click="edit('hero')">编辑首屏</button></div><dl><dt>标题</dt><dd class="config-headline">{{ draft.content.headline }}<em>{{ draft.content.accent }}</em></dd><dt>说明</dt><dd>{{ draft.content.sub }}</dd><dt>按钮</dt><dd>{{ draft.content.cta }}</dd></dl><button class="text-button" @click="preview('home')">查看手机效果 →</button></article>
        <article class="panel config-card"><div class="config-card-head"><div><p class="eyebrow">EVERYDAY SCENES</p><h2>消费场景</h2><p>付费页文案和朋友圈配文</p></div><button class="outline-button" @click="edit('scenes')">编辑场景</button></div><dl><template v-for="(label, key) in { moments: '发朋友圈', avatar: '换头像', meet: '见面亮名片', caption: '默认配文' }" :key="key"><dt>{{ label }}</dt><dd>{{ draft.content[key] }}</dd></template></dl><div class="config-actions"><button class="text-button" @click="preview('pricing')">查看付费页 →</button><button class="text-button" @click="preview('share')">代入 {type} 预览 →</button></div></article>
      </div>
      <div v-else class="config-grid"><article v-for="(ch, i) in channels" :key="ch.id" class="panel config-card"><div class="config-card-head"><h2><span class="config-channel-logo">{{ ['微', '红', '抖', 'H5'][i] }}</span>{{ ch.label }}</h2><span class="config-chip">原稿 / 草稿</span></div><dl><dt>默认入口</dt><dd>{{ landingPages[draft.channels[ch.id].landing] }}</dd><dt>首页栏目语</dt><dd>{{ draft.channels[ch.id].badge }}</dd></dl><div class="config-actions"><button class="outline-button" @click="edit('channel', ch.id)">编辑渠道</button><button class="outline-button" @click="preview(draft.channels[ch.id].landing, ch.id)">模拟进入</button></div></article></div>
    </template>
    <template v-else-if="page === 'catalog'">
      <div v-if="tab === 'shop'" class="config-grid"><article v-for="(p, i) in draft.shop" :key="p.id" class="panel config-card"><div class="config-card-head"><p class="eyebrow">PACKAGE / 0{{ i + 1 }}</p><span class="config-chip" :class="{ inactive: !p.on }">{{ p.on ? '上架' : '下架' }} · 草稿</span></div><h2>{{ p.title }}</h2><strong class="config-price">¥{{ (p.cents / 100).toFixed(2) }}</strong><p>{{ p.desc }}</p><small class="muted">{{ p.cents }} 分 · 下单价由服务端校验</small><div class="config-actions"><button class="outline-button" @click="edit('sku', p.id)">修改商品</button><button class="outline-button" @click="preview('pricing', 'wechat', 'INFP', 'illustration', p.id)">预览购买页</button></div></article></div>
      <div v-else class="config-grid config-three"><article v-for="s in [...draft.styles].sort((a, b) => a.order - b.order)" :key="s.id" class="panel config-card"><div class="config-art"><img :src="assets[s.art]" :alt="`${s.title}原稿示例`"><small>LOOK / 0{{ s.order }}</small><strong>INFP</strong></div><div class="config-card-head"><h2>{{ s.title }}</h2><span class="config-chip" :class="{ inactive: !s.on }">{{ s.on ? '启用' : '停用' }} · 草稿</span></div><p>海报 · 同款头像 · 名片视觉</p><div class="config-actions"><button class="outline-button" @click="edit('style', s.id)">编辑模板</button><button class="outline-button" @click="preview('create', 'wechat', 'INFP', s.id)">手机预览</button></div></article></div>
      <p class="config-notice">基础测试、阶段记录与名片交换免费。保留两档套装，至少一档上架、一个风格启用。价格按分维护；草稿不会修改历史流水、订单和权益。</p>
    </template>
    <template v-else>
      <section v-if="tab === 'bank'" class="panel config-question-panel"><div class="config-card-head"><div><h2>原创固定选择题</h2><p>12 题 · 每维 3 题 · 最近四周 · 多数票定倾向</p><small class="config-version">{{ draft.quiz.question_bank_version }}</small></div><label>筛选维度<select v-model="dimension" aria-label="筛选维度"><option>全部</option><option v-for="d in dimensions" :key="d">{{ d }}</option></select></label></div><div class="config-table-scroll"><table><thead><tr><th scope="col">序号</th><th scope="col">题目 / 两个选项</th><th scope="col">维度</th><th scope="col">A / B 得分</th><th scope="col">操作</th></tr></thead><tbody><tr v-for="q in filteredQuestions" :key="q.id"><th scope="row">{{ String(q.index).padStart(2, '0') }}</th><td>{{ q.prompt }}<small>A · {{ q.options[0]?.label }}<br>B · {{ q.options[1]?.label }}</small></td><td><span class="config-chip">{{ q.dimension }}</span></td><td>{{ q.reverse ? q.dimension[1] : q.dimension[0] }} / {{ q.reverse ? q.dimension[0] : q.dimension[1] }}<small v-if="q.reverse">反向计分</small></td><td><button class="outline-button" :aria-label="`编辑第 ${q.index} 道题`" @click="edit('question', q.id)">编辑</button></td></tr></tbody></table></div></section>
      <template v-else><div class="config-persona-filters"><label>搜索人格<input v-model="personaQuery" aria-label="搜索人格" placeholder="类型、角色、宣言"></label><label>人格分组<select v-model="personaGroup" aria-label="人格分组"><option>全部</option><option v-for="g in ['NT', 'NF', 'SJ', 'SP']" :key="g">{{ g }}</option></select></label><span>{{ filteredPersonas.length }} / 16 类型</span></div><div class="config-persona-grid"><article v-for="[code, p] in filteredPersonas" :key="code" class="panel config-persona"><strong>{{ code }}</strong><h2>{{ p.title }}</h2><p>{{ p.quote }}</p><div class="config-actions"><button class="text-button" @click="edit('persona', code)">编辑说明书</button><button class="text-button" :aria-label="`${code} 手机预览`" @click="preview('result', 'wechat', code)">手机预览 →</button></div></article></div><p v-if="!filteredPersonas.length" class="config-unavailable">没有匹配的人格，清空搜索或切换分组。</p></template>
      <p class="config-notice">候选题库 qb-v0.4-prototype-1 为只读初始来源。题目 / 映射变化仅生成 preview-only 草稿标识，正式题库版本由 C2 确认；历史测评与阶段记录不变。趣味倾向参考。</p>
    </template>
    <div v-if="modal" class="config-overlay" @click.self="close()"><section ref="sheet" class="config-sheet" :class="{ wide: modal === 'preview' }" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1"><header><div><p class="eyebrow">{{ modal === 'preview' ? 'FRONTEND PREVIEW' : modal === 'score' ? 'PURE SIMULATION' : 'MEMORY DRAFT' }}</p><h2>{{ title }}</h2></div><button class="icon-button" aria-label="关闭配置抽屉" @click="close()">×</button></header><div class="config-sheet-body">
      <div v-if="confirmDiscard" class="config-discard" role="alert"><b>放弃尚未应用的输入？</b><p>当前输入仅在内存，尚未保存。</p><button class="outline-button" @click="confirmDiscard = false">继续编辑</button><button class="outline-button" @click="close(true)">放弃输入并关闭</button></div>
      <form v-if="modal === 'edit'" id="b3-edit" class="config-form" @submit.prevent="apply"><label v-for="f in fields" :key="f.key" :class="{ 'config-check': f.type === 'checkbox' }"><input v-if="f.type === 'checkbox'" v-model="values[f.key]" type="checkbox" :aria-label="f.label"><span>{{ f.label }}</span><textarea v-if="f.type === 'textarea'" :value="String(values[f.key])" :aria-label="f.label" :maxlength="f.max" rows="3" required @input="values[f.key] = ($event.target as HTMLTextAreaElement).value"></textarea><select v-else-if="f.type === 'select'" v-model="values[f.key]" :aria-label="f.label"><option v-for="o in f.options" :key="o.value" :value="o.value">{{ o.label }}</option></select><input v-else-if="f.type !== 'checkbox'" v-model="values[f.key]" :type="f.type === 'number' ? 'number' : 'text'" :aria-label="f.label" :maxlength="f.max" :min="f.type === 'number' ? '0.01' : undefined" :max="f.type === 'number' ? '9999.99' : undefined" :step="f.type === 'number' ? '0.01' : undefined" required><small v-if="f.max">最多 {{ f.max }} 字</small></label><p v-if="editKind === 'scenes'" class="muted">默认配文可用 {type} 代入人格。</p><p v-if="editKind === 'question'" class="muted">固定维度，方向可反转。修改不追溯历史测评。</p><p class="config-notice">应用仅更新内存草稿预览。{{ C2_DEPENDENCY }}</p></form>
      <ConfigPreview v-else-if="modal === 'preview'" :draft="draft" :reference="reference" :published="published" :initial-page="previewPage" :initial-channel="previewChannel" :initial-type="previewType" :initial-style="previewStyle" :initial-plan="previewPlan" />
      <template v-else><p class="config-notice">每维度 3 题，各自取多数票并应用反向计分。纯试算，不写入用户历史。</p><form id="b3-score" @submit.prevent="calculate"><fieldset v-for="q in draft.quiz.questions" :key="q.id" class="config-score-question"><legend>{{ q.index }}. {{ q.prompt }}</legend><label v-for="(o, i) in q.options" :key="o.id"><input v-model="answers[q.id]" type="radio" :name="`score-${q.id}`" :value="o.id">{{ i === 0 ? 'A' : 'B' }} · {{ o.label }}</label></fieldset></form><div v-if="result" class="config-score-result" role="status"><h3>试算结果：{{ result.type }}</h3><p v-for="d in dimensions" :key="d">{{ d[0] }} {{ count(d[0]!) }} : {{ count(d[1]!) }} {{ d[1] }}</p><small>只存在当前抽屉，不创建个人结果。</small></div></template>
      <p v-if="error" class="error-text config-error" role="alert">{{ error }}</p>
    </div><footer><span v-if="bufferDirty" class="config-chip">有未应用输入</span><button class="outline-button" @click="close()">{{ modal === 'preview' ? '完成预览' : '返回' }}</button><button v-if="modal === 'edit'" form="b3-edit" class="primary">应用到内存预览</button><button v-if="modal === 'edit'" class="outline-button" disabled :title="C2_DEPENDENCY">保存草稿 · C2 未接通</button><button v-if="modal === 'score'" form="b3-score" class="primary">计算结果</button></footer></section></div>
  </section>
</template>
