<template>
  <view class="page account-page">
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="demo-link" @click="showDemo">演示状态 ↗</text>
    </view>

    <view class="panel">
      <view class="profile-head">
        <image class="profile-avatar" :src="styleAsset(studio.style)" mode="aspectFill" />
        <view class="profile-body">
          <text class="profile-name">{{ displayName }}</text>
          <text class="profile-meta">{{ typeLine }}</text>
        </view>
      </view>

      <view class="account-links">
        <view v-for="link in links" :key="link.key" class="account-link" @click="onLink(link.key)">
          <text>{{ link.title }} →</text>
        </view>
      </view>
    </view>

    <view class="panel">
      <text class="panel-title">我的模拟订单</text>
      <text class="panel-fine">不会产生真实扣款，刷新后可在本机恢复。</text>
      <template v-if="orders.length">
        <view v-for="o in orders" :key="o.id" class="order">
          <view class="order-info">
            <text class="order-name">{{ orderName(o) }}</text>
            <text class="order-meta">{{ o.id }} · {{ statusText(o.status) }}</text>
          </view>
          <text class="order-amount">¥{{ o.amount.toFixed(1) }}</text>
          <text v-if="o.status === 'paid'" class="textbtn" @click="confirmRefund(o.id)">模拟售后</text>
        </view>
      </template>
      <template v-else>
        <text class="panel-text">暂无模拟订单。</text>
        <text class="textbtn" @click="goPricing">看看我的 MBTI 晒图套装 →</text>
      </template>
    </view>

    <view class="panel">
      <text class="panel-title">资料与工具</text>
      <view class="mini-list">
        <view class="btn-secondary" @click="openPrivacy">管理公开范围</view>
        <view class="btn-secondary" @click="manageBlocked">管理屏蔽列表（{{ blockedCount }}）</view>
        <view class="btn-ghost" @click="goRetake">新增阶段记录 · 免费复测</view>
        <view class="btn-ghost" @click="openRedeem">兑换体验码</view>
        <view class="btn-ghost" @click="resetDemo">清除本机演示数据</view>
      </view>
    </view>

    <text class="fine mt">
      {{ storageOK ? '本机进度可保存。' : '本机存储不可用，刷新后进度会丢失。' }}
      联系方式与照片仅保留在当前页面内存。
    </text>

    <!-- 公开范围 -->
    <view v-if="privacyOpen" class="modal-backdrop" @click="privacyOpen = false">
      <view class="modal-sheet" @click.stop>
        <view class="modal-head">
          <text class="modal-title">我的公开名片放什么？</text>
          <text class="modal-close" @click="privacyOpen = false">✕</text>
        </view>
        <view v-for="row in privacyRows" :key="row.key" class="toggle-row">
          <view class="toggle-text">
            <text class="toggle-name">{{ row.label }}</text>
            <text class="toggle-desc">{{ row.desc }}</text>
          </view>
          <view
            class="switch"
            :class="{ on: card?.visibility[row.key] }"
            @click="togglePrivacy(row.key)"
          >
            <view class="knob" />
          </view>
        </view>
        <text class="fine">设置仅控制应用内公开页与后续导出图。联系方式不在公开字段中。</text>
      </view>
    </view>

    <!-- 兑换体验码 -->
    <view v-if="redeemOpen" class="modal-backdrop" @click="redeemOpen = false">
      <view class="modal-sheet" @click.stop>
        <view class="modal-head">
          <text class="modal-title">兑换体验套装</text>
          <text class="modal-close" @click="redeemOpen = false">✕</text>
        </view>
        <text class="field-label">体验码</text>
        <input
          v-model="redeemInput"
          class="input"
          placeholder="输入体验码"
          maxlength="16"
          @confirm="doRedeem"
        />
        <text class="fine">演示码：MBTI099A / MBTI199B</text>
        <view class="btn-primary mt" @click="doRedeem">模拟兑换</view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { CardVisibility, MyCard } from '@/api/types-social'
import { getMyCard, updateMyCard } from '@/api/cards'
import { listBlockedBuddies, unblockBuddy } from '@/api/buddies'
import { resetDemoData } from '@/api/demo'
import {
  PLAN_NAMES,
  refundOrder,
  redeemCode,
  studio,
  styleAsset,
} from '@/store/studio'
import type { StudioOrder } from '@/store/studio'

type LinkKey = 'trail' | 'result' | 'card' | 'exchanges' | 'contacts'
type VisibilityKey = keyof CardVisibility

const card = ref<MyCard | null>(null)
const latestResultId = ref('')
const blockedCount = ref(0)
const privacyOpen = ref(false)
const redeemOpen = ref(false)
const redeemInput = ref('')
const storageOK = ref(true)

try {
  uni.setStorageSync('mbti_storage_probe', 1)
  uni.removeStorageSync('mbti_storage_probe')
} catch {
  storageOK.value = false
}

