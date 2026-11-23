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

      <view class="notice" :class="{ warn: tone === 'pending' || tone === 'failed', ok: tone === 'paid' }">
        {{ orderStatusHint(order.status) }}
      </view>

      <view v-if="order.status === 'pending' && devPaymentAvailable" class="notice">
        <text class="small">以下为本地开发模拟支付，不会产生真实扣款。</text>
        <button class="btn secondary full mt" :disabled="devPaying" @click="simulatePay">{{ devPaying ? '正在模拟支付…' : '模拟支付成功（仅开发环境）' }}</button>
      </view>

      <view v-if="order.status === 'pending'" class="mini-list">
        <button class="btn secondary full" :disabled="loading" @click="load">刷新支付状态</button>
      </view>
      <view v-else-if="order.status === 'failed'" class="mini-list">
        <button class="btn full" @click="goCatalog">重新选择商品</button>
      </view>
      <view v-else-if="order.status === 'paid'" class="mini-list">
        <button class="btn full" @click="goOrders">查看已解锁权益</button>
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
import { onLoad, onShow } from '@dcloudio/uni-app'
import StateView from '@/components/state-view.vue'
import { getOrderStatus, devMarkOrderPaid, devPaymentAvailable, type OrderStatus } from '@/api/payment'
import { requestErrorMessage } from '@/api/client'
import { isTerminalOrder, orderStatusHint, orderStatusLabel, orderTone, paymentAvailabilityLabel } from '@/utils/payment-display'

const orderId = ref('')
const order = ref<OrderStatus | null>(null)
const loading = ref(false)
const devPaying = ref(false)
const error = ref('')
onLoad((q) => { orderId.value = (q?.order_id as string) || '' })
onShow(load)

const tone = computed(() => order.value ? orderTone(order.value.status) : 'unknown')
const symbol = computed(() => {
  if (!order.value) return '✦'
  if (order.value.status === 'paid') return '✓'
  if (order.value.status === 'failed') return '!'
  return '✦'
})

async function load() {
  if (loading.value) return
  error.value = ''
  if (!orderId.value) { order.value = null; error.value = '缺少订单号，请从本人订单列表打开'; return }
  loading.value = true
  try { order.value = await getOrderStatus(orderId.value) }
  catch (e) { order.value = null; error.value = requestErrorMessage(e, '订单状态暂未查询成功，请稍后重试') }
  finally { loading.value = false }
}

async function simulatePay() {
  if (!orderId.value || devPaying.value || isTerminalOrder(order.value?.status || '')) return
  devPaying.value = true
  error.value = ''
  try {
    await devMarkOrderPaid(orderId.value)
    order.value = await getOrderStatus(orderId.value)
  } catch (e) { error.value = requestErrorMessage(e, '模拟支付失败，请稍后重试') }
  finally { devPaying.value = false }
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
</style>
