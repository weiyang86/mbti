<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { channels, dateWindow, definitions, presetRange, shanghaiToday, type Period, type WorkspacePage } from './ops-workspace'
import './workspace.css'

const props = defineProps<{ page: WorkspacePage; canExport: boolean; canModerate: boolean }>()
const emit = defineEmits<{ navigate: [page: string] }>()
const period = ref<Period>('近 7 天')
const initial = presetRange('近 7 天')
const from = ref(initial.from)
const to = ref(initial.to)
const channel = ref('all')
const trend = ref('net')
const windowRange = computed(() => dateWindow(from.value, to.value))
const selectedChannels = computed(() => channels.filter(row => channel.value === 'all' || row.id === channel.value))
const selectedChannel = computed(() => channels.find(row => row.id === channel.value)?.label || '全部渠道')
const metrics = computed(() => props.page === 'overview'
  ? ['净实收', '支付订单', '测试完成率', '分享回流新客']
  : props.page === 'growth' ? ['访问人次（日内去重）', '成图预览人次', '预览后 7 日付费率', '可归因新访客']
    : ['互换申请', '名片同意率', '联系授权完成率', '待处理举报（全量）'])
const exportReason = computed(() => `${props.canExport ? '' : '当前会话未授予 mbti:ops:export；'}UI_CONTRACT：缺同筛选报表查询、CSV 导出及服务端授权端点。`)
const moderationReason = computed(() => `${props.canModerate ? '' : '当前会话未授予 mbti:ops:moderation:write；'}UI_CONTRACT：缺匿名工单读取、处置、幂等及审计端点。`)
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
onMounted(() => document.addEventListener('keydown', keydown, true))
onUnmounted(() => document.removeEventListener('keydown', keydown, true))
</script>

