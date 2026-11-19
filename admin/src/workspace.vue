<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  OpsApiError, disposeModerationCase, exportOrders, listModerationCases, readGrowthSummary, readOrderSummary, saveOrdersCsv,
  type GrowthSummary, type ModerationCaseRow,
} from './ops-api'
import type { OrderSummary } from './ops-orders-collection'
import { channels, dateWindow, definitions, presetRange, shanghaiToday, type Period, type WorkspacePage } from './ops-workspace'
import './workspace.css'

const props = defineProps<{ page: WorkspacePage; canExport: boolean; canModerate: boolean; canModerateRead: boolean }>()
const emit = defineEmits<{ navigate: [page: string]; reauthenticate: [] }>()
const period = ref<Period>('近 7 天')
const initial = presetRange('近 7 天')
const from = ref(initial.from)
const to = ref(initial.to)
const channel = ref('all')
const trend = ref('net')
const windowRange = computed(() => dateWindow(from.value, to.value))
const selectedChannels = computed(() => channels.filter(row => channel.value === 'all' || row.id === channel.value))
const selectedChannel = computed(() => channels.find(row => row.id === channel.value)?.label || '全部渠道')
const moderationMetrics = ['互换申请', '名片同意率', '联系授权完成率', '待处理举报（全量）'] as const
const summary = ref<OrderSummary | null>(null)
const summaryState = ref<'idle' | 'loading' | 'success' | 'error' | 'unauthenticated'>('idle')
const summaryError = ref('')
const growth = ref<GrowthSummary | null>(null)
const growthState = ref<'idle' | 'loading' | 'success' | 'error' | 'unauthenticated'>('idle')
const growthError = ref('')
const cases = ref<ModerationCaseRow[]>([])
const caseState = ref<'idle' | 'loading' | 'success' | 'error' | 'unauthenticated'>('idle')
const caseError = ref('')
const selectedCase = ref<ModerationCaseRow | null>(null)
const disposeDecision = ref('restrict')
const disposeNote = ref('')
const disposeState = ref<'idle' | 'loading' | 'success' | 'error'>('idle')
const disposeError = ref('')
const exportState = ref<'idle' | 'loading' | 'success' | 'error'>('idle')
const exportError = ref('')
let summaryVersion = 0, growthVersion = 0, caseVersion = 0, disposeVersion = 0, exportVersion = 0
const canExportOverview = computed(() => props.page === 'overview' && props.canExport && !windowRange.value.error && channel.value === 'all')
const exportReason = computed(() => {
  if (props.page === 'growth') return `${props.canExport ? '' : '当前会话未授予 mbti:ops:export；'}渠道事件表可读汇总，但同筛选 CSV 导出端点仍未接通。`
  if (!props.canExport) return '当前会话未授予 mbti:ops:export；服务端仍会拒绝无权限导出。'
  if (windowRange.value.error) return windowRange.value.error
  if (channel.value !== 'all') return '渠道归因不可得；订单报表仅支持「全部渠道」，不会把未归因订单导出为单渠道。'
  return '导出当前日期范围内的订单白名单 CSV（与列表/export 同筛选语义，最多5000笔）；不含净实收或渠道列。'
})
const moderationReason = computed(() => {
  if (!props.canModerateRead) return '当前会话未授予 mbti:ops:moderation:read；无法读取匿名工单。'
  if (!props.canModerate) return '当前会话可只读工单；处置需 mbti:ops:moderation:write。'
  return '处置将写入服务端审计；仅 open → closed，重复同结论幂等。'
})
const drawer = ref<'' | 'definitions' | 'case'>('')
const dialog = ref<HTMLElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
let returnFocus: HTMLElement | null = null

