<template>
  <view class="page">
    <proto-nav />
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="textbtn" @click="toastDemo">演示状态 ↗</text>
    </view>

    <view class="panel">
      <view class="h3">我的订单</view>
      <view class="p fine">不会产生真实扣款；刷新后可看到最新状态。</view>
      <text class="textbtn order-refresh" @click="refresh">刷新记录 →</text>

      <view v-if="ordersLoading && !orders.length" class="notice mt">正在读取订单…</view>
      <view v-if="ordersError" class="notice warn mt">{{ ordersError }}</view>

      <view v-for="order in orders" :key="order.id" class="order">
        <view class="order-info">
          <text class="b">{{ productName(order.product_code) }}</text>
          <text class="small">{{ order.id }} · {{ orderStatusLabel(order.status) }} · {{ order.unlocked ? '已解锁' : '未解锁' }}</text>
        </view>
        <text class="b order-price">{{ moneyLabel(order.amount) }}</text>
        <text class="textbtn" @click="openOrder(order.id)">查看 →</text>
      </view>

      <view v-if="ordersLoaded && !orders.length" class="order-empty">
        <view class="p">暂无模拟订单。</view>
        <text class="textbtn" @click="goCatalog">看看我的 MBTI 晒图套装 →</text>
      </view>

      <button v-if="nextCursor" class="btn secondary full mt" :disabled="ordersLoading" @click="loadOrders(false)">加载更多订单</button>
    </view>

    <view class="panel">
      <view class="h3">我的权益</view>
      <view class="p fine">待支付订单不会授予权益。</view>

      <view v-if="entitlementsLoading" class="notice mt">正在读取权益…</view>
      <view v-if="entitlementsError" class="notice warn mt">{{ entitlementsError }}</view>

      <view v-for="item in entitlements" :key="item.id" class="order">
        <view class="order-info">
          <text class="b">{{ productName(item.product_code) }}</text>
          <text class="small">{{ item.id }} · {{ item.status === 'active' ? '生效中' : item.status }} · 关联订单 {{ item.order_id }}</text>
        </view>
      </view>

      <view v-if="entitlementsLoaded && !entitlements.length" class="order-empty">
        <view class="p">暂无服务端权益。</view>
      </view>
    </view>

    <view class="mini-list">
      <button class="btn secondary full" @click="goCatalog">查看商品目录</button>
      <button class="btn ghost full" @click="goHome">返回首页</button>
    </view>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getMyEntitlements, listOrders, type Entitlement, type Order } from '@/api/payment'
import { requestErrorMessage } from '@/api/client'
import { orderStatusLabel } from '@/utils/payment-display'

const PRODUCT_NAMES: Record<string, string> = {
  studio_tier_1: 'MBTI 晒图套装',
  studio_tier_2: '本人形象套装',
}

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

function productName(code: string) {
  return PRODUCT_NAMES[code] || code
}

function moneyLabel(amount: number) {
  return `¥${(amount / 100).toFixed(1)}`
}

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
function toastDemo() { uni.showToast({ title: '演示模式，未产生真实操作', icon: 'none' }) }
</script>

<style scoped lang="scss">
.h3 {
  font-weight: 700;
}
.panel .p.fine {
  font-size: 10px;
  line-height: 1.7;
  margin: 0 0 10px;
}
.order-refresh {
  display: inline-block;
  margin: 0 0 6px;
  padding: 0;
  font-size: 10px;
}
.order-info {
  display: flex;
  flex-direction: column;
}
.order .textbtn {
  font-size: 10px;
}
.order-price {
  font-size: 14px;
}
.order-empty .p {
  margin: 0 0 13px;
}
.mini-list {
  width: 100%;
}
</style>
