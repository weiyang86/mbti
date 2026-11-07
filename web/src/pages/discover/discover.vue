<template>
  <view class="page discover-page">
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="demo-link" @click="showDemo">演示状态 ↗</text>
    </view>

    <text class="kicker">MEET YOUR TYPE / MBTI 搭子</text>
    <text class="title">先换张名片，</text>
    <text class="title"><text class="hl">看看合不合拍。</text></text>
    <text class="sub">推荐依据是自选类型和兴趣。是否交换，由你们双方决定。</text>

    <view class="exchange-shortcuts">
      <view class="shortcut" @click="goRadar">
        <text class="shortcut-title">◎ 同型雷达</text>
        <text class="shortcut-desc">周边人数 · 模拟</text>
      </view>
      <view class="shortcut" @click="goCompat">
        <text class="shortcut-title">✧ 相处小抄</text>
        <text class="shortcut-desc">看看彼此的偏好</text>
      </view>
    </view>

    <view v-if="!myCard?.type_code" class="notice mt">
      <text>当前以 INFP 示例类型体验。</text>
      <text class="notice-link" @click="goSelfSelect">选择我的 MBTI →</text>
    </view>

    <view class="buddy-tabs">
      <view class="tab" :class="{ active: mode === 'recommend' }" @click="switchMode('recommend')">
        <text>推荐搭子</text>
      </view>
      <view class="tab" :class="{ active: mode === 'same' }" @click="switchMode('same')">
        <text>同型 {{ myCard?.type_code || 'INFP' }}</text>
      </view>
      <text class="wallet-link" @click="goExchanges">
        名片夹{{ pendingCount ? ' ' + pendingCount : '' }}
      </text>
    </view>

    <view v-if="loading" class="state"><text class="state-text">正在找搭子…</text></view>

    <view v-else-if="loadError" class="state">
      <text class="state-text">搭子列表加载失败</text>
      <view class="btn-secondary mt" @click="load">重试</view>
    </view>

    <view v-else-if="items.length === 0" class="notice">
      {{ mode === 'same' ? '暂时没有同型的示例搭子，试试推荐搭子。' : '这一组示例搭子已被屏蔽，可以在“我的”中管理屏蔽列表。' }}
    </view>

    <view v-else>
      <view v-for="b in items" :key="b.id" class="buddy-tile" @click="goBuddy(b.id)">
        <view class="buddy-avatar" :style="{ background: b.avatar_color }">
          <text>{{ b.avatar_text }}</text>
        </view>
        <view class="buddy-body">
          <view class="buddy-name">
            <text class="name">{{ b.nickname }}</text>
            <text class="type">{{ b.type_code }}</text>
          </view>
          <text class="tagline">{{ b.tagline }}</text>
          <text class="meta">{{ metaLine(b) }}</text>
        </view>
        <text class="arrow">↗</text>
      </view>
    </view>

    <text class="fine">全部为虚构成年人资料。没有聊天、评论或自由发布动态的入口。</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { BuddySummary, MyCard } from '@/api/types-social'
import { listBuddies } from '@/api/buddies'
import { getMyCard } from '@/api/cards'
import { listCardExchanges } from '@/api/card-exchanges'

const myCard = ref<MyCard | null>(null)
const items = ref<BuddySummary[]>([])
const mode = ref<'recommend' | 'same'>('recommend')
const loading = ref(true)
const loadError = ref(false)
const pendingCount = ref(0)

onShow(load)