<template>
  <div class="workspace-page">
    <div class="ws-actions">
      <span class="ws-badge">UI_CONTRACT · 业务服务未接通</span>
      <div><button class="text-button" @click="openDrawer('definitions')">指标口径</button><button v-if="page !== 'moderation'" class="outline-button" disabled :title="exportReason">{{ page === 'overview' ? '导出报表' : '导出渠道表' }} · 未接通</button></div>
    </div>
    <section class="filter-panel ws-filters" aria-label="统计筛选">
      <div class="filter-controls">
        <div class="segmented" role="group" aria-label="统计周期"><button v-for="option in (['今日', '近 7 天', '近 30 天', '自定义'] as const)" :key="option" :class="{ selected: period === option }" :aria-pressed="period === option" @click="selectPeriod(option)">{{ option }}</button></div>
        <select v-model="channel" aria-label="统计渠道"><option value="all">全部渠道</option><option v-for="item in channels" :key="item.id" :value="item.id">{{ item.label }}</option></select>
        <template v-if="period === '自定义'"><label class="date-label">从<input v-model="from" type="date" :max="shanghaiToday()" aria-label="开始日期" :aria-invalid="!!windowRange.error" aria-describedby="workspace-window"></label><label class="date-label">至<input v-model="to" type="date" :max="shanghaiToday()" aria-label="结束日期" :aria-invalid="!!windowRange.error" aria-describedby="workspace-window"></label></template>
      </div>
      <p v-if="windowRange.error" id="workspace-window" class="error-text" role="alert">{{ windowRange.error }}</p>
      <p v-else id="workspace-window" class="ws-window" role="status">{{ from }} — {{ to }} · 北京时间 · {{ selectedChannel }}<span>前一等长周期 {{ windowRange.previousFrom }} — {{ windowRange.previousTo }}；筛选已选择，待服务接通后查询。</span></p>
    </section>
    <p class="ws-source-note">{{ page === 'moderation' ? '授权统计按所选周期；举报队列为全部日期。缺少匿名工单与授权汇总接口。' : '缺少统计查询与渠道归因来源；— 表示不可得，不表示 0。当前没有查询业务数据。' }}</p>
    <section class="metric-grid" aria-label="核心指标"><article v-for="title in metrics" :key="title" class="panel metric-card"><span>{{ title }}</span><b aria-label="数据不可得">—</b><small>{{ title.includes('举报') ? '全部日期 · 工单来源未接通' : '业务来源未接通' }}</small><small v-if="page === 'overview'">较前一等长周期 —</small></article></section>

    <template v-if="page === 'overview'">
      <div class="ws-grid ws-trend-grid">
        <section class="panel ws-panel"><div class="ws-panel-heading"><div><h2>经营趋势</h2><p>当前周期与上一等长周期对照</p></div><select v-model="trend" aria-label="趋势指标"><option value="net">净实收</option><option value="paid">支付订单</option><option value="visit">访问人次</option></select></div><div class="ws-chart-empty"><span class="ws-empty-mark">⌁</span><h3>暂无可查询的经营趋势</h3><p>缺少按日汇总与等长周期对照服务。</p></div><div class="ws-chart-footer"><span>● 所选周期 · ┄ 上一周期</span><button class="text-button" @click="openDrawer('definitions')">指标口径</button></div></section>
        <section class="panel ws-panel"><div class="ws-panel-heading"><div><h2>渠道收入构成</h2><p>各渠道扣除退款后的实收占比</p></div><span class="ws-badge">{{ channel === 'all' ? '4 渠道' : '单渠道' }}</span></div><div class="ws-donut"><small>净实收 / 元</small><strong>—</strong><small>退款事实与渠道未接通</small></div><div class="ws-channel-list"><div v-for="item in selectedChannels" :key="item.id"><span>{{ item.label }}</span><b>—</b></div></div></section>
      </div>
      <div class="ws-grid">
        <section class="panel ws-panel"><div class="ws-panel-heading"><div><h2>运营待办</h2><p>所有日期的待处理事项</p></div><span class="ws-badge">工作队列</span></div><div class="ws-todo"><div><b>生成异常</b><p>查看失败原因并重试交付</p></div><span>—</span><button class="outline-button" disabled title="UI_CONTRACT：缺生成任务队列查询及按异常筛选端点">查看队列 · 未接通</button></div><div class="ws-todo"><div><b>名片举报</b><p>审核公开内容与交换行为</p></div><span>—</span><button class="text-button" :disabled="!canModerate" :title="!canModerate ? '当前会话未授予名片治理页面能力' : undefined" @click="emit('navigate', 'moderation')">查看治理 →</button></div><div class="ws-todo"><div><b>待发布配置</b><p>核对草稿和当前生效版本</p></div><span>—</span><button class="text-button" @click="emit('navigate', 'release')">查看发布 →</button></div><p class="ws-inline-note">数量来源均未接通；页面跳转不会执行处理或发布。</p></section>
        <section class="panel ws-panel"><div class="ws-panel-heading"><div><h2>热门视觉模板</h2><p>按所选周期内有效交付数排序</p></div><button class="text-button" disabled title="UI_CONTRACT：模板标签、模板列表及管理 API 待接通">管理模板 →</button></div><div class="ws-chart-empty"><span class="ws-empty-mark">◇</span><h3>暂无可排序的模板交付数据</h3><p>缺少交付记录与交付时模板快照；权益解锁不代表作品已交付。</p></div></section>
      </div>
    </template>

    <template v-else-if="page === 'growth'">
      <div class="ws-grid"><section class="panel ws-panel"><div class="ws-panel-heading"><div><h2>测评完成</h2><p>同一批开始测试的人次</p></div></div><div v-for="label in ['开始测试', '完成 12 题']" :key="label" class="ws-flow"><span>{{ label }}</span><i aria-hidden="true"></i><b>—</b></div><p class="ws-inline-note">缺同批开始 / 完成的服务端聚合；不使用自选类型结果填充分子。</p></section><section class="panel ws-panel"><div class="ws-panel-heading"><div><h2>传播行为</h2><p>三项独立事件，不能视作连续漏斗</p></div></div><div v-for="label in ['保存成图', '调用分享', '回流新客']" :key="label" class="ws-flow"><span>{{ label }}</span><i aria-hidden="true"></i><b>—</b></div><p class="ws-inline-note">缺持久化传播事件与首次回流归因；生成图片不代表分享成功。</p></section></div>
      <section class="panel ws-table-panel"><div class="ws-panel-heading"><h2>渠道表现</h2><button class="text-button" @click="openDrawer('definitions')">查看口径</button></div><div class="ws-table-scroll" role="region" aria-label="渠道表现表，可横向滚动" tabindex="0"><table><thead><tr><th v-for="label in ['来源', '访问人次', '完成测试', '付费订单', '净实收', '回流新客']" :key="label" scope="col">{{ label }}</th></tr></thead><tbody><tr v-for="item in selectedChannels" :key="item.id"><th scope="row">{{ item.label }}</th><td v-for="index in 5" :key="index" aria-label="来源未接通">—</td></tr></tbody></table></div><p class="ws-table-note">渠道名称为固定入口标签。暂无线上数据，未查询记录，未将缺失计为零。</p></section>
      <p class="security-note">7 日付费率按首看预览样本分组，以观察满 7 天之日归入筛选周期；未成熟样本不参与。当前缺少首看事件及成熟队列，口径待导师确认。</p>
    </template>

    <template v-else>
      <section class="panel ws-table-panel"><div class="ws-panel-heading"><h2>举报队列</h2><span class="ws-badge">全部日期 · 匿名工单</span></div><div class="ws-table-scroll" role="region" aria-label="匿名举报队列表，可横向滚动" tabindex="0"><table><thead><tr><th v-for="label in ['工单', '对象', '举报类别', '状态', '操作']" :key="label" scope="col">{{ label }}</th></tr></thead><tbody></tbody></table></div><div class="ws-chart-empty ws-queue-empty"><span class="ws-empty-mark">◇</span><h3>匿名工单服务尚未接通</h3><p>没有可展示的工单；不生成演示举报，也不代表待处理数量为零。</p></div><div class="ws-table-note ws-moderation-actions"><p>{{ moderationReason }}</p><div><button class="outline-button" disabled :title="moderationReason">查看处理 · 未接通</button><button class="outline-button" disabled title="UI_CONTRACT：缺匿名处置记录读取端点">查看记录 · 未接通</button><button class="text-button" @click="openDrawer('case')">工单字段与处理说明</button></div></div></section>
      <p class="security-note">不提供聊天记录、电话、微信、QQ、精确位置或个人阶段作答。仅展示匿名工单与授权状态；所有处置等待服务端校验权限与记录审计。</p>
    </template>

    <div v-if="drawer" class="overlay" @click.self="closeDrawer"><section ref="dialog" class="dialog drawer ws-drawer" role="dialog" aria-modal="true" aria-labelledby="workspace-dialog-title"><div class="dialog-header"><div><p class="eyebrow">{{ drawer === 'definitions' ? 'METRIC DEFINITIONS' : 'ANONYMOUS MODERATION' }}</p><h2 id="workspace-dialog-title">{{ drawer === 'definitions' ? '数据统计口径' : '举报工单 · 接入说明' }}</h2></div><button ref="closeButton" class="icon-button" aria-label="关闭" @click="closeDrawer">×</button></div><div class="drawer-body">
      <template v-if="drawer === 'definitions'"><p class="ws-definition-note">原型口径与现存数据来源差距 · needs_human_review。以下是接入边界说明，尚未成为正式 API 契约；当前没有计算任何 KPI。</p><dl class="ws-definitions"><div v-for="item in definitions" :key="item.title"><dt>{{ item.title }}</dt><dd>{{ item.detail }}</dd></div></dl></template>
      <template v-else><p class="ws-definition-note">UI_CONTRACT · 当前没有选中的真实工单。缺匿名工单 ID、举报对象类型、公开内容摘要、举报类别、状态与可回查处置记录的服务端白名单接口。</p><dl class="ws-definitions"><div v-for="label in ['举报对象', '举报理由', '状态', '处理记录']" :key="label"><dt>{{ label }}</dt><dd>来源未接通</dd></div></dl><fieldset disabled class="ws-case-form"><legend>处理结论 · 服务未接通</legend><label>处理结论<select aria-label="处理结论"><option>限制该公开内容 / 交换行为</option><option>驳回本次举报</option></select></label><label>处理依据<textarea rows="3" maxlength="100" placeholder="等待匿名工单与处置接口接入"></textarea></label></fieldset><p class="ws-inline-note">{{ moderationReason }}需原子状态迁移、重复处理幂等和服务端审计，才能开放“记录处理结果”。</p></template>
    </div><div class="dialog-footer"><button class="outline-button" @click="closeDrawer">{{ drawer === 'definitions' ? '知道了' : '返回治理' }}</button><button v-if="drawer === 'case'" class="primary" disabled :title="moderationReason">记录处理结果 · 未接通</button></div></section></div>
  </div>
</template>
