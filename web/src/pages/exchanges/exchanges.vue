<template>
  <view class="page exchanges-page">
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="demo-link" @click="showDemo">演示状态 ↗</text>
    </view>

    <text class="kicker">CARD WALLET / 名片夹</text>
    <text class="title">每次交换，</text>
    <text class="title"><text class="hl">都由双方选择。</text></text>
    <text class="sub">名片交换与联系方式交换是两次独立授权。</text>

    <view v-if="loading" class="state"><text class="state-text">正在读名片夹…</text></view>

    <view v-else-if="items.length === 0" class="empty">
      <text class="empty-mark">▣</text>
      <text class="empty-title">名片夹还空着</text>
      <text class="empty-desc">先向喜欢的示例搭子发出一张名片。</text>
      <view class="btn-primary mt" @click="goDiscover">去发现搭子</view>
    </view>

    <view v-else>
      <view v-for="item in items" :key="item.id" class="wallet-item">
        <view class="wallet-head">
          <text class="wallet-name">{{ item.buddy.nickname }} · {{ item.buddy.type_code }}</text>
          <text class="tag" :class="statusClass(item.status)">{{ statusLabel(item.status) }}</text>
        </view>
        <text class="wallet-line">{{ lineOf(item) }}</text>
        <text class="wallet-link" @click="goBuddy(item.buddy_id)">查看详情与交换设置 →</text>
      </view>
    </view>

    <view class="notice mt">
      撤销会停止应用内展示；正式服务无法收回对方已经保存或复制的内容。
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { CardExchange } from '@/api/types-social'
import { listCardExchanges } from '@/api/card-exchanges'
import { listContactRequests } from '@/api/contacts'

const items = ref<CardExchange[]>([])
const acceptedContactIds = ref<string[]>([])
const loading = ref(true)

onShow(async () => {
  loading.value = !items.value.length
  try {
    const [exchanges, requests] = await Promise.all([listCardExchanges(), listContactRequests()])
    items.value = exchanges.items
    acceptedContactIds.value = requests.items
      .filter((item) => item.status === 'accepted')
      .map((item) => item.buddy_id)
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
})

function statusLabel(status: CardExchange['status']) {
  if (status === 'accepted') return '已互换名片'
  if (status === 'pending') return '等待回应'
  if (status === 'declined') return '已拒绝'
  return '已撤销'
}

function statusClass(status: CardExchange['status']) {
  if (status === 'accepted') return 'green'
  if (status === 'declined') return 'rose'
  return ''
}

function lineOf(item: CardExchange) {
  if (acceptedContactIds.value.includes(item.buddy_id)) {
    return '联系方式已获双方授权 · 本次页面会话有效'
  }
  return '联系方式仍未公开'
}

function goBuddy(id: string) {
  uni.navigateTo({ url: `/pages/buddies/detail?id=${id}` })
}

function goDiscover() {
  uni.switchTab({ url: '/pages/discover/discover' })
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：名片夹记录保存在本机，不会与真实用户交换。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.exchanges-page {
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

.state {
  padding: 80rpx 0;
  text-align: center;
}
.state-text {
  font-size: 26rpx;
  color: #77727e;
}

.empty {
  margin-top: 56rpx;
  padding: 64rpx 32rpx;
  border-radius: 28rpx;
  border: 2rpx dashed #d7cbe7;
  background: rgba(255, 255, 255, 0.6);
  text-align: center;
}
.empty-mark {
  display: block;
  font-size: 44rpx;
  color: #b9a4da;
}
.empty-title {
  display: block;
  margin-top: 20rpx;
  font-size: 32rpx;
  font-weight: 700;
}
.empty-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #77727e;
}

.wallet-item {
  background: #fff;
  border: 2rpx solid #e7dfed;
  border-radius: 32rpx;
  padding: 34rpx;
  margin-top: 24rpx;
}
.wallet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}
.wallet-name {
  font-size: 28rpx;
  font-weight: 700;
  color: #292630;
}
.tag {
  font-size: 20rpx;
  padding: 8rpx 16rpx;
  border-radius: 14rpx;
  background: #eee9ff;
  color: #6d58b2;
  flex-shrink: 0;
}
.tag.green {
  background: #e3f4ec;
  color: #2f8f6b;
}
.tag.rose {
  background: #fbeaea;
  color: #b45555;
}
.wallet-line {
  display: block;
  font-size: 24rpx;
  color: #77727e;
  margin: 24rpx 0;
}
.wallet-link {
  display: inline-block;
  font-size: 24rpx;
  color: #7560df;
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
.mt {
  margin-top: 32rpx;
}
</style>