async function load() {
  loading.value = !items.value.length
  loadError.value = false
  try {
    myCard.value = await getMyCard()
    const [list, exchanges] = await Promise.all([
      listBuddies({
        mode: mode.value,
        type_code: myCard.value.type_code || 'INFP',
        limit: 20,
      }),
      listCardExchanges(),
    ])
    items.value = list.items
    pendingCount.value = exchanges.items.filter((item) => item.status === 'pending').length
  } catch {
    items.value = []
    pendingCount.value = 0
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function switchMode(next: 'recommend' | 'same') {
  if (mode.value === next) return
  mode.value = next
  loading.value = true
  loadError.value = false
  try {
    const list = await listBuddies({
      mode: next,
      type_code: myCard.value?.type_code || 'INFP',
      limit: 20,
    })
    items.value = list.items
  } catch {
    items.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function metaLine(b: BuddySummary) {
  if (b.same_type) return `同型搭子 · ${exchangeLabel(b)}`
  if (b.shared_interests.length) {
    return `共同兴趣：${b.shared_interests.join('、')} · ${exchangeLabel(b)}`
  }
  return `不同类型，也可以认识 · ${exchangeLabel(b)}`
}

function exchangeLabel(b: BuddySummary) {
  if (b.exchange_status === 'accepted') return '已交换名片'
  if (b.exchange_status === 'pending') return '名片申请待回应'
  return '示例用户'
}

function goBuddy(id: string) {
  uni.navigateTo({ url: `/pages/buddies/detail?id=${id}` })
}

function goExchanges() {
  uni.navigateTo({ url: '/pages/exchanges/exchanges' })
}

function goRadar() {
  uni.navigateTo({ url: '/pages/radar/radar' })
}

function goCompat() {
  uni.navigateTo({ url: '/pages/compat/compat' })
}

function goSelfSelect() {
  uni.navigateTo({ url: '/pages/self-select/self-select' })
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：示例搭子、名片交换与联系方式均为虚构数据，不会发送给真实用户。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.discover-page {
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

.kicker {
  display: block;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: #a398af;
  font-weight: 600;
}
.title {
  display: block;
  margin-top: 12rpx;
  font-size: 58rpx;
  font-weight: 800;
  line-height: 1.28;
  letter-spacing: -1rpx;
}
.hl {
  color: #7560df;
  border-bottom: 10rpx solid #dfff8b;
}
.sub {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.6;
}

.notice {
  display: block;
  background: #f5f3fa;
  border: 2rpx solid #e9e3f3;
  padding: 26rpx 30rpx;
  border-radius: 24rpx;
  color: #7c728b;
  font-size: 24rpx;
  line-height: 1.7;
}
.notice-link {
  color: #7560df;
  margin-left: 8rpx;
}
.mt {
  margin-top: 28rpx;
}

.exchange-shortcuts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20rpx;
  margin-top: 44rpx;
}
.shortcut {
  padding: 34rpx 26rpx;
  border: 2rpx solid #ded2ed;
  border-radius: 30rpx;
  background: #ede6f7;
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}
.shortcut-title {
  font-size: 28rpx;
  font-weight: 700;
  color: #6c4d8e;
}
.shortcut-desc {
  font-size: 22rpx;
  color: #96839e;
}

.buddy-tabs {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin: 40rpx 0 24rpx;
}
.tab {
  background: #eee7f5;
  color: #90779f;
  padding: 20rpx 26rpx;
  min-height: 84rpx;
  border-radius: 22rpx;
  font-size: 24rpx;
  display: flex;
  align-items: center;
}
.tab.active {
  background: #6c4cf3;
  color: #fff;
}
.wallet-link {
  margin-left: auto;
  font-size: 24rpx;
  color: #8d739f;
  padding: 12rpx;
}

.state {
  padding: 80rpx 0;
  text-align: center;
}
.state-text {
  font-size: 26rpx;
  color: #77727e;
}

.buddy-tile {
  background: #fff;
  border: 2rpx solid #e9e0f1;
  border-radius: 38rpx;
  padding: 34rpx 28rpx;
  display: flex;
  gap: 24rpx;
  align-items: flex-start;
  margin-bottom: 24rpx;
}
.buddy-avatar {
  width: 96rpx;
  height: 96rpx;
  flex: none;
  border-radius: 30rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 42rpx;
  color: #746380;
}
.buddy-body {
  min-width: 0;
  flex: 1;
}
.buddy-name {
  display: flex;
  align-items: center;
}
.name {
  font-size: 30rpx;
  font-weight: 700;
  color: #292630;
}
.type {
  font-size: 20rpx;
  color: #8f6daa;
  padding: 6rpx 12rpx;
  background: #f0e9f8;
  border-radius: 12rpx;
  margin-left: 10rpx;
}
.tagline {
  display: block;
  font-size: 22rpx;
  line-height: 1.7;
  margin-top: 12rpx;
  color: #292630;
}
.meta {
  display: block;
  font-size: 20rpx;
  color: #ac9ab8;
  margin-top: 6rpx;
}
.arrow {
  font-size: 32rpx;
  color: #baa7ca;
}

.fine {
  display: block;
  margin-top: 24rpx;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.7;
}
</style>
