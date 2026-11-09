<template>
  <view class="page commerce-page">
    <text class="heading">订单状态</text>
    <text class="identifier">订单号：{{ orderId || '未提供' }}</text>
    <text v-if="loading" class="notice">正在查询本人订单…</text>
    <text v-if="error" class="error">{{ error }}</text>
    <view v-if="order" class="card mt">
      <text class="section">{{ orderStatusLabel(order.status) }}（{{ order.status }}）</text>
      <text class="identifier">服务端订单号：{{ order.order_id }}</text>
      <text class="line">订单解锁状态：{{ order.unlocked ? '已解锁' : '未解锁' }}</text>
      <text class="notice">{{ paymentAvailabilityLabel(order.payment_availability) }}</text>
      <text v-if="order.paid_at" class="line">支付时间：{{ order.paid_at }}</text>
      <text v-if="order.status === 'pending'" class="notice">订单仍待支付；创建订单不会自动获得权益。</text>
    </view>
    <button class="btn-secondary mt" :disabled="loading || !orderId" @click="load">重新查询同一订单</button>
    <button class="btn-primary mt" @click="goOrders">查看金额、本人订单与权益</button>
    <button class="btn-secondary mt" @click="goCatalog">返回商品目录</button>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getOrderStatus, type OrderStatus } from '@/api/payment'
import { requestErrorMessage } from '@/api/client'
import { orderStatusLabel, paymentAvailabilityLabel } from '@/utils/payment-display'

const orderId = ref('')
const order = ref<OrderStatus | null>(null)
const loading = ref(false)
const error = ref('')
onLoad((q) => { orderId.value = (q?.order_id as string) || '' })
onShow(load)

async function load() {
  if (loading.value) return
  order.value = null
  error.value = ''
  if (!orderId.value) { error.value = '缺少订单号，请从本人订单列表打开'; return }
  loading.value = true
  try { order.value = await getOrderStatus(orderId.value) }
  catch (e) { error.value = requestErrorMessage(e, '订单状态暂未查询成功，请稍后重试') }
  finally { loading.value = false }
}
function goOrders() { uni.navigateTo({ url: '/pages/orders/orders' }) }
function goCatalog() { uni.reLaunch({ url: '/pages/pricing/pricing' }) }
</script>

<style scoped lang="scss">
@import '@/styles/payment.scss';
</style>