function selectPeriod(value: Period) {
  period.value = value
  if (value !== '自定义') {
    const range = presetRange(value)
    from.value = range.from; to.value = range.to
  }
}
function summaryMessage(error: unknown) {
  const status = error instanceof OpsApiError ? error.status : 0
  return status === 401 ? '登录已失效，请重新核验登录。' : status === 403 ? '服务端拒绝订单汇总读取，请核对 mbti:orders:read。'
    : status === 422 ? '日期或渠道筛选无效；订单 KPI 使用 UTC 自然日，范围最多 366 天。'
      : status >= 500 ? '订单汇总服务暂不可用，请重试。' : error instanceof OpsApiError ? error.message : '订单汇总请求失败，请重试。'
}
async function loadSummary() {
  const current = ++summaryVersion
  summary.value = null; summaryError.value = ''
  if (props.page !== 'overview') { summaryState.value = 'idle'; return }
  if (windowRange.value.error) { summaryState.value = 'idle'; return }
  summaryState.value = 'loading'
  try {
    const result = await readOrderSummary(from.value, to.value, channel.value)
    if (current !== summaryVersion) return
    summary.value = result; summaryState.value = 'success'
  } catch (error) {
    if (current !== summaryVersion) return
    summaryState.value = error instanceof OpsApiError && error.status === 401 ? 'unauthenticated' : 'error'
    summaryError.value = summaryMessage(error)
  }
}
const overviewCards = computed(() => {
  const metrics = summary.value?.metrics
  const channelBlocked = summary.value?.unavailableReason === 'channel_attribution_unavailable'
  const pendingNote = summaryState.value === 'loading' ? '正在读取订单汇总'
    : summaryState.value === 'error' || summaryState.value === 'unauthenticated' ? summaryError.value
      : windowRange.value.error ? windowRange.value.error
        : channelBlocked ? '渠道归因不可得；未把未归因订单计为该渠道'
          : metrics ? '按订单创建日（UTC）计数' : '业务来源未接通'
  const fen = metrics?.grossPaidAmountFen
  const net = summary.value?.netCollectedFen
  const netNote = summary.value?.refundsUnavailable ? '无已入账退款交易事实；净额不可得，不等于毛额'
    : net === null ? '多币种或退款币种不一致；净额合计不可得' : '毛额 − 已入账退款交易（分）'
  return [
    { title: '净实收', value: net === null || net === undefined ? null : `${net} 分`, note: netNote },
    { title: '已支付订单', value: metrics ? String(metrics.paid) : null, note: pendingNote },
    { title: '待支付订单', value: metrics ? String(metrics.pending) : null, note: pendingNote },
    { title: '支付失败', value: metrics ? String(metrics.failed) : null, note: pendingNote },
    { title: '已支付毛额', value: metrics && fen !== null && metrics.currency ? `${fen} 分 · ${metrics.currency}` : null,
      note: metrics && fen === null ? '多币种并存，合计不可得；仅展示分币种事实时需另查列表' : pendingNote },
  ]
})
function growthCount(eventType: string) {
  const rows = growth.value?.metrics?.by_channel_event || []
  return rows.filter(row => row.event_type === eventType).reduce((sum, row) => sum + row.count, 0)
}
const growthCards = computed(() => {
  const unavailable = growth.value?.unavailableReason === 'growth_events_unavailable' || !growth.value?.metrics
  const note = growthState.value === 'loading' ? '正在读取渠道事件'
    : growthState.value === 'error' || growthState.value === 'unauthenticated' ? growthError.value
      : windowRange.value.error ? windowRange.value.error
        : unavailable ? '无访问/预览/分享事件；— 不表示 0' : '事件行计数，非去重用户'
  return [
    { title: '访问人次（日内去重）', value: unavailable ? null : String(growthCount('visit')), note },
    { title: '成图预览人次', value: unavailable ? null : String(growthCount('preview')), note },
    { title: '预览后 7 日付费率', value: null as string | null, note: '成熟队列衍生率仍不可得' },
    { title: '可归因新访客', value: unavailable ? null : String(growthCount('attributed_return')), note },
  ]
})
async function loadGrowth() {
  const current = ++growthVersion
  growth.value = null; growthError.value = ''
  if (props.page !== 'growth') { growthState.value = 'idle'; return }
  if (windowRange.value.error) { growthState.value = 'idle'; return }
  growthState.value = 'loading'
  try {
    const result = await readGrowthSummary(from.value, to.value, channel.value)
    if (current !== growthVersion) return
    growth.value = result; growthState.value = 'success'
  } catch (error) {
    if (current !== growthVersion) return
    growthState.value = error instanceof OpsApiError && error.status === 401 ? 'unauthenticated' : 'error'
    growthError.value = error instanceof OpsApiError ? error.message : '渠道汇总请求失败'
  }
}
async function loadCases() {
  const current = ++caseVersion
  cases.value = []; caseError.value = ''; selectedCase.value = null
  if (props.page !== 'moderation') { caseState.value = 'idle'; return }
  if (!props.canModerateRead) { caseState.value = 'idle'; return }
  caseState.value = 'loading'
  try {
    const rows = await listModerationCases({ case_status: 'open', limit: '50' })
    if (current !== caseVersion) return
    cases.value = rows; caseState.value = 'success'
  } catch (error) {
    if (current !== caseVersion) return
    caseState.value = error instanceof OpsApiError && error.status === 401 ? 'unauthenticated' : 'error'
    caseError.value = error instanceof OpsApiError ? error.message : '匿名工单请求失败'
  }
}
async function openCase(row: ModerationCaseRow) {
  selectedCase.value = row
  disposeDecision.value = 'restrict'
  disposeNote.value = ''
  disposeState.value = 'idle'
  disposeError.value = ''
  await openDrawer('case')
}
async function submitDispose() {
  if (!selectedCase.value || !props.canModerate || disposeState.value === 'loading') return
  const current = ++disposeVersion
  disposeState.value = 'loading'; disposeError.value = ''
  try {
    const next = await disposeModerationCase(selectedCase.value.id, {
      decision: disposeDecision.value, note: disposeNote.value.trim() || undefined,
    })
    if (current !== disposeVersion) return
    selectedCase.value = next; disposeState.value = 'success'
    await loadCases()
  } catch (error) {
    if (current !== disposeVersion) return
    disposeState.value = 'error'
    disposeError.value = error instanceof OpsApiError ? error.message : '处置失败'
  }
}
async function downloadOverviewCsv() {
  if (!canExportOverview.value || exportState.value === 'loading') return
  const current = ++exportVersion
  exportState.value = 'loading'; exportError.value = ''
  try {
    // Same durable order collection as /orders export; date window only, no channel invention.
    const csv = await exportOrders({ from: from.value, to: to.value })
    if (current !== exportVersion || !canExportOverview.value) return
    saveOrdersCsv(csv, `mbti-orders-${from.value}_${to.value}.csv`)
    exportState.value = 'success'
  } catch (error) {
    if (current !== exportVersion) return
    const status = error instanceof OpsApiError ? error.status : 0
    exportState.value = 'error'
    exportError.value = status === 401 ? '登录已失效，请重新核验登录。' : status === 403 ? '服务端拒绝导出，请核对 mbti:ops:access 与 mbti:ops:export。'
      : status === 422 ? '日期无效或导出超过5000笔；请缩小范围后重试。'
        : status >= 500 ? '订单导出服务暂不可用，请重试。' : error instanceof OpsApiError ? error.message : '订单导出失败，请重试。'
  }
}
async function openDrawer(value: 'definitions' | 'case') {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  drawer.value = value
  await nextTick(); closeButton.value?.focus()
}
function closeDrawer() { drawer.value = ''; returnFocus?.focus() }
function keydown(event: KeyboardEvent) {
  if (!drawer.value) return
  if (event.key === 'Escape') { event.stopPropagation(); closeDrawer() }
  if (event.key === 'Tab') {
    const elements = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || [])]
    const first = elements[0], last = elements.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
}
watch([() => props.page, from, to, channel], () => {
  exportVersion++; exportState.value = 'idle'; exportError.value = ''
  loadSummary(); loadGrowth(); loadCases()
}, { flush: 'post' })
watch(() => props.canExport, () => { exportVersion++; exportState.value = 'idle'; exportError.value = '' })
watch(() => props.canModerateRead, () => { loadCases() })
onMounted(() => { document.addEventListener('keydown', keydown, true); loadSummary(); loadGrowth(); loadCases() })
onUnmounted(() => { summaryVersion++; growthVersion++; caseVersion++; exportVersion++; document.removeEventListener('keydown', keydown, true) })
</script>

