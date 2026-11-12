<template>
  <view class="page account-page">
    <view class="profile-card">
      <image class="avatar" src="/static/share-style-illustration.webp" mode="aspectFill" />
      <view class="profile-body">
        <text class="name">{{ displayName }}</text>
        <text class="meta">{{ typeLine }}</text>
      </view>
    </view>

    <view class="pill-grid">
      <view class="pill" @click="goTab('/pages/history/list')">我的轨迹 →</view>
      <view class="pill" @click="goResult">类型结果 →</view>
      <view class="pill" @click="goTab('/pages/card/card')">我的名片 →</view>
      <view class="pill" @click="go('/pages/exchanges/exchanges')">名片夹 →</view>
      <view class="pill" @click="go('/pages/contacts/contacts')">联系方式 →</view>
    </view>

    <view class="panel">
      <text class="panel-title">我的订单与权益</text>
      <text class="panel-desc">不会产生真实扣款，刷新后可在本机恢复。</text>
      <text class="panel-link" @click="go('/pages/orders/orders')">查看订单与权益 →</text>
    </view>

    <view class="panel">
      <text class="panel-title">更多</text>
      <view class="more-row" @click="goTab('/pages/discover/discover')">
        <text>发现搭子</text>
        <text class="more-arrow">→</text>
      </view>
      <view class="more-row" @click="go('/pages/buddies/blocked')">
        <text>屏蔽管理</text>
        <text class="more-arrow">→</text>
      </view>
    </view>

    <text class="sk-foot">MBTI 搭子 · 原创趣味版 · 非官方测评</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { MyCard } from '@/api/types-social'
import { getMyCard } from '@/api/cards'

const card = ref<MyCard | null>(null)

const displayName = computed(() => card.value?.nickname?.trim() || '匿名搭子')
const typeLine = computed(() =>
  card.value?.type_code ? `${card.value.type_code} · 免费基础用户` : '还没有选择类型',
)

onShow(async () => {
  try {
    card.value = await getMyCard()
  } catch {
    card.value = null
  }
})

function goTab(url: string) {
  uni.switchTab({ url })
}

function go(url: string) {
  uni.navigateTo({ url })
}

function goResult() {
  const id = card.value?.latest_result_id
  if (!id) {
    uni.showToast({ title: '还没有测试结果', icon: 'none' })
    return
  }
  uni.navigateTo({ url: `/pages/result/result?id=${encodeURIComponent(id)}` })
}

</script>

<style scoped lang="scss">
@import '@/styles/page-frame.scss';

.account-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
  min-height: 100vh;
  box-sizing: border-box;
  background: #f8f7f4;
  color: #241f2e;
}

.profile-card {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 34rpx 30rpx;
  border-radius: 32rpx;
  background: #fff;
  border: 2rpx solid #ece7f1;
}
.avatar {
  width: 128rpx;
  height: 128rpx;
  border-radius: 32rpx;
  flex-shrink: 0;
}
.profile-body {
  flex: 1;
  min-width: 0;
}
.name {
  display: block;
  font-size: 42rpx;
  font-weight: 800;
  color: #241f2e;
}
.meta {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #a398af;
}

.pill-grid {
  margin-top: 22rpx;
}
.pill {
  font-size: 24rpx;
}

.more-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18rpx;
  padding: 22rpx 0;
  border-bottom: 2rpx solid #f3eef7;
  font-size: 24rpx;
  color: #4d4557;
}
.more-row:last-child {
  border-bottom: 0;
}
.more-arrow {
  color: #b9a4da;
}
</style>
