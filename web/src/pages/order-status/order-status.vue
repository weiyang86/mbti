<template>
  <view class="page">
    <proto-nav />
    <view class="page-intro">
      <text class="tag">订单查询</text>
      <view class="h2">订单状态</view>
      <view class="p">订单号：{{ orderId || '未提供' }}</view>
    </view>

    <StateView v-if="loading" state="loading" title="正在查询本人订单…" />
    <StateView v-else-if="error && !order" state="error" title="订单状态读取失败" :description="error">
      <button class="btn secondary full" :disabled="!orderId" @click="load">重新查询</button>
    </StateView>

    <view v-if="order" class="panel" :class="`tone-${tone}`">
      <view class="order">
        <view class="order-symbol">{{ symbol }}</view>
        <view class="order-info">
          <text class="b">{{ orderStatusLabel(order.status) }}（{{ order.status }}）</text>
          <text class="small">服务端订单号：{{ order.order_id }}</text>
          <text class="small">{{ order.unlocked ? '已解锁' : '未解锁' }} · {{ paymentAvailabilityLabel(order.payment_availability) }}</text>
          <text v-if="order.paid_at" class="small">支付时间：{{ order.paid_at }}</text>
        </view>
      </view>

      <view class="notice" :class="{ warn: tone === 'pending' || tone === 'failed' || tone === 'refunded', ok: tone === 'paid' }">
        {{ orderStatusHint(order.status) }}
      </view>

      <view v-if="order.status === 'pending' && devPaymentAvailable" class="notice">
        <text class="small">以下为本地支付联调入口，不会产生真实扣款。</text>
        <button class="btn secondary full mt" :disabled="devPaying || devFailing" @click="simulatePay">{{ devPaying ? '正在标记支付…' : '标记支付成功（仅开发环境）' }}</button>
        <button class="btn ghost full mt" :disabled="devPaying || devFailing" @click="simulateFail">{{ devFailing ? '正在标记失败…' : '标记支付失败（仅开发环境）' }}</button>
      </view>

      <view v-if="order.status === 'pending'" class="mini-list">
        <button class="btn secondary full" :disabled="loading" @click="load">刷新支付状态</button>
        <text v-if="pollPaid" class="small">支付完成后会自动刷新…</text>
      </view>
      <view v-else-if="order.status === 'failed'" class="mini-list">
        <button class="btn full" @click="goCatalog">重新选择商品</button>
      </view>
      <view v-else-if="order.status === 'paid'" class="mini-list">
        <button class="btn full" @click="goOrders">查看已解锁权益</button>
        <button v-if="devPaymentAvailable" class="btn ghost full mt" :disabled="devRefunding" @click="confirmRefund">{{ devRefunding ? '正在标记退款…' : '标记退款（仅开发环境）' }}</button>
      </view>
      <view v-else-if="order.status === 'refunded'" class="mini-list">
        <button class="btn full" @click="goCatalog">重新选择商品</button>
      </view>

      <view class="fine">订单与权益以服务端记录为准，关闭页面不会改变订单状态。</view>
    </view>

    <view class="mini-list mt">
      <button class="btn secondary full" :disabled="loading || !orderId" @click="load">重新查询同一订单</button>
      <button class="btn full" @click="goOrders">查看金额、本人订单与权益</button>
      <button class="btn ghost full" @click="goCatalog">返回商品目录</button>
    </view>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import StateView from '@/components/state-view.vue'
import { getOrderStatus, devMarkOrderPaid, devMarkOrderFailed, devRefundOrder, devPaymentAvailable, type OrderStatus } from '@/api/payment'
import { requestErrorMessage } from '@/api/client'
import { orderStatusHint, orderStatusLabel, orderTone, paymentAvailabilityLabel } from '@/utils/payment-display'

const orderId = ref('')
const order = ref<OrderStatus | null>(null)
const loading = ref(false)
const devPaying = ref(false)
const devFailing = ref(false)
const devRefunding = ref(false)
const error = ref('')
const pollPaid = ref(false)
let pollTimer: ReturnType<typeof setTimeout> | undefined
let pollRemaining = 0
onLoad((q) => {
  orderId.value = (q?.order_id as string) || ''
  pollPaid.value = q?.paid === '1'
  pollRemaining = pollPaid.value ? 10 : 0
})
onShow(load)
onUnload(() => {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = undefined
})

const tone = computed(() => order.value ? orderTone(order.value.status) : 'unknown')
const symbol = computed(() => {
  if (!order.value) return '✦'
  if (order.value.status === 'paid') return '✓'
  if (order.value.status === 'failed') return '!'
  if (order.value.status === 'refunded') return '↺'
  return '✦'
})

async function load() {
  if (loading.value) return
  error.value = ''
  if (!orderId.value) { order.value = null; error.value = '缺少订单号，请从本人订单列表打开'; return }
  loading.value = true
  try { order.value = await getOrderStatus(orderId.value); schedulePoll() }
  catch (e) { order.value = null; error.value = requestErrorMessage(e, '订单状态暂未查询成功，请稍后重试') }
  finally { loading.value = false }
}

/** 微信支付返回后，回调可能略晚于页面跳转；短轮询等待最终状态。 */
function schedulePoll() {
  if (!pollPaid.value || order.value?.status !== 'pending' || pollRemaining <= 0) return
  pollRemaining -= 1
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = setTimeout(() => {
    pollTimer = undefined
    if (order.value?.status === 'pending') void load()
  }, 2000)
}

async function simulatePay() {
  if (!orderId.value || devPaying.value || order.value?.status !== 'pending') return
  devPaying.value = true
  error.value = ''
  try {
    await devMarkOrderPaid(orderId.value)
    order.value = await getOrderStatus(orderId.value)
  } catch (e) { error.value = requestErrorMessage(e, '支付状态更新失败，请稍后重试') }
  finally { devPaying.value = false }
}

async function simulateFail() {
  if (!orderId.value || devFailing.value || order.value?.status !== 'pending') return
  devFailing.value = true
  error.value = ''
  try {
    await devMarkOrderFailed(orderId.value)
    order.value = await getOrderStatus(orderId.value)
  } catch (e) { error.value = requestErrorMessage(e, '支付状态更新失败，请稍后重试') }
  finally { devFailing.value = false }
}

function confirmRefund() {
  if (!orderId.value || devRefunding.value || order.value?.status !== 'paid') return
  uni.showModal({
    title: '标记退款？',
    content: '仅开发环境可用：订单将变为已退款，并收回已解锁权益。',
    confirmText: '标记退款',
    success: (res) => { if (res.confirm) void simulateRefund() },
  })
}

async function simulateRefund() {
  if (!orderId.value || devRefunding.value || order.value?.status !== 'paid') return
  devRefunding.value = true
  error.value = ''
  try {
    await devRefundOrder(orderId.value)
    order.value = await getOrderStatus(orderId.value)
  } catch (e) { error.value = requestErrorMessage(e, '退款状态更新失败，请稍后重试') }
  finally { devRefunding.value = false }
}

function goOrders() { uni.navigateTo({ url: '/pages/orders/orders' }) }
function goCatalog() { uni.reLaunch({ url: '/pages/pricing/pricing' }) }
</script>

<style scoped lang="scss">
.page-intro .h2 {
  margin: 12px 0 8px;
  font-weight: 700;
}

.mini-list {
  width: 100%;
}

.notice.ok {
  color: #2f7d4f;
}

.tone-paid .order-symbol {
  color: #2f7d4f;
}

.tone-failed .order-symbol {
  color: #b24a3f;
}

.tone-refunded .order-symbol {
  color: #a43b3b;
}
</style>
