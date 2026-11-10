<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  createOrderRefundRequest, createRedeemCodes, disableRedeemCode, listRedeemCodes, OpsApiError, readOrder,
  type RedeemCodeRow, type RefundRequestResult,
} from './ops-api'
import { normalizeOrderId, orderStatus, orderTime, type OpsOrder } from './ops-order'
import './orders.css'
import OrdersList from './orders-list.vue'
const props = withDefaults(defineProps<{ permissions?: string[] }>(), { permissions: () => [] })

const emit = defineEmits<{ reauthenticate: [] }>()
const tabs = [
  { key: 'orders', label: '交易订单' },
  { key: 'jobs', label: '生成任务' },
  { key: 'codes', label: '体验兑换码' },
  { key: 'local', label: '本机前台订单' },
] as const
const tab = ref<(typeof tabs)[number]['key']>('orders')
type LookupState = 'idle' | 'loading' | 'success' | 'invalid' | 'notFound' | 'forbidden' | 'unauthenticated' | 'error'
const state = ref<LookupState>('idle')
const orderId = ref('')
const queriedId = ref('')
const order = ref<OpsOrder | null>(null)
const errorMessage = ref('')
const refundReason = ref('')
const refundState = ref<'idle' | 'loading' | 'success' | 'error'>('idle')
const refundError = ref('')
const refundResult = ref<RefundRequestResult | null>(null)
let requestVersion = 0
let refundVersion = 0
const canRefund = computed(() => props.permissions.includes('mbti:orders:read') && props.permissions.includes('admin.payment.refund.request'))
const canSubmitRefund = computed(() => !!order.value && order.value.status === 'paid' && canRefund.value && refundReason.value.trim().length > 0 && refundReason.value.trim().length <= 500 && refundState.value !== 'loading')
const canRedeemWrite = computed(() => props.permissions.includes('mbti:ops:redemption:write'))
const canRedeemRead = computed(() => props.permissions.includes('mbti:orders:read'))
const redeemProduct = ref('studio_tier_1')
const redeemCount = ref(5)
const redeemRows = ref<RedeemCodeRow[]>([])
const redeemIssued = ref<{ id: string; code: string; product_code: string }[]>([])
const redeemState = ref<'idle' | 'loading' | 'success' | 'error'>('idle')
const redeemError = ref('')
let redeemVersion = 0
const stateTitle = computed(() => ({
  idle: '输入订单号开始核对', loading: '正在查询订单', success: '订单详情', invalid: '请检查订单号',
  notFound: '未找到此订单', forbidden: '没有订单读取权限', unauthenticated: '登录已失效', error: '暂时无法查询',
})[state.value])
const paymentAvailability = computed(() => {
  const code = order.value?.payment_availability
  return code === 'unconfigured' ? '未配置收款' : code === 'controlled_test' ? '受控测试收款' : '未识别收款状态'
})
const refundTitle = computed(() => {
  if (!canRefund.value) return '当前会话缺少 mbti:orders:read 或 admin.payment.refund.request'
  if (order.value?.status !== 'paid') return '仅已支付订单可提交人工退款申请'
  return '提交后进入 pending_manual_review；不会打款，也不会吊销权益'
})

function clearLookup() {
  requestVersion++
  refundVersion++
  state.value = 'idle'; order.value = null; queriedId.value = ''; errorMessage.value = ''
  refundReason.value = ''; refundState.value = 'idle'; refundError.value = ''; refundResult.value = null
}
// Clear earlier data immediately when the identifier changes, including during a request.
watch(orderId, clearLookup, { flush: 'sync' })
onBeforeUnmount(() => { requestVersion++ })

async function queryOrder() {
  clearLookup()
  let id: string
  try { id = normalizeOrderId(orderId.value) }
  catch (error) {
    state.value = 'invalid'
    errorMessage.value = error instanceof Error ? error.message : '请检查订单号。'
    return
  }
  orderId.value = id
  const version = ++requestVersion
  queriedId.value = id; state.value = 'loading'
  try {
    const value = await readOrder(id)
    if (version !== requestVersion) return
    order.value = value; state.value = 'success'
  } catch (error) {
    if (version !== requestVersion) return
    const status = error instanceof OpsApiError ? error.status : 0
    state.value = status === 404 ? 'notFound' : status === 403 ? 'forbidden' : status === 401 ? 'unauthenticated' : 'error'
    // HTTP status controls this state; never render the server's arbitrary error body.
    errorMessage.value = status === 404 ? '请核对完整订单号与所在环境，再重新查询。未找到订单不代表没有读取权限。'
      : status === 403 ? '服务端已拒绝读取。请联系管理员核对 mbti:orders:read 授权。'
        : status === 401 ? '请重新核验管理员会话后查询。'
          : error instanceof OpsApiError && error.code === 'INVALID_ORDER_RESPONSE' ? '订单响应格式不正确，请重试或联系维护人员。'
            : error instanceof OpsApiError && status === 0 ? error.message : '订单服务暂不可用，请稍后重试。'
  }
}

