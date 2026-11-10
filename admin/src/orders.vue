<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { OpsApiError, readOrder } from './ops-api'
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
let requestVersion = 0
const stateTitle = computed(() => ({
  idle: '输入订单号开始核对', loading: '正在查询订单', success: '订单详情', invalid: '请检查订单号',
  notFound: '未找到此订单', forbidden: '没有订单读取权限', unauthenticated: '登录已失效', error: '暂时无法查询',
})[state.value])
const paymentAvailability = computed(() => {
  const code = order.value?.payment_availability
  return code === 'unconfigured' ? '未配置收款' : code === 'controlled_test' ? '受控测试收款' : '未识别收款状态'
})

function clearLookup() {
  requestVersion++
  state.value = 'idle'; order.value = null; queriedId.value = ''; errorMessage.value = ''
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
            <div><dt>素材交付 / 累计退款</dt><dd>接口未提供，等待接入</dd></div>
          </dl>
          <div class="order-dependency"><div><b>售后与交付尚未接通</b><p>UI_CONTRACT · 退款原因与确认、同任务重试及审计依赖对应业务接口。</p></div><div class="order-disabled-actions"><button class="outline-button" disabled title="UI_CONTRACT · 退款接口未接通">退款 · 未接通</button><button class="outline-button" disabled title="UI_CONTRACT · 任务及重试接口未接通">重试交付 · 未接通</button></div></div>
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
        <p class="eyebrow">EXPERIENCE CODES</p><h2>体验兑换码尚未接通</h2><p>需要来源隔离的体验码账本、套装查询、生成与停用接口。当前不会生成、兑换或保存本机体验码。</p>
        <div class="order-disabled-actions"><select aria-label="体验码套装筛选" disabled><option>按套装 · 未接通</option></select><button class="outline-button" disabled>生成一批体验码 · 未接通</button><button class="outline-button" disabled>停用 · 未接通</button></div>
      </template>
      <template v-else>
        <p class="eyebrow">LOCAL TEST ORDERS</p><h2>本机前台订单尚未接通</h2><p>保留原型测试入口。需要来源隔离的测试账本与处理接口；当前不会读取原型浏览器账本或创建演练订单。</p>
        <div class="order-disabled-actions"><button class="outline-button" disabled>刷新 · 未接通</button><button class="outline-button" disabled>详情 · 未接通</button><button class="outline-button" disabled>处理 · 未接通</button></div>
      </template>
      <p class="order-contract-note">UI_CONTRACT · 依赖待定稿，needs_human_review</p><button class="text-button" @click="tab = 'orders'">返回交易订单按号查询 →</button>
    </section>
    <p class="security-note">订单数据由服务端按 mbti:orders:read 授权返回。页面只保留订单业务字段，不展示支付凭据、私密联系方式或私有作答。</p>
  </div>
</template>