const links: { key: LinkKey; title: string }[] = [
  { key: 'trail', title: '我的轨迹' },
  { key: 'result', title: '类型结果' },
  { key: 'card', title: '我的名片' },
  { key: 'exchanges', title: '名片夹' },
  { key: 'contacts', title: '联系方式' },
]

const privacyRows: { key: VisibilityKey; label: string; desc: string }[] = [
  { key: 'name', label: '昵称', desc: '关闭后公开名片显示匿名搭子' },
  { key: 'interests', label: '兴趣标签', desc: '用于名片展示与推荐' },
  { key: 'manual', label: '相处小抄', desc: '只展示类型模板建议' },
]

const displayName = computed(() => card.value?.nickname || '小禾')

const typeLine = computed(() => {
  const type = card.value?.type_code || '尚未测试类型'
  const plan = studio.tier ? PLAN_NAMES[studio.tier] : '免费基础用户'
  return `${type} · ${plan}`
})

const orders = computed(() => studio.orders.slice().reverse())

function orderName(o: StudioOrder) {
  return o.tier ? PLAN_NAMES[o.tier] : 'MBTI 套装'
}

onShow(() => {
  load()
})

async function load() {
  try {
    const [myCard, blocked] = await Promise.all([getMyCard(), listBlockedBuddies()])
    card.value = myCard
    latestResultId.value = myCard.latest_result_id || ''
    blockedCount.value = blocked.items.length
  } catch {
    card.value = null
  }
}

function statusText(status: 'paid' | 'failed' | 'refunded') {
  if (status === 'refunded') return '模拟已退款'
  if (status === 'failed') return '模拟失败'
  return '模拟已购'
}

function onLink(key: LinkKey) {
  if (key === 'trail') {
    uni.switchTab({ url: '/pages/history/list' })
    return
  }
  if (key === 'result') {
    if (!latestResultId.value) {
      uni.showToast({ title: '还没有测试结果', icon: 'none' })
      return
    }
    uni.navigateTo({ url: `/pages/result/result?id=${latestResultId.value}` })
    return
  }
  if (key === 'card') {
    uni.switchTab({ url: '/pages/card/card' })
    return
  }
  if (key === 'exchanges') {
    uni.navigateTo({ url: '/pages/exchanges/exchanges' })
    return
  }
  uni.navigateTo({ url: '/pages/contacts/contacts' })
}

function goRetake() {
  uni.navigateTo({ url: '/pages/test-intro/test-intro' })
}

function goPricing() {
  uni.navigateTo({ url: '/pages/pricing/pricing' })
}

function confirmRefund(id: string) {
  uni.showModal({
    title: '模拟售后处理',
    content: '确认后记录模拟退款，并按剩余有效订单恢复权益。不会发生真实资金交易。',
    confirmText: '确认模拟退款',
    cancelText: '取消',
    success: (res) => {
      if (!res.confirm) return
      if (!refundOrder(id)) {
        uni.showToast({ title: '这份订单暂不可退款', icon: 'none' })
        return
      }
      uni.showToast({ title: '已记录模拟退款', icon: 'none' })
    },
  })
}

function openPrivacy() {
  privacyOpen.value = true
}

async function togglePrivacy(key: VisibilityKey) {
  if (!card.value) return
  const next = !card.value.visibility[key]
  try {
    card.value = await updateMyCard({ visibility: { [key]: next } })
  } catch {
    uni.showToast({ title: '保存失败，请稍后再试', icon: 'none' })
  }
}

function openRedeem() {
  redeemInput.value = ''
  redeemOpen.value = true
}

function doRedeem() {
  const result = redeemCode(redeemInput.value)
  if (!result.ok) {
    uni.showToast({ title: result.message, icon: 'none' })
    return
  }
  redeemOpen.value = false
  redeemInput.value = ''
  uni.showToast({ title: result.message, icon: 'none' })
}

async function manageBlocked() {
  try {
    const res = await listBlockedBuddies()
    if (!res.items.length) {
      uni.showToast({ title: '暂无屏蔽的搭子', icon: 'none' })
      return
    }
    uni.showActionSheet({
      itemList: res.items.map((item) => `解除屏蔽 ${item.nickname}`),
      success: async ({ tapIndex }) => {
        const target = res.items[tapIndex]
        if (!target) return
        await unblockBuddy(target.id)
        await load()
        uni.showToast({ title: '已解除屏蔽', icon: 'none' })
      },
    })
  } catch {
    uni.showToast({ title: '读取失败，请稍后再试', icon: 'none' })
  }
}

function resetDemo() {
  uni.showModal({
    title: '清除本机演示数据？',
    content: '会清除名片交换、联系方式与公开范围设置，测试结果仍然保留。',
    confirmText: '清除',
    success: async (res) => {
      if (!res.confirm) return
      resetDemoData()
      await load()
      uni.showToast({ title: '已清除', icon: 'none' })
    },
  })
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：所有社交数据与订单都保存在本机，不会与真实用户交换，也不产生费用。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.account-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
}

