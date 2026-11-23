<template>
  <view class="page">
    <proto-nav />
    <DemoStrip />

    <view class="panel">
      <view class="profile-head">
        <image :src="avatarSrc" mode="aspectFill" />
        <view>
          <view class="h2">{{ displayName() }}</view>
          <view class="p">{{ typeLine }}</view>
        </view>
      </view>
      <view class="account-links">
        <view class="a" @click="goTab('/pages/history/list')">我的轨迹 →</view>
        <view class="a" @click="goResult">类型结果 →</view>
        <view class="a" @click="goTab('/pages/card/card')">我的名片 →</view>
        <view class="a" @click="go('/pages/exchanges/exchanges')">名片夹 →</view>
        <view class="a" @click="go('/pages/contacts/contacts')">联系方式 →</view>
      </view>
    </view>

    <view class="panel">
      <view class="h3">登录</view>
      <template v-if="account.session">
        <view class="p">已登录：{{ account.session.provider === 'wechat' ? '微信身份' : '开发 Mock 身份' }}</view>
        <view class="p fine">登录身份已绑定当前游客数据；换设备后需重新登录。</view>
        <button class="btn ghost full" @click="confirmLogoutSession">退出登录</button>
      </template>
      <template v-else>
        <view class="p">登录后，当前的测试记录、订单与名片会绑定到一个微信身份。</view>
        <button class="btn full" @click="goLogin">{{ authModeLabel }}</button>
      </template>
    </view>

    <view class="panel">
      <view class="h3">我的订单与权益</view>
      <view class="p fine">数据来自服务端订单与权益，不会产生真实扣款。</view>
      <view v-for="order in orders" :key="order.id" class="order">
        <view class="order-info">
          <text class="b">{{ productName(order.product_code) }}</text>
          <text class="small">{{ order.id }} · {{ orderStatusLabel(order.status) }}</text>
        </view>
        <text class="b order-price">{{ moneyLabel(order.amount, order.currency) }}</text>
        <text class="textbtn" @click="goOrder(order.id)">查看状态 →</text>
      </view>
      <view v-if="ordersError" class="p">{{ ordersError }}</view>
      <view v-if="!orders.length && !ordersError">
        <view class="p">暂无订单。</view>
        <text class="textbtn" @click="go('/pages/pricing/pricing')">看看我的 MBTI 晒图套装 →</text>
      </view>
      <text v-if="orders.length" class="textbtn" @click="go('/pages/orders/orders')">查看全部订单与权益 →</text>
    </view>

    <view class="panel">
      <view class="h3">资料与工具</view>
      <view class="mini-list">
        <button class="btn secondary full" @click="goTab('/pages/card/card')">管理公开范围</button>
        <button class="btn secondary full" @click="go('/pages/buddies/blocked')">管理屏蔽列表</button>
        <button class="btn ghost full" @click="go('/pages/test-intro/test-intro')">新增阶段记录 · 免费复测</button>
        <button class="btn ghost full" @click="toastDemo">兑换体验码</button>
        <button class="btn ghost full" @click="confirmReset">清除本机演示数据</button>
        <button class="btn ghost full" @click="toastDemo">产品介绍与 SOP ↗</button>
      </view>
    </view>

    <view class="p fine mt">
      本机进度可保存。 联系方式与照片仅保留在当前页面内存。
    </view>
  <proto-tabbar />
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { MyCard } from '@/api/types-social'
import type { ResultSnapshotSummary } from '@/api/types'
import { getMyCard } from '@/api/cards'
import { listResults } from '@/api/results'
import { getMyEntitlements, listOrders, type Entitlement, type Order } from '@/api/payment'
import { requestErrorMessage } from '@/api/client'
import { PLAN_NAMES } from '@/store/studio'
import { entitledTier, formatMoney, orderStatusLabel } from '@/utils/payment-display'
import {
  account,
  displayName,
  logout,
  logoutSession,
} from '@/store/account'
import { isRealAuth } from '@/api/auth'

const authModeLabel = computed(() => (isRealAuth() ? '微信一键登录' : 'Mock 登录（开发模式）'))

const PRODUCT_NAMES: Record<string, string> = {
  get studio_tier_1() { return PLAN_NAMES[1] },
  get studio_tier_2() { return PLAN_NAMES[2] },
}

const card = ref<MyCard | null>(null)
const latestResult = ref<ResultSnapshotSummary | null>(null)
const orders = ref<Order[]>([])
const entitlements = ref<Entitlement[]>([])
const ordersError = ref('')

const avatarSrc = computed(() => account.profile.avatar || '/static/share-style-illustration.webp')
const displayType = computed(() => card.value?.type_code || latestResult.value?.type_code || 'INFP')
const tier = computed(() => entitledTier(entitlements.value))
const typeLine = computed(() => `${displayType.value} · ${tier.value ? PLAN_NAMES[tier.value] : '免费基础用户'}`)

onShow(async () => {
  ordersError.value = ''
  await Promise.all([
    getMyCard().then((data) => { card.value = data }).catch(() => { card.value = null }),
    listResults({ limit: 1 })
      .then((res) => { latestResult.value = res.items[0] || null })
      .catch(() => { latestResult.value = null }),
    listOrders({ limit: 5 })
      .then((res) => { orders.value = res.items })
      .catch((e) => { orders.value = []; ordersError.value = requestErrorMessage(e, '读取本人订单失败，请重试') }),
    getMyEntitlements()
      .then((res) => { entitlements.value = res.items })
      .catch(() => { entitlements.value = [] }),
  ])
})

function productName(code: string) {
  return PRODUCT_NAMES[code] || code
}

function moneyLabel(amount: number, currency: string) {
  return formatMoney(amount, currency)
}

function goOrder(orderId: string) {
  uni.navigateTo({ url: `/pages/order-status/order-status?order_id=${encodeURIComponent(orderId)}` })
}

function goLogin() {
  uni.navigateTo({ url: '/pages/login/login' })
}

function confirmLogoutSession() {
  uni.showModal({
    title: '退出登录？',
    content: '本机测试记录、订单与名片仍保留；重新登录可继续使用。',
    confirmText: '退出',
    success: (res) => {
      if (!res.confirm) return
      logoutSession()
      uni.showToast({ title: '已退出登录', icon: 'none' })
    },
  })
}

function confirmReset() {
  uni.showModal({
    title: '清除本机演示数据？',
    content: '将清除本机保存的演示数据。',
    confirmText: '清除',
    success: (res) => {
      if (!res.confirm) return
      logout()
      uni.showToast({ title: '已清除', icon: 'none' })
    },
  })
}
function toastDemo() {
  uni.showToast({ title: '演示模式，未产生真实操作', icon: 'none' })
}

function goTab(url: string) {
  uni.switchTab({ url, fail: () => uni.reLaunch({ url }) })
}

function go(url: string) {
  uni.navigateTo({ url })
}

function goResult() {
  const id = latestResult.value?.id || card.value?.latest_result_id
  if (!id) {
    uni.showToast({ title: '还没有测试结果', icon: 'none' })
    return
  }
  uni.navigateTo({ url: `/pages/result/result?id=${encodeURIComponent(id)}` })
}
</script>

<style scoped>
.profile-head .h2 {
  font-weight: 700;
}

.panel .h3 {
  font-weight: 700;
}

.panel .p.fine {
  font-size: 10px;
  line-height: 1.7;
  margin-bottom: 10px;
}

.order-price {
  font-size: 14px;
}
</style>