function refundKey() {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => (b % 36).toString(36)).join('')
}
async function submitRefund() {
  if (!order.value || !canSubmitRefund.value) return
  const current = ++refundVersion
  refundState.value = 'loading'; refundError.value = ''; refundResult.value = null
  try {
    const result = await createOrderRefundRequest(order.value.id, { reason: refundReason.value.trim(), idempotency_key: refundKey() })
    if (current !== refundVersion) return
    refundResult.value = result; refundState.value = 'success'
  } catch (error) {
    if (current !== refundVersion) return
    const status = error instanceof OpsApiError ? error.status : 0
    refundState.value = 'error'
    refundError.value = status === 401 ? '登录已失效，请重新核验登录。' : status === 403 ? '服务端拒绝退款申请，请核对 mbti:orders:read 与 admin.payment.refund.request。'
      : status === 409 ? '当前订单不可申请退款，或申请与剩余可退金额冲突。' : status === 422 ? '退款原因或幂等键无效。'
        : status >= 500 ? '退款申请服务暂不可用，请重试。' : error instanceof OpsApiError ? error.message : '退款申请失败，请重试。'
  }
}

function redeemMessage(error: unknown) {
  const status = error instanceof OpsApiError ? error.status : 0
  return status === 401 ? '登录已失效，请重新核验登录。' : status === 403 ? '服务端拒绝兑换码操作，请核对 mbti:ops:redemption:write / mbti:orders:read。'
    : status === 422 ? '兑换码参数无效。' : status >= 500 ? '兑换码服务暂不可用，请重试。'
      : error instanceof OpsApiError ? error.message : '兑换码请求失败，请重试。'
}
async function loadRedeemCodes() {
  if (!canRedeemRead.value) { redeemRows.value = []; return }
  const current = ++redeemVersion
  redeemState.value = 'loading'; redeemError.value = ''
  try {
    const rows = await listRedeemCodes({ product_code: redeemProduct.value, limit: '50' })
    if (current !== redeemVersion) return
    redeemRows.value = rows; redeemState.value = 'success'
  } catch (error) {
    if (current !== redeemVersion) return
    redeemState.value = 'error'; redeemError.value = redeemMessage(error); redeemRows.value = []
  }
}
async function mintRedeemCodes() {
  if (!canRedeemWrite.value || redeemState.value === 'loading') return
  const current = ++redeemVersion
  redeemState.value = 'loading'; redeemError.value = ''; redeemIssued.value = []
  try {
    const batch = await createRedeemCodes({ product_code: redeemProduct.value, count: redeemCount.value })
    if (current !== redeemVersion) return
    redeemIssued.value = batch.codes
    const rows = await listRedeemCodes({ product_code: redeemProduct.value, limit: '50' })
    if (current !== redeemVersion) return
    redeemRows.value = rows; redeemState.value = 'success'
  } catch (error) {
    if (current !== redeemVersion) return
    redeemState.value = 'error'; redeemError.value = redeemMessage(error)
  }
}
async function stopRedeemCode(id: string) {
  if (!canRedeemWrite.value || redeemState.value === 'loading') return
  const current = ++redeemVersion
  redeemState.value = 'loading'; redeemError.value = ''
  try {
    await disableRedeemCode(id)
    const rows = await listRedeemCodes({ product_code: redeemProduct.value, limit: '50' })
    if (current !== redeemVersion) return
    redeemRows.value = rows; redeemState.value = 'success'
  } catch (error) {
    if (current !== redeemVersion) return
    redeemState.value = 'error'; redeemError.value = redeemMessage(error)
  }
}
watch(tab, value => { if (value === 'codes') void loadRedeemCodes() })
</script>

