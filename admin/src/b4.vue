<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { OpsApiError, readRetentionCohorts, type RetentionCohort } from './ops-api'
import { cohortSemantics, initialLifecycle, initialSocial, lifecycleInput, radarProjection, socialInput, type B4Page } from './b4-model'
import { generationBlock, localFile, recipeLabel, runOfflineSample, sanitizedRecord, type CallRecord, type ImageMode, type Recipe } from './b4-image'
import { C2_DEPENDENCY, CONFIG_CONTRACT_VERSION } from './config-contract-v1'
import './config.css'
import './b4.css'

const props = defineProps<{ page: B4Page; canEdit: boolean }>()
const emit = defineEmits<{ dirty: [value: boolean] }>()
const tab = ref('lab'), preview = ref(false), previewPanel = ref<HTMLElement | null>(null)
const consent = ref(false), portrait = ref(''), style = ref(''), mode = ref<ImageMode>('offline'), recipe = ref<Recipe>('balanced'), persona = ref('INFP')
const recipeBuffer = ref<Recipe>('balanced'), result = ref(''), error = ref(''), notice = ref(''), busy = ref(false), records = ref<CallRecord[]>([])
const selecting = reactive({ portrait: false, style: false })
let revision = 0, active = true
const slotRevision = { portrait: 0, style: 0 }
const pair = computed(() => ({ portrait: portrait.value, style: style.value, consent: consent.value, mode: mode.value, recipe: recipe.value }))
const blocked = computed(() => !props.canEdit ? '当前会话没有草稿/本地试跑页面能力。' : generationBlock(pair.value))
const lifecycle = ref(initialLifecycle()), tagsText = ref(lifecycle.value.tags.join('\n')), daysText = ref(lifecycle.value.days.join('，'))
const social = ref(initialSocial()), socialBuffer = reactive(initialSocial())
const scenario = ref('unavailable')
const radar = computed(() => radarProjection(social.value.radar, social.value.minimum, scenario.value === 'unavailable' ? null : scenario.value === 'below' ? social.value.minimum - 1 : Math.ceil(social.value.minimum / 10) * 10 + 3))
const cohort = ref<RetentionCohort | null>(null)
const cohortError = ref('')
async function loadCohort() {
  if (props.page !== 'retention') return
  cohortError.value = ''
  try { cohort.value = await readRetentionCohorts() }
  catch (err) {
    cohort.value = null
    cohortError.value = err instanceof OpsApiError ? err.message : '成熟队列读取失败'
  }
}
onMounted(() => { void loadCohort() })
watch(() => props.page, () => { void loadCohort() })
function invalidate() { revision++; result.value = ''; busy.value = false; error.value = '' }
function clearSlot(role: 'portrait' | 'style') {
  slotRevision[role]++; selecting[role] = false; invalidate()
  if (role === 'portrait') portrait.value = ''; else style.value = ''
}
function clearImages() { clearSlot('portrait'); clearSlot('style') }
function authorize(event: Event) {
  consent.value = props.canEdit && (event.target as HTMLInputElement).checked
  if (!consent.value) { clearImages(); records.value = [] }
}
async function selectFile(role: 'portrait' | 'style', event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (!props.canEdit || !consent.value || !file) return
  clearSlot(role)
  const token = slotRevision[role]; selecting[role] = true
  try {
    const data = await localFile(file, consent.value)
    if (!active || token !== slotRevision[role] || !consent.value || !props.canEdit) return
    if (role === 'portrait') portrait.value = data; else style.value = data
  } catch {
    if (active && token === slotRevision[role]) error.value = '本地图片读取失败。请选择 8 MB 以内、240–8000 像素的 JPG / PNG / WEBP；图片不会上传。'
  } finally { if (active && token === slotRevision[role]) selecting[role] = false }
}
async function generate(fail = false) {
  if (blocked.value || busy.value || selecting.portrait || selecting.style) return
  invalidate(); const token = revision, start = performance.now(), input = { ...pair.value }; busy.value = true
  try {
    const image = await runOfflineSample(input, { fail })
    if (!active || token !== revision) return
    result.value = image; records.value.unshift(sanitizedRecord('success', input.recipe, performance.now() - start))
  } catch {
    if (!active || token !== revision) return
    error.value = '本机试片失败，未上传图片、未调用模型。可手动重试。'
    records.value.unshift(sanitizedRecord('failed', input.recipe, performance.now() - start))
  } finally {
    if (active && token === revision) { busy.value = false; records.value = records.value.slice(0, 20) }
  }
}
function applyRecipe() {
  if (!props.canEdit || !Object.hasOwn(recipeLabel, recipeBuffer.value)) return
  recipe.value = recipeBuffer.value; tab.value = 'lab'; notice.value = '配方仅带入当前内存试跑，未保存。'; emit('dirty', true)
}
function restoreRecipe() { if (!props.canEdit) return; recipeBuffer.value = 'balanced'; recipe.value = 'balanced'; invalidate(); notice.value = '已恢复内置均衡配方，仅当前预览。' }
function applyLifecycle() {
  if (!props.canEdit) return
  try { lifecycle.value = lifecycleInput(tagsText.value, daysText.value); error.value = ''; notice.value = '阶段计划已应用到内存预览，未保存、未发送提醒。'; emit('dirty', true) }
  catch (e) { error.value = (e as Error).message }
}
function applySocial() {
  if (!props.canEdit) return
  try { social.value = socialInput(socialBuffer); error.value = ''; notice.value = '交换与雷达规则已应用到内存预览，未保存、未发送申请。'; emit('dirty', true) }
  catch (e) { error.value = (e as Error).message }
}
async function openPreview() { preview.value = true; await nextTick(); previewPanel.value?.focus() }
defineExpose({ openPreview })
watch([mode, recipe, persona], () => invalidate(), { flush: 'sync' })
watch(() => props.canEdit, allowed => { if (!allowed) { consent.value = false; clearImages(); records.value = [] } })
onUnmounted(() => { active = false; clearImages(); records.value = [] })
</script>