.demo-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 20rpx;
  color: #a398af;
  margin-bottom: 24rpx;
}
.demo-link {
  color: #7560df;
}

.panel {
  margin-top: 20rpx;
  background: #fff;
  border: 2rpx solid #ece7f1;
  border-radius: 36rpx;
  padding: 40rpx 36rpx;
  box-sizing: border-box;
}
.panel:first-of-type {
  margin-top: 0;
}
.panel-title {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  color: #292630;
}
.panel-fine {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #a398af;
  line-height: 1.6;
}
.panel-text {
  display: block;
  font-size: 24rpx;
  color: #77727e;
  margin-top: 16rpx;
}

.profile-head {
  display: flex;
  align-items: center;
  gap: 30rpx;
  margin-bottom: 40rpx;
}
.profile-avatar {
  width: 130rpx;
  height: 130rpx;
  border-radius: 38rpx;
  flex-shrink: 0;
}
.profile-body {
  flex: 1;
  min-width: 0;
}
.profile-name {
  display: block;
  font-size: 50rpx;
  font-weight: 800;
  color: #292630;
  line-height: 1.2;
}
.profile-meta {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #77727e;
}

.account-links {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18rpx;
}
.account-link {
  background: #f1ecf8;
  border-radius: 18rpx;
  padding: 24rpx;
  font-size: 24rpx;
  color: #856899;
  box-sizing: border-box;
}

.order {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 20rpx;
  padding: 30rpx 0;
  border-bottom: 2rpx solid #f3eef7;
}
.order:last-child {
  border-bottom: none;
}
.order-info {
  flex: 1;
  min-width: 260rpx;
}
.order-name {
  display: block;
  font-size: 26rpx;
  font-weight: 700;
  color: #292630;
}
.order-meta {
  display: block;
  margin-top: 6rpx;
  font-size: 20rpx;
  color: #a398af;
}
.order-amount {
  font-size: 26rpx;
  font-weight: 700;
  color: #292630;
}
.textbtn {
  font-size: 22rpx;
  color: #7560df;
  padding: 4rpx;
}

.mini-list {
  display: grid;
  gap: 20rpx;
  margin-top: 28rpx;
}
.btn-secondary,
.btn-ghost {
  display: block;
  text-align: center;
  border-radius: 24rpx;
  padding: 24rpx;
  font-size: 26rpx;
  font-weight: 600;
  box-sizing: border-box;
}
.btn-secondary {
  background: #fff;
  color: #292630;
  border: 2rpx solid #ece7f1;
}
.btn-ghost {
  background: transparent;
  color: #77727e;
  border: 2rpx solid #ece7f1;
}
.btn-primary {
  display: block;
  text-align: center;
  border-radius: 24rpx;
  padding: 24rpx;
  font-size: 28rpx;
  font-weight: 600;
  background: #6c4cf3;
  color: #fff;
}

.fine {
  display: block;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.7;
  margin-top: 20rpx;
}
.mt {
  margin-top: 28rpx;
}

.modal-backdrop {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 1000;
  background: rgba(43, 33, 51, 0.37);
  display: flex;
  align-items: flex-end;
}
.modal-sheet {
  width: 100%;
  background: #fff;
  border-radius: 32rpx 32rpx 0 0;
  padding: 36rpx 32rpx calc(48rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}
.modal-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #292630;
}
.modal-close {
  font-size: 30rpx;
  color: #a398af;
  padding: 8rpx 12rpx;
}

.toggle-row {
  display: flex;
  justify-content: space-between;
  gap: 24rpx;
  align-items: center;
  padding: 28rpx 0;
  border-bottom: 2rpx solid #f3eef7;
}
.toggle-text {
  flex: 1;
  min-width: 0;
}
.toggle-name {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: #292630;
}
.toggle-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #a398af;
}
.switch {
  position: relative;
  width: 80rpx;
  height: 48rpx;
  flex-shrink: 0;
  background: #ddd6e6;
  border-radius: 40rpx;
}
.switch.on {
  background: #6c4cf3;
}
.knob {
  position: absolute;
  width: 36rpx;
  height: 36rpx;
  top: 6rpx;
  left: 6rpx;
  border-radius: 50%;
  background: #fff;
  transition: left 0.2s;
}
.switch.on .knob {
  left: 38rpx;
}

.field-label {
  display: block;
  font-size: 24rpx;
  font-weight: 600;
  color: #292630;
  margin-bottom: 14rpx;
}
.input {
  width: 100%;
  box-sizing: border-box;
  border: 2rpx solid #ece7f1;
  border-radius: 24rpx;
  background: #fff;
  padding: 24rpx 28rpx;
  min-height: 90rpx;
  font-size: 30rpx;
  color: #292630;
}
</style>