<template>
  <div class="orders-page">
    <nav class="order-tabs" aria-label="订单功能">
      <button v-for="item in tabs" :id="`order-tab-${item.key}`" :key="item.key" :aria-pressed="tab === item.key" :class="{ selected: tab === item.key }" @click="tab = item.key">{{ item.label }}</button>
    </nav>

    <section v-if="tab === 'orders'" aria-labelledby="order-tab-orders">
      <div class="order-scope"><span class="order-badge">按号详情</span><p>输入与 H5 一致的完整订单号，核对接口返回的订单事实。</p></div>
      <section class="panel order-search" aria-labelledby="order-search-title">
        <div class="order-section-heading"><div><p class="eyebrow">ORDER LOOKUP</p><h2 id="order-search-title">按订单号查询</h2></div><span class="order-read-label">只读查询</span></div>
        <form class="lookup-form" :aria-busy="state === 'loading'" @submit.prevent="queryOrder">
          <label for="order-id">完整订单号<input id="order-id" v-model="orderId" type="search" name="orderId" maxlength="128" placeholder="从 H5 订单页复制订单号" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="order-id-help" :aria-invalid="state === 'invalid'"></label>
          <button class="primary" :disabled="state === 'loading'">{{ state === 'loading' ? '查询中…' : '查询订单' }}</button>
          <button class="outline-button" type="button" :disabled="!orderId && state === 'idle'" @click="orderId = ''; clearLookup()">清空</button>
        </form>
        <p id="order-id-help" class="muted">仅支持精确订单号；自动去除首尾空格，保留大小写。不会按用户或商品搜索。</p>
      </section>

      <section class="panel order-result" :aria-busy="state === 'loading'" aria-label="订单查询结果">
        <div class="order-section-heading"><h2>订单详情</h2><span class="muted">{{ state === 'success' ? '本次返回 1 笔 · 非列表查询' : '精确查询 · 非列表查询' }}</span></div>
        <article v-if="order && state === 'success'" class="order-record" aria-labelledby="order-record-id">
          <div class="order-record-heading"><div><p class="eyebrow">ORDER NUMBER</p><h3 id="order-record-id" class="order-mono">{{ order.id }}</h3></div><span class="order-badge" :class="{ paid: order.status === 'paid', failed: order.status === 'failed' }">{{ orderStatus(order.status) }} · {{ order.status }}</span></div>
          <div class="order-facts">
            <div class="order-amount"><span>订单金额</span><strong>{{ order.amount }} <small>分 · {{ order.currency }}</small></strong><p>接口原始金额单位：分</p></div>
            <div><span>权益解锁</span><b>{{ order.unlocked ? '已解锁' : '未解锁' }}</b><p>解锁状态不代表素材已交付</p></div>
            <div><span>收款可用性</span><b>{{ paymentAvailability }}</b><p class="order-mono">{{ order.payment_availability }}</p></div>
          </div>
          <dl class="order-fields">
            <div><dt>下单商品编码</dt><dd class="order-mono">{{ order.product_code }}</dd></div>
            <div><dt>关联测评结果编号</dt><dd class="order-mono">{{ order.result_id }}</dd></div>
            <div><dt>创建时间（北京时间）</dt><dd>{{ orderTime(order.created_at) }}</dd></div>
            <div><dt>支付时间（北京时间）</dt><dd>{{ orderTime(order.paid_at) }}</dd></div>
            <div><dt>定价模式</dt><dd>{{ order.pricing_mode === 'controlled_test_fixture' ? '受控测试定价' : '未识别定价模式' }} <span class="order-mono">· {{ order.pricing_mode }}</span></dd></div>
            <div><dt>素材交付 / 累计退款</dt><dd>素材交付仍未接通；退款仅人工申请入审，不表示到账</dd></div>
          </dl>
          <div class="order-dependency">
            <div>
              <b>人工退款申请（AF-106 候选）</b>
              <p>{{ refundTitle }}</p>
              <label class="order-refund-label">退款原因<textarea v-model="refundReason" maxlength="500" rows="3" :disabled="!canRefund || order.status !== 'paid' || refundState === 'loading'" placeholder="说明客服或业务原因（1–500 字）"></textarea></label>
              <p v-if="refundState === 'success' && refundResult" class="order-refund-ok" role="status">已提交申请 {{ refundResult.request_id }} · {{ refundResult.refund_status }} · {{ refundResult.amount_fen }} 分 · 权益未吊销</p>
              <p v-else-if="refundState === 'error'" class="order-refund-err" role="alert">{{ refundError }}</p>
            </div>
            <div class="order-disabled-actions">
              <button class="outline-button" :disabled="!canSubmitRefund" :title="refundTitle" @click="submitRefund">{{ refundState === 'loading' ? '提交中…' : '提交退款申请' }}</button>
              <button class="outline-button" disabled title="UI_CONTRACT · 任务及重试接口未接通">重试交付 · 未接通</button>
            </div>
          </div>
        </article>
        <div v-else class="order-state" :class="{ 'order-state-error': !['idle', 'loading'].includes(state) }" :role="['idle', 'loading'].includes(state) ? 'status' : 'alert'" aria-live="polite">
          <span v-if="state === 'loading'" class="spinner" aria-hidden="true"></span><span v-else class="order-state-icon" aria-hidden="true">{{ state === 'idle' ? '▤' : '!' }}</span>
          <h3>{{ stateTitle }}</h3><p v-if="queriedId" class="order-mono">{{ queriedId }}</p>
          <p>{{ state === 'idle' ? '查询后在此查看金额、支付状态与权益解锁。' : state === 'loading' ? '正在读取当前环境的订单，请稍候。' : errorMessage }}</p>
          <button v-if="state === 'unauthenticated'" class="primary" @click="emit('reauthenticate')">重新核验登录</button>
          <button v-else-if="state === 'error'" class="outline-button" @click="queryOrder">重试查询</button>
        </div>
      </section>

      <OrdersList :permissions="props.permissions" @detail="id => { orderId = id; queryOrder() }" @reauthenticate="emit('reauthenticate')" />
    </section>

    <section v-else class="panel order-contract-panel" :aria-labelledby="`order-tab-${tab}`">
      <template v-if="tab === 'jobs'">
        <p class="eyebrow">GENERATION TASKS</p><h2>生成任务尚未接通</h2><p>订单读取接口不返回生成任务、异常队列或素材交付状态。需要任务查询、同任务重试、幂等和审计接口。</p>
        <div class="order-disabled-actions"><button class="outline-button" disabled>筛选异常 · 未接通</button><button class="outline-button" disabled>恢复当前统计范围 · 未接通</button><button class="outline-button" disabled>任务详情 · 未接通</button><button class="outline-button" disabled>重试原任务 · 未接通</button></div>
      </template>
      <template v-else-if="tab === 'codes'">
        <p class="eyebrow">EXPERIENCE CODES</p><h2>体验兑换码账本</h2>
        <p>服务端哈希账本；明文仅在生成当次展示。访客核销路径尚未接通。写入需 <code>mbti:ops:redemption:write</code>。</p>
        <div class="order-disabled-actions">
          <label>套装<select v-model="redeemProduct" aria-label="体验码套装筛选" :disabled="redeemState === 'loading'" @change="loadRedeemCodes"><option value="studio_tier_1">晒图套装 · studio_tier_1</option></select></label>
          <label>数量<input v-model.number="redeemCount" type="number" min="1" max="50" :disabled="!canRedeemWrite || redeemState === 'loading'" aria-label="生成数量"></label>
          <button class="outline-button" :disabled="!canRedeemWrite || redeemState === 'loading'" :title="canRedeemWrite ? '生成后请立即复制明文' : '缺少 mbti:ops:redemption:write'" @click="mintRedeemCodes">{{ redeemState === 'loading' ? '处理中…' : '生成一批体验码' }}</button>
          <button class="outline-button" :disabled="!canRedeemRead || redeemState === 'loading'" @click="loadRedeemCodes">刷新列表</button>
        </div>
        <p v-if="!canRedeemRead" class="muted">当前会话缺少 mbti:orders:read，无法读取账本。</p>
        <p v-else-if="redeemState === 'error'" class="order-refund-err" role="alert">{{ redeemError }}</p>
        <div v-if="redeemIssued.length" class="order-redeem-issued" role="status">
          <b>本次明文（仅此一次）</b>
          <ul><li v-for="item in redeemIssued" :key="item.id"><code>{{ item.code }}</code> · {{ item.id }}</li></ul>
        </div>
        <table v-if="redeemRows.length" class="order-redeem-table">
          <thead><tr><th>编号</th><th>商品</th><th>状态</th><th>核销</th><th>创建</th><th></th></tr></thead>
          <tbody>
            <tr v-for="row in redeemRows" :key="row.id">
              <td class="order-mono">{{ row.id }}</td>
              <td class="order-mono">{{ row.product_code }}</td>
              <td>{{ row.code_status }}</td>
              <td>{{ row.redeemed_count }}/{{ row.max_redemptions }}</td>
              <td>{{ orderTime(row.created_at) }}</td>
              <td><button class="text-button" :disabled="!canRedeemWrite || row.code_status === 'disabled' || redeemState === 'loading'" @click="stopRedeemCode(row.id)">停用</button></td>
            </tr>
          </tbody>
        </table>
        <p v-else-if="canRedeemRead && redeemState === 'success'" class="muted">当前套装暂无兑换码记录。</p>
      </template>
      <template v-else>
        <p class="eyebrow">LOCAL TEST ORDERS</p><h2>本机前台订单尚未接通</h2><p>保留原型测试入口。需要来源隔离的测试账本与处理接口；当前不会读取原型浏览器账本或创建演练订单。</p>
        <div class="order-disabled-actions"><button class="outline-button" disabled>刷新 · 未接通</button><button class="outline-button" disabled>详情 · 未接通</button><button class="outline-button" disabled>处理 · 未接通</button></div>
      </template>
      <p class="order-contract-note">{{ tab === 'codes' ? '兑换码候选 · needs_human_review；访客核销未接' : 'UI_CONTRACT · 依赖待定稿，needs_human_review' }}</p><button class="text-button" @click="tab = 'orders'">返回交易订单按号查询 →</button>
    </section>
    <p class="security-note">订单数据由服务端按 mbti:orders:read 授权返回。页面只保留订单业务字段，不展示支付凭据、私密联系方式或私有作答。</p>
  </div>
</template>
