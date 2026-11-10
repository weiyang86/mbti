<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { b5Unknowns, unavailableB5Consumer, type B5Scope } from './b5-contract'
import { changed, channelKeys, channels, fixedInstruction, initialAI, initialPayment, initialTrade, localDifferences, scenarios, simulateCallback, sizes, validateAI, validatePayment, validateTrade, type PaymentChannel, type Scenario } from './b5-model'
import './b5.css'

const props = defineProps<{ page: B5Scope; canEdit: boolean; canRelease: boolean; canOpenStudio: boolean }>()
const emit = defineEmits<{ dirty: [value: boolean]; navigate: [page: string] }>()
const ai = ref(initialAI()), payment = ref(initialPayment()), trade = ref(initialTrade())
const channel = ref<PaymentChannel>('wechat'), tab = ref('versions'), note = ref('')
const drawer = ref(''), pending = ref<{ kind: 'channel' | 'tab'; value: string } | null>(null)
const issues = ref<string[]>([]), feedback = ref(''), sourceState = ref<'unavailable' | 'loading' | 'error'>('unavailable')
const previewView = ref('draft'), scenario = ref<Scenario>('paid'), simulation = ref<ReturnType<typeof simulateCallback> | null>(null)
const consumer = unavailableB5Consumer()
const meta = computed(() => channels[channel.value])
const dirty = computed(() => props.page === 'release' ? props.canRelease && note.value.length > 0 : props.canEdit && (props.page === 'ai-settings' ? changed(ai.value, initialAI()) : props.page === 'payment-settings' ? changed(payment.value, initialPayment()) : changed(trade.value, initialTrade())))
const differences = computed(() => props.page === 'ai-settings' ? localDifferences(initialAI(), ai.value) : props.page === 'payment-settings' ? localDifferences(initialPayment(), payment.value) : props.page === 'trade-settings' ? localDifferences(initialTrade(), trade.value) : [])
const fieldNames: Record<string, string> = { mode: '运行方式', size: '输出画幅', timeout: '最长等待秒数', enabled: '允许本渠道新下单', merchantLabel: '收款方展示名', ttl: '付款时限（分钟）', redeem: '允许体验码兑换', selfRefund: '售后处理方式', refundDays: '自助售后期限（天）' }
watch(dirty, value => emit('dirty', value), { immediate: true })
function reset() { ai.value = initialAI(); payment.value = initialPayment(); trade.value = initialTrade(); note.value = ''; issues.value = []; feedback.value = ''; simulation.value = null }
watch(() => props.canEdit, allowed => { if (!allowed) { reset(); drawer.value = ''; pending.value = null } })
watch(() => props.canRelease, allowed => { if (!allowed) note.value = '' })
watch(() => props.page, () => { reset(); drawer.value = ''; pending.value = null; channel.value = 'wechat'; tab.value = 'versions'; sourceState.value = 'unavailable' })
function switchSelection(kind: 'channel' | 'tab', value: string) {
  if (kind === 'channel' ? value === channel.value : value === tab.value) return
  if (dirty.value) { pending.value = { kind, value }; open('切换确认'); return }
  applySelection(kind, value)
}
function applySelection(kind: 'channel' | 'tab', value: string) {
  if (kind === 'channel' && channelKeys.includes(value as PaymentChannel)) { channel.value = value as PaymentChannel; payment.value = initialPayment(); simulation.value = null }
  if (kind === 'tab' && ['versions', 'diff', 'audit'].includes(value)) tab.value = value
  issues.value = []; feedback.value = ''; pending.value = null
}
function discardSwitch() {
  if (!pending.value) return
  const target = pending.value
  reset(); drawer.value = ''; applySelection(target.kind, target.value)
}
function check() {
  if (!props.canEdit) return
  issues.value = props.page === 'ai-settings' ? validateAI(ai.value) : props.page === 'payment-settings' ? validatePayment(payment.value) : validateTrade(trade.value)
  feedback.value = issues.value.length ? '' : '本机预览格式检查通过；未验证凭据、商户归属、真实连接或生效规则。'
}
function tradePreview() { if (props.canEdit) check(); if (!issues.value.length) open('交易规则效果预览') }
async function stateDemo(state: 'loading' | 'error') {
  // Explicit UI-state rehearsal, never a configuration read or retry request.
  sourceState.value = state
  await nextTick()
}
function runSimulation() { if (props.canEdit) simulation.value = simulateCallback(scenario.value) }
function close() { drawer.value = ''; pending.value = null }
let opener: HTMLElement | null = null
function open(title: string) { opener = document.activeElement as HTMLElement | null; drawer.value = title }
watch(drawer, async title => {
  await nextTick()
  if (title) document.querySelector<HTMLElement>('.b5-dialog')?.focus()
  else opener?.focus()
})
function onKey(event: KeyboardEvent) {
  if (!drawer.value) return
  if (event.key === 'Escape') { event.stopImmediatePropagation(); close() }
  if (event.key === 'Tab') {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('.b5-dialog button:not(:disabled), .b5-dialog input:not(:disabled), .b5-dialog select:not(:disabled), .b5-dialog textarea:not(:disabled), .b5-dialog [tabindex="0"]'))
    if (!elements.length) return
    const first = elements[0]!, last = elements[elements.length - 1]!
    if (event.shiftKey && (document.activeElement === first || document.activeElement?.classList.contains('b5-dialog'))) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onUnmounted(() => { window.removeEventListener('keydown', onKey, true); emit('dirty', false) })
defineExpose({ openPreview: () => open('配置投影预览') })
</script>

<template>
  <div class="b5-page">
    <div class="b5-context" role="status"><div><b>UI_CONTRACT</b><span>{{ canEdit ? '系统参数 · 本机预览可编辑' : '受限只读视图' }}</span></div><span>{{ dirty ? '有未保存输入 · 仅当前页内存' : '原型参考 · 非线上配置' }}</span></div>
    <p class="b5-boundary">C2 配置服务未接通。读取、保存、发布及回滚均不可用；离开页面会丢弃本机输入。服务端授权与持久化验收：NOT_RUN。</p>
    <div class="b5-toolbar"><button class="outline-button" @click="open('本机输入差异')">本机输入差异</button><button class="outline-button" @click="open('配置投影预览')">草稿 / 线上预览</button><button class="outline-button" @click="open('权限与接入边界')">权限与接入边界</button></div>

    <template v-if="page === 'ai-settings'">
      <section class="b5-ribbon" aria-label="真实 AI 状态"><div v-for="label in ['供应商适配器', '模型', '业务网关', '健康状态']" :key="label"><span>{{ label }}</span><b>UNCONFIGURED</b></div></section>
      <div class="b5-grid"><section class="panel b5-card"><p class="eyebrow">CONNECTION / 连接</p><h2>生成图片用哪个接口？</h2><p>本机演示与真实网关预案分开呈现。真实配置须由服务端核实后返回。</p>
        <form class="b5-form" aria-label="AI 参数预览" @submit.prevent="check"><fieldset :disabled="!canEdit"><div class="b5-fields">
          <label>运行模式<select v-model="ai.mode" aria-label="运行模式"><option value="mock">本机演示 · 不联网、不计费</option><option value="gateway">真实网关预案 · UNCONFIGURED</option></select></label>
          <label>供应商适配器<select disabled aria-label="供应商适配器"><option>UNCONFIGURED</option></select><small>原型支持万相 / 自有双图网关；尚无已核实来源。</small></label>
          <label>模型 ID<input disabled value="UNCONFIGURED" maxlength="64" aria-label="模型 ID"></label>
          <label>业务网关路径（同源）<input disabled value="UNCONFIGURED" maxlength="108" aria-label="业务网关路径（同源）"><small>后续仅接受同源 /api/ 路径；当前不探测。</small></label>
          <label>输出画幅<select v-model="ai.size" aria-label="输出画幅"><option v-for="(size, index) in sizes" :key="size" :value="size">{{ ['3:4 · 朋友圈', '1:1 · 头像', '9:16 · 竖屏'][index] }} · {{ size }}</option></select></label>
          <label>最长等待秒数<input v-model.number="ai.timeout" type="number" min="20" max="180" step="1" aria-label="最长等待秒数" :aria-invalid="issues.length > 0 ? true : undefined"></label>
          <label class="b5-full">全局生成指令<textarea :value="fixedInstruction" disabled maxlength="450" rows="4" aria-label="全局生成指令"></textarea><small>固定无个人信息的排版样例；待 C2 确认字段与安全约束后开放。这里不接收图片或个人提示词。</small></label>
        </div></fieldset><div class="b5-notice">{{ ai.mode === 'mock' ? 'OFFLINE · 仅参数排版，不在此页生成图片。' : 'REAL · UNCONFIGURED。无模型调用、上传或费用；不能据此声称网关就绪。' }}</div><div class="b5-actions"><button type="button" class="primary" disabled title="UI_CONTRACT · C2 未接通">保存接口草稿 · UI_CONTRACT</button><button class="outline-button" :disabled="!canEdit">检查参数（本机）</button><button type="button" class="outline-button" disabled title="UI_CONTRACT · 缺少已核实网关">检查网关连接 · 未接通</button></div></form>
      </section><aside class="b5-aside"><section class="panel b5-card"><p class="eyebrow">SERVER / 接入指南</p><h2>密钥留在服务端</h2><ol><li>由服务端装配并核实同源网关。</li><li>服务端持有凭据，浏览器只接收批准的就绪投影。</li><li>健康检查与模型试跑分别授权、分别验收。</li><li>版本、发布及手机端生效等待 C2。</li></ol><button class="outline-button" :disabled="!canOpenStudio" @click="emit('navigate', 'ai')">打开双图调试台</button><div class="b5-actions"><button class="outline-button" @click="open('双图接入说明')">接入说明</button><button class="outline-button" disabled title="接入包下载尚无受控来源">下载接入包 · 未接通</button></div></section><section class="panel b5-card"><h3>真实模式未配置</h3><p>adapter / model / gateway / health 均为 UNCONFIGURED。没有读取凭据中心，也未发送健康探针。</p></section></aside></div>
    </template>

    <template v-else-if="page === 'payment-settings'">
      <div class="b5-channels" role="group" aria-label="选择支付渠道"><button v-for="key in channelKeys" :key="key" :aria-pressed="channel === key" :class="{ selected: channel === key }" @click="switchSelection('channel', key)"><i>{{ channels[key].mark }}</i><span><b>{{ channels[key].title }}</b><small>UNCONFIGURED</small></span></button></div>
      <div class="b5-grid"><section class="panel b5-card"><p class="eyebrow">PAYMENT PROFILE / {{ channel }}</p><h2>{{ meta.title }}支付</h2><p>{{ meta.rail }}</p>
        <form class="b5-form" aria-label="支付参数预览" @submit.prevent="check"><fieldset :disabled="!canEdit"><h3>收银入口</h3><p>仅预览新订单入口；不会改变已购权益。</p><label class="b5-check"><input v-model="payment.enabled" type="checkbox" aria-label="允许本渠道新下单">允许本渠道新下单</label><div class="b5-fields">
          <label>交易环境<select v-model="payment.mode" aria-label="交易环境"><option value="mock">模拟交易预览 · 不扣款</option><option value="live">正式收款预案 · 未接通</option></select></label>
          <label>收款方展示名<select v-model="payment.merchantLabel" aria-label="收款方展示名"><option>MBTI搭子体验店</option><option>品牌展示样例</option></select><small>原型限制 1–40 字；当前仅提供非个人信息样例。</small></label>
        </div></fieldset><h3>商户与回调</h3><p>尚无获批的受限投影。以下字段不接受输入，不设置真实商户或回调。</p><div class="b5-fields">
          <label>{{ channel === 'mp' ? '公众号 AppID' : channel === 'wechat' ? '微信小程序 AppID' : '应用 AppID' }}<input disabled :value="canEdit ? 'UNCONFIGURED' : '受限 · 未提供'" maxlength="64" aria-label="应用 AppID"></label>
          <label>{{ meta.wx ? '微信支付商户号 MchID' : '平台商户标识' }}<input disabled :value="canEdit ? 'UNCONFIGURED' : '受限 · 未提供'" maxlength="64" aria-label="商户标识"></label>
          <label v-for="label in ['支付通知地址（HTTPS）', '退款通知地址（HTTPS）']" :key="label">{{ label }}<input disabled :value="canEdit ? 'UNCONFIGURED' : '受限 · 未提供'" maxlength="240" :aria-label="label"></label>
          <template v-if="meta.wx"><label>商户证书序列号<input disabled :value="canEdit ? 'UNCONFIGURED' : '受限 · 未提供'" maxlength="64" aria-label="商户证书序列号"></label><label>微信支付公钥 ID<input disabled :value="canEdit ? 'UNCONFIGURED' : '受限 · 未提供'" maxlength="80" aria-label="微信支付公钥 ID"></label></template>
        </div><h3>服务端凭据引用</h3><div class="b5-references"><div v-for="label in meta.references" :key="label"><span>{{ label }}</span><b>{{ canEdit ? '未提供获批引用' : '受限 · 未提供' }}</b></div></div><p>这里没有凭据输入或引用编辑器。只有服务端批准且当前会话有权查看的引用标识才可展示。</p><div class="b5-actions"><button type="button" class="primary" disabled title="UI_CONTRACT · C2 未接通">保存支付草稿 · UI_CONTRACT</button><button class="outline-button" :disabled="!canEdit">检查参数（本机）</button></div></form>
      </section><aside class="b5-aside"><section class="panel b5-card"><p class="eyebrow">LIVE / 当前生效</p><h3>这个渠道目前怎么收款？</h3><dl class="b5-kv"><dt>收银入口 / 收款方 / 付款时限</dt><dd>未知 · 无服务端配置来源</dd></dl><button class="outline-button" @click="open('收银入口预览')">预览这个渠道的收银入口</button></section><section class="panel b5-card"><p class="eyebrow">INTEGRATION</p><h3>正式支付 · UNCONFIGURED</h3><p>参数格式检查不证明商户归属、凭据存在、沙箱或真实通道就绪。不会打开平台收银台。</p></section><section class="panel b5-card"><p class="eyebrow">LOCAL SIMULATOR</p><h3>回调条件演练</h3><p>独立本机判断样例，没有业务订单或真实验签。</p><button class="outline-button" :disabled="!canEdit" @click="simulation = null; open('支付回调演练')">打开回调演练</button></section></aside></div>
    </template>

    <template v-else-if="page === 'trade-settings'">
      <div class="b5-grid"><section class="panel b5-card"><p class="eyebrow">CHECKOUT POLICY / 交易规则</p><h2>从下单到售后</h2><form class="b5-form" aria-label="交易规则预览" @submit.prevent="check"><fieldset :disabled="!canEdit"><h3>付款与兑换</h3><div class="b5-fields"><label>付款时限（分钟）<input v-model.number="trade.ttl" type="number" min="1" max="120" step="1" aria-label="付款时限（分钟）"></label><label class="b5-check"><input v-model="trade.redeem" type="checkbox" aria-label="允许体验码兑换">允许体验码兑换</label></div><h3>售后处理</h3><div class="b5-fields"><label>售后处理方式<select v-model="trade.selfRefund" aria-label="售后处理方式"><option value="self">允许用户自助模拟退款</option><option value="support">仅由客服在后台处理</option></select></label><label>自助售后期限（天）<input v-model.number="trade.refundDays" type="number" min="1" max="30" step="1" aria-label="自助售后期限（天）"><small>仅自助退款使用，从支付成功时间起算。</small></label></div></fieldset><div class="b5-actions"><button type="button" class="primary" disabled title="UI_CONTRACT · C2 未接通">保存交易规则草稿 · UI_CONTRACT</button><button class="outline-button" :disabled="!canEdit">检查参数（本机）</button><button type="button" class="outline-button" @click="tradePreview">预览交易规则</button></div></form></section><aside class="b5-aside"><section class="panel b5-card"><p class="eyebrow">SCOPE / 生效范围</p><h3>保留新老订单的约定</h3><p>暂停新收款不撤销既有权益，关闭新兑换不撤销已兑换权益。退款与付款有效期没有被修改。</p><p>历史订单遵守成交时快照；缺少或未知旧版规则的订单保留原兼容语义，等待 C2 核实。历史测评与结果快照也保持原值。</p></section><section class="panel b5-card"><h3>当前生效规则</h3><dl class="b5-kv"><dt>付款时限 / 体验码 / 售后</dt><dd>未知 · 未读取服务端规则</dd></dl><button class="outline-button" disabled title="UI_CONTRACT · 不执行退款">执行退款 · UI_CONTRACT</button></section></aside></div>
    </template>

    <template v-else>
      <div class="b5-ribbon"><div><span>当前生效版本</span><b>未知</b></div><div><span>线上题库版本</span><b>未知</b></div><div><span>待发布类别</span><b>未知</b></div></div>
      <div class="b5-toolbar" role="group" aria-label="发布视图"><button v-for="item in [{ key: 'versions', label: '发布记录' }, { key: 'diff', label: '草稿差异' }, { key: 'audit', label: '操作日志' }]" :key="item.key" class="outline-button" :aria-pressed="tab === item.key" @click="switchSelection('tab', item.key)">{{ item.label }}</button><button class="primary" :disabled="!canRelease" @click="open('审阅发布占位')">审阅发布占位</button></div>
      <section class="panel b5-card"><template v-if="tab === 'versions'"><div class="b5-table-scroll"><table><thead><tr><th v-for="label in ['版本', '发布时间', '发布说明', '涉及配置', '操作']" :key="label">{{ label }}</th></tr></thead><tbody><tr><td colspan="5">版本服务未接通 · 没有可核实记录，不代表历史为空。</td></tr></tbody></table></div><div class="b5-actions"><button class="outline-button" @click="open('版本详情占位')">版本详情占位</button><button class="outline-button" @click="open('回滚说明占位')">查看回滚说明</button></div></template><template v-else-if="tab === 'diff'"><h2>草稿与线上差异</h2><p>两份服务端配置均不可用，无法计算差异。未知不等于零差异。</p><button class="outline-button" @click="open('草稿线上差异占位')">打开差异抽屉</button></template><template v-else><div class="b5-table-scroll"><table><thead><tr><th v-for="label in ['时间', '操作者 / 角色', '操作', '对象', '版本', '结果', '原因']" :key="label">{{ label }}</th></tr></thead><tbody><tr><td colspan="7">审计服务未接通 · 没有可核实记录；本机演练不写审计。</td></tr></tbody></table></div><button class="outline-button" @click="open('操作日志占位')">日志详情占位</button></template></section>
      <section class="panel b5-card b5-release-note"><label>发布说明<textarea v-model="note" :disabled="!canRelease" rows="3" maxlength="100" aria-label="发布说明" placeholder="仅内存预览 · 最多 100 字"></textarea></label><p>发布需要非空说明、可核实的字段差异与预期版本。当前缺少这些服务端前提，不能确认发布。</p><div class="b5-actions"><button class="primary" disabled title="UI_CONTRACT · C2 未接通">确认发布 · UI_CONTRACT</button><button class="outline-button" disabled title="UI_CONTRACT · 无获批版本目标">回滚为新版本 · UI_CONTRACT</button></div></section>
    </template>

    <div v-if="issues.length" class="b5-validation" role="alert"><b>本机参数检查未通过</b><ul><li v-for="issue in issues" :key="issue">{{ issue }}</li></ul></div><p v-if="feedback" class="b5-notice" role="status">{{ feedback }}</p>
    <section class="b5-source" aria-label="配置来源状态" :aria-busy="sourceState === 'loading'"><div><b>{{ sourceState === 'loading' ? '加载中（本机状态演练）' : sourceState === 'error' ? '读取失败（本机状态演练）' : '配置来源未接通 · UI_CONTRACT' }}</b><p>{{ sourceState === 'error' ? '没有请求服务端。请由 C2 接通来源与授权后再读取。' : '没有发送读取请求；草稿、线上配置、版本和日志均未知。' }}</p></div><div class="b5-actions"><button class="outline-button" disabled :title="consumer.persistence ? '' : 'UI_CONTRACT · 读取适配器未接通'">读取配置 · 未接通</button><button class="text-button" @click="stateDemo('loading')">演练加载状态</button><button class="text-button" @click="stateDemo('error')">演练错误状态</button><button v-if="sourceState !== 'unavailable'" class="text-button" @click="sourceState = 'unavailable'">返回未接通状态</button></div></section>

    <div v-if="drawer" class="b5-overlay" @click.self="close"><section class="b5-dialog" role="dialog" aria-modal="true" :aria-label="drawer" tabindex="-1"><header><div><p class="eyebrow">UI_CONTRACT / 本机预览</p><h2>{{ drawer }}</h2></div><button class="icon-button" aria-label="关闭 B5 抽屉" @click="close">×</button></header><div class="b5-drawer-body">
      <template v-if="drawer === '切换确认'"><h3>当前表单有未保存输入</h3><p>返回可保留本次输入；放弃后切换目标。保存接口未接通。</p><div class="b5-actions"><button class="outline-button" @click="close">返回继续编辑</button><button class="primary" @click="discardSwitch">放弃输入并切换</button></div></template>
      <template v-else-if="drawer === '本机输入差异'"><p>只比较当前页输入与原型初始样例，不是草稿 / 线上差异，也不生成版本。</p><dl v-for="row in differences" :key="row.field" class="b5-kv"><dt>{{ fieldNames[row.field] }}</dt><dd>{{ row.before }} → {{ row.after }}</dd></dl><p v-if="!differences.length">当前页没有可比较的参数变化。</p></template>
      <template v-else-if="drawer === '支付回调演练'"><p>{{ meta.title }} · LOCAL ISOLATED SIMULATOR。每次从独立样例开始；没有订单号，不创建订单、不发起 HTTP、不支付、不记账、不发放或解锁权益。</p><form class="b5-form" aria-label="回调本机演练" @submit.prevent="runSimulation"><label>通知场景<select v-model="scenario" aria-label="通知场景" @change="simulation = null"><option v-for="item in scenarios" :key="item.value" :value="item.value">{{ item.label }}</option></select></label><button class="primary" :disabled="!canEdit">运行本机演练</button></form><div v-if="simulation" class="b5-notice" role="status"><p v-for="step in simulation.steps" :key="step">{{ step }}</p><b>样例权益计数：{{ simulation.illustratedGrants }} 次 · 实际发放：未执行</b></div></template>
      <template v-else-if="drawer === '收银入口预览'"><div class="b5-phone"><small>本机布局样例 · {{ meta.title }}</small><h3>{{ payment.merchantLabel }}</h3><p>{{ payment.enabled ? '预览：允许新下单' : '预览：暂停新下单' }}</p><p>{{ payment.mode === 'mock' ? '模拟模式排版' : '正式收款预案 · UNCONFIGURED' }}</p><button class="primary" disabled>支付 · 未接通</button></div><p>线上收银台未知。这里只使用当前页的非敏感输入，没有金额、商户、回调或凭据投影。</p></template>
      <template v-else-if="drawer === '交易规则效果预览'"><p>本机规则预览：付款时限 {{ trade.ttl }} 分钟；新兑换入口{{ trade.redeem ? '开放' : '关闭' }}；{{ trade.selfRefund === 'self' ? `支付后 ${trade.refundDays} 天内自助售后` : '客服处理售后' }}。</p><p>未保存、未生效；不改变任何订单、有效期、兑换、退款或既有权益。旧订单与未知快照均保留。</p><button class="outline-button" disabled>执行退款 · UI_CONTRACT</button></template>
      <template v-else-if="drawer === '配置投影预览'"><label>预览视图<select v-model="previewView" aria-label="配置投影视图"><option value="draft">草稿预览</option><option value="live">线上预览</option></select></label><h3>{{ previewView === 'draft' ? '草稿' : '线上' }}投影未提供</h3><p>无可核实的服务端配置与权限化字段映射，不合成公开或受限配置负载。</p><button class="outline-button" disabled>读取投影 · UI_CONTRACT</button></template>
      <template v-else-if="drawer === '权限与接入边界'"><p>页面入口预期由服务端授予 mbti:ops:system:read；本机参数编辑预期为 mbti:ops:system:write；发布 / 回滚预期为 mbti:ops:release:write。客户端按钮不构成授权证据。</p><p>owner 预期维护系统参数；editor 仅允许的线上投影与内容草稿；support / reader 仅受限视图。真实四角色 HTTP 校验：NOT_RUN。</p><dl v-for="(value, key) in b5Unknowns" :key="key" class="b5-kv"><dt>{{ key }} · {{ value.status }}</dt><dd>{{ value.reason }}</dd></dl></template>
      <template v-else-if="drawer === '双图接入说明'"><p>原型字段包括运行模式、适配器、模型、同源网关、画幅、20–180 秒时限与最多 450 字生成指令。</p><p>图1为人物、图2为画风；真实网关的健康检查与生成是分开的操作。当前仅展示说明，无探针、模型调用或下载来源。</p><p>服务端凭据引用需复用 Foundation SecretRefPort 与归属校验；原型的任意环境变量名不能直接成为正式引用契约。</p></template>
      <template v-else><h3>等待可核实的服务端来源</h3><dl class="b5-kv"><dt>版本 / 预期版本 / 发布人 / 时间 / 涉及配置</dt><dd>未知 · 未提供</dd></dl><p v-if="drawer === '回滚说明占位'">后续回滚须创建新版本并保留未发布草稿，历史订单、旧版未知规则和已完成结果快照不变。目前没有可选择的版本或回滚目标。</p><p v-else-if="drawer === '操作日志占位'">时间、操作者、对象、版本、结果、原因等待服务端按权限返回。没有伪造操作日志或把本机演练写入审计。</p><p v-else>无法确定差异类别、空差异、预期版本或并发状态；不会生成版本标识、发布历史或成功提示。</p><p>发布说明：{{ note || '尚无本机输入' }}</p><button class="primary" disabled title="UI_CONTRACT · C2 未接通">{{ drawer === '回滚说明占位' ? '确认回滚并发布 · UI_CONTRACT' : '确认发布 · UI_CONTRACT' }}</button></template>
    </div><footer><button class="outline-button" @click="close">关闭预览</button><span>未发送请求 · 未写入存储</span></footer></section></div>
  </div>
</template>
