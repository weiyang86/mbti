<template>
  <view class="page">
    <proto-nav />
    <DemoStrip />

    <view class="panel">
      <view class="h3">我的订单</view>
      <view class="p fine">不会产生真实扣款；刷新后可看到最新状态。</view>
      <text class="textbtn order-refresh" @click="refresh">刷新记录 →</text>

      <StateView v-if="ordersLoading && !orders.length" state="loading" title="正在读取订单…" />
      <StateView v-else-if="ordersError && !orders.length" state="error" title="订单读取失败" :description="ordersError">
        <button class="btn secondary full" @click="loadOrders(true)">重新加载</button>
      </StateView>
      <text v-else-if="ordersError" class="error" role="alert">{{ ordersError }}（下方为上次读取结果）</text>

      <view v-for="order in orders" :key="order.id" class="order">
        <view class="order-info">
          <text class="b">{{ productName(order.product_code) }}</text>
          <text class="small">{{ order.id }} · {{ orderStatusLabel(order.status) }} · {{ order.unlocked ? '已解锁' : '未解锁' }}</text>
        </view>
        <text class="b order-price">{{ moneyLabel(order.amount) }}</text>
        <text class="textbtn" @click="openOrder(order.id)">查看 →</text>
      </view>

      <StateView v-if="ordersLoaded && !orders.length && !ordersError" state="empty" title="暂无模拟订单" description="完成一次 MBTI 测试后，可以在这里查看可购买的商品。">
        <button class="btn full" @click="goCatalog">看看我的 MBTI 晒图套装</button>
      </StateView>

      <button v-if="nextCursor" class="btn secondary full mt" :disabled="ordersLoading" @click="loadOrders(false)">加载更多订单</button>
    </view>

    <view class="panel">
      <view class="h3">我的权益</view>
      <view class="p fine">待支付订单不会授予权益。</view>

      <StateView v-if="entitlementsLoading" state="loading" title="正在读取权益…" />
      <StateView v-else-if="entitlementsError" state="error" title="权益读取失败" :description="entitlementsError">
        <button class="btn secondary full" @click="loadEntitlements">重新加载</button>
      </StateView>

      <view v-for="item in entitlements" :key="item.id" class="order">
        <view class="order-info">
          <text class="b">{{ productName(item.product_code) }}</text>
          <text class="small">{{ item.id }} · {{ item.status === 'active' ? '生效中' : item.status }} · 关联订单 {{ item.order_id }}</text>
        </view>
      </view>

      <StateView v-if="entitlementsLoaded && !entitlements.length" state="empty" title="暂无服务端权益" description="支付成功后可在此查看已解锁的权益。" />
    </view>

    <view class="mini-list">
      <button class="btn secondary full" @click="goCatalog">查看商品目录</button>
      <button class="btn ghost full" @click="goHome">返回首页</button>
    </view>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import StateView from '@/components/state-view.vue'
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
.error {
  display: block;
  margin: 10px 0;
  font-size: 11px;
  line-height: 1.7;
  color: #a43b3b;
}
.mini-list {
  width: 100%;
}
</style>