<template>
  <section class="config-page b4-page" :aria-label="`${page} 本地预览工作区`">
    <div class="config-boundary"><div><b>仅内存预览 · 未保存、未发布</b><p>{{ CONFIG_CONTRACT_VERSION }} · {{ C2_DEPENDENCY }} 新增字段映射 unknowns / needs_human_review。</p></div><div class="config-actions"><button class="outline-button" @click="openPreview">查看手机效果</button><button class="outline-button" disabled :title="C2_DEPENDENCY">保存草稿 · C2 未接通</button><button class="primary" disabled :title="C2_DEPENDENCY">发布 · C2 未接通</button></div></div>
    <p v-if="!canEdit" class="config-notice">当前会话没有草稿页面能力；本地编辑与试跑已禁用。服务端授权验收 NOT_RUN。</p>
    <template v-if="page === 'ai'">
      <div class="config-tabs b4-tabs" aria-label="图像工作室子页"><button v-for="[id, label] in [['lab','双图调试台'],['recipes','风格配方'],['records','调用记录']]" :key="id" :aria-pressed="tab === id" :class="{ active: tab === id }" @click="tab = id">{{ label }}</button></div>
      <section v-if="tab === 'lab'" class="panel config-card">
        <div class="config-card-head"><div><p class="eyebrow">TWO INPUTS / LOCAL ONLY</p><h2>图 1 人像 → 图 2 风格</h2><p>离线调色合成样例，非 AI 模型重绘。文件仅在当前页内存中显示，离开页面清除。</p></div><span class="config-chip">{{ mode === 'offline' ? '离线本地样例' : '真实模型 · 未接通' }}</span></div>
        <label class="b4-consent"><input type="checkbox" aria-label="图片授权与本地处理同意" :checked="consent" :disabled="!canEdit" @change="authorize"><span>我确认有权使用两张图片，并同意在本机读取与合成。此同意不包含上传、模型调用或发布；取消将清空图片和试片。</span></label>
        <div class="config-grid b4-images">
          <article v-for="role in (['portrait','style'] as const)" :key="role" class="b4-slot"><b>{{ role === 'portrait' ? '01 / 人像图片' : '02 / 风格图片' }}</b><div class="b4-image-frame"><img v-if="role === 'portrait' ? portrait : style" :src="role === 'portrait' ? portrait : style" :alt="role === 'portrait' ? '本机选定的人像，仅内存' : '本机选定的风格，仅内存'"><p v-else>{{ selecting[role] ? '正在本地读取…' : role === 'portrait' ? '先选择人像图片' : '独立选择风格参考' }}</p></div><label>{{ role === 'portrait' ? '选择 / 替换图 1（仅本机）' : '选择 / 替换图 2（仅本机）' }}<input type="file" accept="image/jpeg,image/png,image/webp" :aria-label="role === 'portrait' ? '选择人像图片' : '选择风格图片'" :disabled="!canEdit || !consent" @change="selectFile(role, $event)"></label><button class="text-button" :disabled="!canEdit || !consent" @click="clearSlot(role)">{{ role === 'portrait' ? '重置人像' : '重置风格' }}</button></article>
        </div>
        <div class="b4-controls"><label>运行模式<select v-model="mode" aria-label="运行模式" :disabled="!canEdit"><option value="offline">离线本地样例 · 无上传</option><option value="real">真实模型 · UI_CONTRACT</option></select></label><label>本地配方<select v-model="recipe" aria-label="本地配方" :disabled="!canEdit"><option v-for="(label, id) in recipeLabel" :key="id" :value="id">{{ label }}</option></select></label><label>人格排版<select v-model="persona" aria-label="人格排版" :disabled="!canEdit"><option v-for="code in ['INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP']" :key="code">{{ code }}</option></select></label></div>
        <p class="config-notice">映射固定：第一张保留人物构图，第二张提供色彩与纹理；替换任一图片、模式、配方或人格立即清除旧结果。没有个人提示词输入。真实网关状态：未检查 / NOT_RUN；不会探测健康端点。</p>
        <p v-if="blocked" class="muted" role="status">{{ blocked }}</p><div class="config-actions b4-actions"><button class="primary" :disabled="!!blocked || busy || selecting.portrait || selecting.style" @click="generate()">{{ busy ? '正在本机合成…' : '生成离线本地样例' }}</button><button class="outline-button" :disabled="!!blocked || busy || selecting.portrait || selecting.style" @click="generate(true)">失败演练（仅本机）</button><button v-if="error" class="outline-button" :disabled="!!blocked || busy" @click="generate()">重试本机试片</button><button class="outline-button" :disabled="!canEdit || !consent" @click="clearImages">恢复两张图为空</button><button class="outline-button" disabled title="UI_CONTRACT：现有 Foundation 无同契约双图模型端点及服务端试跑授权">提交真实模型 · 未接通</button><button class="outline-button" disabled title="UI_CONTRACT：试片资产保存/权限/保留策略未接通">保存试片 · 未接通</button></div>
        <figure v-if="result" class="b4-result"><img :src="result" alt="离线双图合成样例，非模型输出"><figcaption>{{ persona }} · 离线本地样例 · {{ recipeLabel[recipe] }} · 非模型输出</figcaption></figure>
      </section>
      <section v-else-if="tab === 'recipes'" class="panel config-card"><p class="eyebrow">RECIPE / MEMORY ONLY</p><h2>风格配方</h2><p>配方仅调整本机色彩融合强度。图片引用与配方持久化均未接通，临时参考不会成为线上素材。</p><label>配方优先级<select v-model="recipeBuffer" aria-label="配方优先级" :disabled="!canEdit"><option v-for="(label, id) in recipeLabel" :key="id" :value="id">{{ label }}</option></select></label><div class="config-actions b4-actions"><button class="outline-button" :disabled="!canEdit" @click="applyRecipe">带入试跑</button><button class="outline-button" :disabled="!canEdit" @click="restoreRecipe">恢复内置配方</button><button class="outline-button" :disabled="!canEdit || !consent" @click="tab = 'lab'">替换风格参考（仅本机）</button><button class="outline-button" disabled title="UI_CONTRACT：C2 配方草稿、资产引用、版本和服务端编辑权限未接通">保存配方 · 未接通</button><button class="outline-button" disabled title="系统参数仅 owner 服务端能力；B4 不修改参数">系统连接参数 · B5/C2</button></div></section>
      <section v-else class="panel config-card"><h2>调用记录 · 当前页面内存</h2><p>仅记录后台离线试片，最多 20 条；刷新/离开清空，不含文件名、原图、成图、Base64、提示词或凭据。不是服务端审计记录。</p><p v-if="!records.length" class="config-unavailable">尚无本机试跑记录。真实模型记录来源未接通。</p><ol v-else class="b4-records"><li v-for="(r, i) in records" :key="i"><b>{{ r.status === 'success' ? '离线成功' : '离线失败' }}</b><span>{{ r.at }} · {{ r.durationMs }}ms · {{ recipeLabel[r.recipe] }}</span><small>后台本机 / offline / {{ r.errorCategory }}</small></li></ol></section>
    </template>
    <template v-else-if="page === 'retention'">
      <p v-if="cohortError" class="error-text" role="alert">{{ cohortError }} <button class="text-button" @click="loadCohort">重试</button></p>
      <div class="metric-grid">
        <article class="panel metric-card"><span>观察满 45 天的首测人数</span><b>{{ cohort ? cohort.eligible_first_tests : '—' }}</b><small>{{ cohort ? `as_of ${cohort.as_of}` : '读取中或不可得' }}</small></article>
        <article class="panel metric-card"><span>第 28–45 天同版复测人数</span><b>{{ cohort ? cohort.same_bank_retakes : '—' }}</b><small>同 bankVersion · 排除同日重测</small></article>
        <article class="panel metric-card"><span>阶段复测率</span><b>{{ cohort && cohort.retake_rate !== null ? cohort.retake_rate : '—' }}</b><small>{{ cohort && cohort.eligible_first_tests === 0 ? '分母为 0 · 率不可得' : 'eligible → same_bank_retakes' }}</small></article>
        <article class="panel metric-card"><span>复测后 7 天对比打开率</span><b>—</b><small>对比打开事件仍不可得</small></article>
      </div>
      <div class="config-grid"><form class="panel config-card b4-form" aria-label="阶段计划编辑" @submit.prevent="applyLifecycle"><p class="eyebrow">LIFECYCLE / MEMORY ONLY</p><h2>阶段与复测计划</h2><fieldset :disabled="!canEdit"><label>阶段标签（每行一个）<textarea v-model="tagsText" aria-label="阶段标签" maxlength="140" rows="5" @input="emit('dirty', true)"></textarea><small>1–10 个，不重复，每个最多 12 字。</small></label><label>快捷回访天数<input v-model="daysText" aria-label="快捷回访天数" maxlength="22" @input="emit('dirty', true)"><small>1–3 个不同整数，范围 1–365，逗号分隔。</small></label><button class="primary">应用阶段计划到内存预览</button></fieldset><p>用户仍可自选日期；旧阶段快照不会随标签更名而改写。预览不发微信、短信或系统消息，不生成日历文件。</p></form><article class="panel config-card"><p class="eyebrow">OBSERVATION / NO FABRICATED METRICS</p><h2>成熟队列与观察窗口</h2><p v-for="item in cohortSemantics" :key="item">{{ item }}</p><p class="config-notice">全站成熟队列来自 MbtiResult 首测；渠道时间归属仍不可得（channel_attribution_unavailable）。</p></article></div>
      <section class="panel config-card b4-cohorts"><h2>分渠道成熟队列</h2><p>首测渠道时间归属不可得；不从支付 provider、订单或 guest 数推算分渠道率。</p><div class="config-table-scroll"><table><thead><tr><th>渠道</th><th>满窗首测</th><th>同版复测</th><th>复测率 / 对比打开率</th></tr></thead><tbody><tr v-for="channel in ['微信小程序','小红书小程序','抖音小程序','公众号 H5']" :key="channel"><th scope="row">{{ channel }}</th><td>—</td><td>—</td><td>— / —</td></tr></tbody></table></div></section>
    </template>
    <template v-else>
      <form class="panel config-card b4-form" aria-label="交换与雷达编辑" @submit.prevent="applySocial"><div class="config-grid"><fieldset :disabled="!canEdit"><p class="eyebrow">CARD EXCHANGE</p><h2>交换名片规则</h2><label>推荐顺序<select v-model="socialBuffer.order" aria-label="推荐顺序" @change="emit('dirty', true)"><option value="same">相同 MBTI 优先</option><option value="recommend">共同兴趣优先</option></select></label><label>每人每日申请上限<input v-model.number="socialBuffer.daily" type="number" min="1" max="30" step="1" aria-label="每人每日申请上限" @input="emit('dirty', true)"></label><p>双方同意换卡后，微信 / QQ / 电话仍须分别授权。后台不能代替任何人同意；申请上限最终由服务端执行。</p></fieldset><fieldset :disabled="!canEdit"><p class="eyebrow">ANONYMOUS RADAR</p><h2>同型雷达</h2><label class="b4-consent"><input v-model="socialBuffer.radar" type="checkbox" aria-label="开放同型雷达" @change="emit('dirty', true)">开放雷达（仅预览）</label><label>默认半径<select v-model.number="socialBuffer.radius" aria-label="默认半径" @change="emit('dirty', true)"><option :value="500">500 米</option><option :value="1000">1 公里</option><option :value="3000">3 公里</option></select></label><label>匿名最低人数阈值<input v-model.number="socialBuffer.minimum" type="number" min="10" max="200" step="1" aria-label="匿名最低人数阈值" @input="emit('dirty', true)"></label><p>低于阈值只显示“人数较少”，返回 count: null；满足条件后仅按十人分桶。不读取 GPS，不画人员标记。</p></fieldset></div><button class="primary" :disabled="!canEdit">应用交换与雷达到内存预览</button><p class="config-notice">配置字段、推荐服务、每日限额、全局关停、匿名聚合与权限 UI_CONTRACT。当前 H5 服务只返回 unavailable / count: null；参与选择不等于位置授权。</p></form>
    </template>
    <p v-if="error" class="error-text b4-feedback" role="alert">{{ error }}</p><p v-if="notice" class="config-notice" role="status">{{ notice }}</p>
    <section v-if="preview" ref="previewPanel" class="panel config-card b4-preview" aria-label="匿名手机效果预览" tabindex="-1"><div class="config-card-head"><div><p class="eyebrow">PHONE PREVIEW / MEMORY ONLY</p><h2>手机效果 · 当前内存规则</h2></div><button class="outline-button" @click="preview = false">收起手机效果</button></div>
      <label v-if="page === 'social'">雷达呈现条件（虚构规则样例）<select v-model="scenario" aria-label="雷达呈现条件"><option value="unavailable">当前 H5：位置来源未接通</option><option value="below">低于匿名阈值</option><option value="bucket">达到阈值（虚构分桶样例）</option></select></label>
      <div class="config-phone"><header><b>MBTI搭子</b><small>本机预览 · 不发送请求</small></header><div class="config-phone-body">
        <template v-if="page === 'ai'"><p class="config-kicker">OFFLINE LOCAL SAMPLE</p><h2>{{ persona }}<em>离线双图试片</em></h2><img v-if="result" class="b4-phone-image" :src="result" alt="手机排版中的本机离线试片"><p v-else>暂无本机试片。先同意本地处理并选择两张图片。</p><p>非真实模型输出，未保存到名片。</p><button class="primary" disabled>生成 / 保存 / 分享 · 未接通</button></template>
        <template v-else-if="page === 'retention'"><p class="config-kicker">MY NEXT CHAPTER</p><h2>记录此刻的自己</h2><div class="config-actions"><span v-for="tag in lifecycle.tags" :key="tag" class="config-chip">{{ tag }}</span></div><p>阶段默认私密，分享时主动选择。</p><p>快捷回访：{{ lifecycle.days.join(' / ') }} 天</p><p>仍可自选日期；这是计划入口预览，没有个人历史或复测结果。</p><button class="primary" disabled>创建记录 / 设置提醒 · 未接通</button></template>
        <template v-else><p class="config-kicker">DISCOVER / ANONYMOUS</p><h2>交换名片</h2><p>{{ social.order === 'same' ? '相同 MBTI 优先' : '共同兴趣优先' }} · 每人每日最多 {{ social.daily }} 次申请</p><div class="b4-anonymous">匿名卡片占位 · 没有真实用户、类型或联系方式</div><button class="primary" disabled>发起申请 · 预览中不可发送</button><h3>同型雷达 / {{ social.radius }} 米</h3><div class="b4-radar" :data-status="radar.status"><strong>{{ radar.label }}</strong><small v-if="radar.status === 'bucket'">虚构条件分桶，仅展示规则，不代表查询人数</small><small v-else-if="radar.status === 'hidden'">与手机原型一致 · 隐藏人数 / count: null</small></div><p>主动加入、随时关闭；不展示任何人的位置或轨迹。无定位授权请求。</p></template>
      </div><footer>仅内存预览 · 不改 H5、配置、历史或消息</footer></div>
    </section>
  </section>
</template>