<template>
  <div class="workspace-page">
    <div class="ws-actions">
      <span class="ws-badge">{{ page === 'overview' ? '订单 KPI / 净实收条件可得' : page === 'growth' ? '渠道事件汇总 · CSV 仍未接通' : '匿名工单候选' }}</span>
      <div>
        <button class="text-button" @click="openDrawer('definitions')">指标口径</button>
        <button v-if="page === 'overview'" class="outline-button" :disabled="!canExportOverview || exportState === 'loading'" :title="exportReason" @click="downloadOverviewCsv">{{ exportState === 'loading' ? '导出中…' : '导出报表 CSV' }}</button>
        <button v-else-if="page === 'growth'" class="outline-button" disabled :title="exportReason">导出渠道表 · 未接通</button>
      </div>
    </div>
    <p v-if="page === 'overview' && exportError" class="error-text" role="alert">{{ exportError }} <button v-if="exportError.includes('登录已失效')" class="text-button" @click="emit('reauthenticate')">重新核验登录</button><button v-else class="text-button" @click="downloadOverviewCsv">重试导出</button></p>
    <p v-else-if="page === 'overview' && exportState === 'success'" class="ws-window" role="status">订单 CSV 已交给浏览器下载（白名单字段，非净实收报表）。</p>
    <section class="filter-panel ws-filters" aria-label="统计筛选">
      <div class="filter-controls">
        <div class="segmented" role="group" aria-label="统计周期"><button v-for="option in (['今日', '近 7 天', '近 30 天', '自定义'] as const)" :key="option" :class="{ selected: period === option }" :aria-pressed="period === option" @click="selectPeriod(option)">{{ option }}</button></div>
        <select v-model="channel" aria-label="统计渠道"><option value="all">全部渠道</option><option v-for="item in channels" :key="item.id" :value="item.id">{{ item.label }}</option></select>
        <template v-if="period === '自定义'"><label class="date-label">从<input v-model="from" type="date" :max="shanghaiToday()" aria-label="开始日期" :aria-invalid="!!windowRange.error" aria-describedby="workspace-window"></label><label class="date-label">至<input v-model="to" type="date" :max="shanghaiToday()" aria-label="结束日期" :aria-invalid="!!windowRange.error" aria-describedby="workspace-window"></label></template>
      </div>
      <p v-if="windowRange.error" id="workspace-window" class="error-text" role="alert">{{ windowRange.error }}</p>
      <p v-else id="workspace-window" class="ws-window" role="status">{{ from }} — {{ to }} · 北京时间选择 · {{ selectedChannel }}<span>前一等长周期 {{ windowRange.previousFrom }} — {{ windowRange.previousTo }}；{{ page === 'overview' ? '订单 KPI 按 UTC 自然日查询。' : page === 'growth' ? '渠道事件按 dayKey 查询；空表不可得。' : '授权统计按所选周期；举报队列为全部日期。' }}</span></p>
    </section>
    <p class="ws-source-note">{{ page === 'moderation' ? '授权汇总仍不可得；举报队列来自独立匿名工单表，不读 guest 社交。' : page === 'overview' ? '订单 pending/paid/failed/毛额来自 /orders/summary；净实收仅在存在已入账退款交易时计算；渠道归因仍不可得。' : '渠道事件来自 MbtiGrowthEvent；空表显示 — 不表示 0；不从支付 provider 推断渠道。' }}</p>

    <template v-if="page === 'overview'">
      <p v-if="summaryError" class="error-text" role="alert">{{ summaryError }} <button v-if="summaryState === 'unauthenticated'" class="text-button" @click="emit('reauthenticate')">重新核验登录</button><button v-else class="text-button" @click="loadSummary">重试汇总</button></p>
      <section class="metric-grid" aria-label="核心指标" :aria-busy="summaryState === 'loading'">
        <article v-for="card in overviewCards" :key="card.title" class="panel metric-card">
          <span>{{ card.title }}</span>
          <b :aria-label="card.value === null ? '数据不可得' : undefined">{{ card.value ?? '—' }}</b>
          <small>{{ card.note }}</small>
          <small>较前一等长周期 —</small>
        </article>
      </section>
      <div class="ws-grid ws-trend-grid">
        <section class="panel ws-panel"><div class="ws-panel-heading"><div><h2>经营趋势</h2><p>当前周期与上一等长周期对照</p></div><select v-model="trend" aria-label="趋势指标"><option value="net">净实收</option><option value="paid">支付订单</option><option value="visit">访问人次</option></select></div><div class="ws-chart-empty"><span class="ws-empty-mark">⌁</span><h3>暂无可查询的经营趋势</h3><p>缺少按日汇总与等长周期对照服务。</p></div><div class="ws-chart-footer"><span>● 所选周期 · ┄ 上一周期</span><button class="text-button" @click="openDrawer('definitions')">指标口径</button></div></section>
        <section class="panel ws-panel"><div class="ws-panel-heading"><div><h2>渠道收入构成</h2><p>各渠道扣除退款后的实收占比</p></div><span class="ws-badge">{{ channel === 'all' ? '4 渠道' : '单渠道' }}</span></div><div class="ws-donut"><small>净实收 / 元</small><strong>—</strong><small>退款事实与渠道未接通</small></div><div class="ws-channel-list"><div v-for="item in selectedChannels" :key="item.id"><span>{{ item.label }}</span><b>—</b></div></div></section>
      </div>
      <div class="ws-grid">
        <section class="panel ws-panel"><div class="ws-panel-heading"><div><h2>运营待办</h2><p>所有日期的待处理事项</p></div><span class="ws-badge">工作队列</span></div><div class="ws-todo"><div><b>生成异常</b><p>查看失败原因并重试交付</p></div><span>—</span><button class="outline-button" @click="emit('navigate', 'orders')">查看生成任务 →</button></div><div class="ws-todo"><div><b>名片举报</b><p>审核公开内容与交换行为</p></div><span>—</span><button class="text-button" :disabled="!canModerateRead" :title="!canModerateRead ? '当前会话未授予匿名工单只读能力' : undefined" @click="emit('navigate', 'moderation')">查看治理 →</button></div><div class="ws-todo"><div><b>待发布配置</b><p>核对草稿和当前生效版本</p></div><span>—</span><button class="text-button" @click="emit('navigate', 'release')">查看发布 →</button></div><p class="ws-inline-note">待办数量仍不聚合；生成任务与治理已可导航到对应页面。</p></section>
        <section class="panel ws-panel"><div class="ws-panel-heading"><div><h2>热门视觉模板</h2><p>按所选周期内有效交付数排序</p></div><button class="text-button" disabled title="UI_CONTRACT：模板标签、模板列表及管理 API 待接通">管理模板 →</button></div><div class="ws-chart-empty"><span class="ws-empty-mark">◇</span><h3>暂无可排序的模板交付数据</h3><p>缺少交付记录与交付时模板快照；权益解锁不代表作品已交付。</p></div></section>
      </div>
    </template>

    <template v-else-if="page === 'growth'">
      <p v-if="growthError" class="error-text" role="alert">{{ growthError }} <button v-if="growthState === 'unauthenticated'" class="text-button" @click="emit('reauthenticate')">重新核验登录</button><button v-else class="text-button" @click="loadGrowth">重试汇总</button></p>
      <section class="metric-grid" aria-label="核心指标" :aria-busy="growthState === 'loading'">
        <article v-for="card in growthCards" :key="card.title" class="panel metric-card">
          <span>{{ card.title }}</span>
          <b :aria-label="card.value === null ? '数据不可得' : undefined">{{ card.value ?? '—' }}</b>
          <small>{{ card.note }}</small>
        </article>
      </section>
      <div class="ws-grid"><section class="panel ws-panel"><div class="ws-panel-heading"><div><h2>测评完成</h2><p>同一批开始测试的人次</p></div></div><div v-for="label in ['开始测试', '完成 12 题']" :key="label" class="ws-flow"><span>{{ label }}</span><i aria-hidden="true"></i><b>—</b></div><p class="ws-inline-note">缺同批开始 / 完成的服务端聚合；不使用自选类型结果填充分子。</p></section><section class="panel ws-panel"><div class="ws-panel-heading"><div><h2>传播行为</h2><p>三项独立事件，不能视作连续漏斗</p></div></div><div class="ws-flow"><span>保存成图</span><i aria-hidden="true"></i><b>{{ growth?.metrics ? growthCount('preview') : '—' }}</b></div><div class="ws-flow"><span>调用分享</span><i aria-hidden="true"></i><b>{{ growth?.metrics ? growthCount('share_invoke') : '—' }}</b></div><div class="ws-flow"><span>回流新客</span><i aria-hidden="true"></i><b>{{ growth?.metrics ? growthCount('attributed_return') : '—' }}</b></div><p class="ws-inline-note">事件行计数；空表不可得。生成图片不代表分享成功。</p></section></div>
      <section class="panel ws-table-panel"><div class="ws-panel-heading"><h2>渠道表现</h2><button class="text-button" @click="openDrawer('definitions')">查看口径</button></div><div class="ws-table-scroll" role="region" aria-label="渠道表现表，可横向滚动" tabindex="0"><table><thead><tr><th v-for="label in ['来源', '访问人次', '完成测试', '付费订单', '净实收', '回流新客']" :key="label" scope="col">{{ label }}</th></tr></thead><tbody><tr v-for="item in selectedChannels" :key="item.id"><th scope="row">{{ item.label }}</th><td>{{ growth?.metrics ? growth.metrics.by_channel_event.filter(row => row.channel === item.id && row.event_type === 'visit').reduce((s, r) => s + r.count, 0) : '—' }}</td><td aria-label="完成测试不可得">—</td><td aria-label="付费订单渠道不可得">—</td><td aria-label="净实收渠道不可得">—</td><td>{{ growth?.metrics ? growth.metrics.by_channel_event.filter(row => row.channel === item.id && row.event_type === 'attributed_return').reduce((s, r) => s + r.count, 0) : '—' }}</td></tr></tbody></table></div><p class="ws-table-note">访问/回流来自事件表；完成测试/付费/净实收仍无渠道归因，保持 —。</p></section>
      <p class="security-note">7 日付费率仍缺成熟队列衍生定义。空事件表不会用订单或 guest 数冒充。</p>
    </template>

    <template v-else>
      <section class="metric-grid" aria-label="核心指标"><article v-for="title in moderationMetrics" :key="title" class="panel metric-card"><span>{{ title }}</span><b aria-label="数据不可得">{{ title.includes('举报') && caseState === 'success' ? String(cases.length) : '—' }}</b><small>{{ title.includes('举报') ? (canModerateRead ? '全部日期 · open 工单数' : '全部日期 · 缺 moderation:read') : '授权汇总未接通' }}</small></article></section>
      <section class="panel ws-table-panel"><div class="ws-panel-heading"><h2>举报队列</h2><span class="ws-badge">全部日期 · 匿名工单</span></div>
        <p v-if="caseError" class="error-text" role="alert">{{ caseError }} <button v-if="caseState === 'unauthenticated'" class="text-button" @click="emit('reauthenticate')">重新核验登录</button><button v-else class="text-button" @click="loadCases">重试</button></p>
        <div class="ws-table-scroll" role="region" aria-label="匿名举报队列表，可横向滚动" tabindex="0"><table><thead><tr><th v-for="label in ['工单', '对象', '举报类别', '状态', '操作']" :key="label" scope="col">{{ label }}</th></tr></thead><tbody>
          <tr v-for="row in cases" :key="row.id"><td class="order-mono">{{ row.id }}</td><td>{{ row.subject_type }} · {{ row.subject_ref }}</td><td>{{ row.reason_code }}</td><td>{{ row.case_status }}</td><td><button class="text-button" @click="openCase(row)">查看处理</button></td></tr>
        </tbody></table></div>
        <div v-if="!canModerateRead" class="ws-chart-empty ws-queue-empty"><span class="ws-empty-mark">◇</span><h3>缺少匿名工单只读权限</h3><p>需要 mbti:ops:moderation:read；不会用 guest 社交列表冒充。</p></div>
        <div v-else-if="caseState === 'success' && cases.length === 0" class="ws-chart-empty ws-queue-empty"><span class="ws-empty-mark">◇</span><h3>当前没有 open 工单</h3><p>空队列表示暂无待处理匿名工单，不是演示数据。</p></div>
        <div class="ws-table-note ws-moderation-actions"><p>{{ moderationReason }}</p><div><button class="outline-button" :disabled="!selectedCase" :title="moderationReason" @click="selectedCase && openCase(selectedCase)">查看处理</button><button class="outline-button" disabled title="历史处置记录另表尚未接通">查看记录 · 未接通</button><button class="text-button" @click="openDrawer('case')">工单字段与处理说明</button></div></div></section>
      <p class="security-note">不提供聊天记录、电话、微信、QQ、精确位置或个人阶段作答。仅展示匿名工单白名单字段。</p>
    </template>

    <div v-if="drawer" class="overlay" @click.self="closeDrawer"><section ref="dialog" class="dialog drawer ws-drawer" role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title"><div class="dialog-header"><div><p class="eyebrow">{{ drawer === 'definitions' ? 'METRIC DEFINITIONS' : 'ANONYMOUS MODERATION' }}</p><h2 id="workspace-dialog-title">{{ drawer === 'definitions' ? '数据统计口径' : '举报工单 · 接入说明' }}</h2></div><button ref="closeButton" class="icon-button" aria-label="关闭" @click="closeDrawer">×</button></div><div class="drawer-body">
      <template v-if="drawer === 'definitions'"><p class="ws-definition-note">原型口径与现存数据来源差距 · needs_human_review。以下是接入边界说明，尚未成为正式 API 契约；当前没有计算任何 KPI。</p><dl class="ws-definitions"><div v-for="item in definitions" :key="item.title"><dt>{{ item.title }}</dt><dd>{{ item.detail }}</dd></div></dl></template>
      <template v-else>
        <p v-if="!selectedCase" class="ws-definition-note">选择队列中的工单后可处置。字段白名单：对象类型/引用、类别、状态；无联系方式与作答。</p>
        <template v-else>
          <dl class="ws-definitions">
            <div><dt>举报对象</dt><dd>{{ selectedCase.subject_type }} · {{ selectedCase.subject_ref }}</dd></div>
            <div><dt>举报理由</dt><dd>{{ selectedCase.reason_code }}</dd></div>
            <div><dt>状态</dt><dd>{{ selectedCase.case_status }}{{ selectedCase.decision ? ` · ${selectedCase.decision}` : '' }}</dd></div>
            <div><dt>处理记录</dt><dd>{{ selectedCase.note || (selectedCase.case_status === 'closed' ? '已关闭' : '待处置') }}</dd></div>
          </dl>
          <fieldset class="ws-case-form" :disabled="!canModerate || selectedCase.case_status === 'closed' || disposeState === 'loading'"><legend>处理结论</legend>
            <label>处理结论<select v-model="disposeDecision" aria-label="处理结论"><option value="restrict">限制该公开内容 / 交换行为</option><option value="dismiss">驳回本次举报</option></select></label>
            <label>处理依据<textarea v-model="disposeNote" rows="3" maxlength="100" placeholder="可选说明（≤100 字）"></textarea></label>
          </fieldset>
          <p v-if="disposeState === 'success'" class="ws-inline-note" role="status">已记录处置结果。</p>
          <p v-else-if="disposeState === 'error'" class="error-text" role="alert">{{ disposeError }}</p>
          <p class="ws-inline-note">{{ moderationReason }}</p>
        </template>
      </template>
    </div><div class="dialog-footer"><button class="outline-button" @click="closeDrawer">{{ drawer === 'definitions' ? '知道了' : '返回治理' }}</button><button v-if="drawer === 'case'" class="primary" :disabled="!selectedCase || !canModerate || selectedCase.case_status === 'closed' || disposeState === 'loading'" :title="moderationReason" @click="submitDispose">{{ disposeState === 'loading' ? '提交中…' : '记录处理结果' }}</button></div></section></div>
  </div>
</template>
