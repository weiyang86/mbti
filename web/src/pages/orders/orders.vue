<template>
  <view class="page commerce-page">
    <text class="heading">我的订单与权益</text>
    <text class="notice">当前游客身份下的服务端记录。受控测试订单不代表正式收费或正式权益交付。</text>
    <button class="btn-secondary" :disabled="ordersLoading || entitlementsLoading" @click="refresh">刷新本人记录</button>
    <text class="section">我的订单</text>
    <text v-if="ordersLoading" class="muted">正在读取订单…</text>
    <text v-if="ordersError" class="error">{{ ordersError }}</text>
    <text v-if="ordersLoaded && !orders.length" class="notice">暂无本人订单。</text>
    <view v-for="order in orders" :key="order.id" class="card mt">
      <text class="identifier">订单号：{{ order.id }}</text>
      <text class="line">商品：{{ order.product_code }}</text>
      <text class="price">{{ formatMoney(order.amount, order.currency) }}</text>
      <text class="notice">受控测试价格</text>
      <text class="line">{{ orderStatusLabel(order.status) }}（{{ order.status }}） · {{ order.unlocked ? '已解锁' : '未解锁' }}</text>
      <text class="notice">{{ paymentAvailabilityLabel(order.payment_availability) }}</text>
      <text class="identifier">结果编号：{{ order.result_id }}</text>
      <text class="line muted">创建时间：{{ order.created_at }}</text>
      <button class="btn-secondary mt" @click="openOrder(order.id)">查询此订单状态</button>
    </view>
    <button v-if="nextCursor" class="btn-secondary mt" :disabled="ordersLoading" @click="loadOrders(false)">加载更多订单</button>

    <text class="section">我的权益</text>
    <text v-if="entitlementsLoading" class="muted">正在读取权益…</text>
    <text v-if="entitlementsError" class="error">{{ entitlementsError }}</text>
    <text v-if="entitlementsLoaded && !entitlements.length" class="notice">暂无服务端权益。待支付订单不会授予权益。</text>
    <view v-for="item in entitlements" :key="item.id" class="card mt">
      <text class="line">{{ item.product_code }} · {{ item.status }}</text>
      <text class="notice">受控测试权益</text>
      <text class="identifier">关联订单：{{ item.order_id }}</text>
      <text class="identifier">结果编号：{{ item.result_id }}</text>
      <text class="line muted">授予时间：{{ item.granted_at }}</text>
    </view>
    <button class="btn-secondary mt" @click="goCatalog">查看商品目录</button>
    <button class="btn-secondary mt" @click="goHome">返回首页</button>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getMyEntitlements, listOrders, type Entitlement, type Order } from '@/api/payment'
import { requestErrorMessage } from '@/api/client'
import { formatMoney, orderStatusLabel, paymentAvailabilityLabel } from '@/utils/payment-display'

const orders = ref<Order[]>([])
const nextCursor = ref<string | null>(null)
const ordersLoading = ref(false)
const ordersLoaded = ref(false)
const ordersError = ref('')
const entitlements = ref<Entitlement[]>([])
const entitlementsLoading = ref(false)
const entitlementsLoaded = ref(false)
const entitlementsError = ref('')
onShow(refresh)

async function refresh() { await Promise.all([loadOrders(true), loadEntitlements()]) }

async function loadOrders(reset: boolean) {
  if (ordersLoading.value) return
  ordersLoading.value = true
  ordersError.value = ''
  if (reset) { orders.value = []; nextCursor.value = null; ordersLoaded.value = false }
  try {
    const response = await listOrders({ limit: 20, cursor: reset ? undefined : nextCursor.value || undefined })
    orders.value = reset ? response.items : [...orders.value, ...response.items.filter((item) => !orders.value.some((existing) => existing.id === item.id))]
    nextCursor.value = response.next_cursor
    ordersLoaded.value = true
  } catch (e) { ordersError.value = requestErrorMessage(e, '读取本人订单失败，请重试') }
  finally { ordersLoading.value = false }
}

async function loadEntitlements() {
  if (entitlementsLoading.value) return
  entitlementsLoading.value = true
  entitlementsLoaded.value = false
  entitlements.value = []
  entitlementsError.value = ''
  try {
    entitlements.value = (await getMyEntitlements()).items
    entitlementsLoaded.value = true
  } catch (e) { entitlementsError.value = requestErrorMessage(e, '权益状态尚未查询成功，请重试') }
  finally { entitlementsLoading.value = false }
}

function openOrder(id: string) { uni.navigateTo({ url: `/pages/order-status/order-status?order_id=${encodeURIComponent(id)}` }) }
function goCatalog() { uni.navigateTo({ url: '/pages/pricing/pricing' }) }
function goHome() { uni.reLaunch({ url: '/pages/index/index' }) }
</script>

<style scoped lang="scss">
@import '@/styles/payment.scss';
</style>
