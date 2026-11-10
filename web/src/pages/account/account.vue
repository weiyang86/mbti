<template>
  <view class="page account-page">
    <view class="profile">
      <image class="avatar" src="/static/share-style-illustration.webp" mode="aspectFill" />
      <view class="profile-body">
        <text class="name">{{ displayName }}</text>
        <text class="meta">{{ typeLine }}</text>
      </view>
    </view>

    <view class="panel">
      <text class="panel-title">我的</text>
      <view class="link" @click="goTab('/pages/history/list')">我的轨迹 →</view>
      <view class="link" @click="goResult">类型结果 →</view>
      <view class="link" @click="goTab('/pages/card/card')">我的名片 →</view>
      <view class="link" @click="go('/pages/orders/orders')">我的订单与权益 →</view>
      <view class="link" @click="go('/pages/exchanges/exchanges')">我的名片夹 →</view>
      <view class="link" @click="go('/pages/buddies/blocked')">屏蔽管理 →</view>
      <view class="link" @click="goTab('/pages/discover/discover')">发现搭子 →</view>
    </view>

    <text class="fine">联系方式保存与同型统计仍在联调中，部分功能可能暂不可用。</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { MyCard } from '@/api/types-social'
import { getMyCard } from '@/api/cards'

const card = ref<MyCard | null>(null)

const displayName = computed(() => card.value?.nickname || '匿名搭子')
const typeLine = computed(() =>
  card.value ? `${card.value.type_code} · ${card.value.type_name}` : '还没有名片',
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
.account-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
}

.profile {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 36rpx 32rpx;
  background: #fff;
  border: 2rpx solid #ece7f1;
  border-radius: 32rpx;
}
.avatar {
  width: 120rpx;
  height: 120rpx;
  border-radius: 28rpx;
  flex-shrink: 0;
}
.profile-body {
  flex: 1;
  min-width: 0;
}
.name {
  display: block;
  font-size: 36rpx;
  font-weight: 800;
  color: #292630;
}
.meta {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #77727e;
}

.panel {
  margin-top: 24rpx;
  padding: 32rpx;
  background: #fff;
  border: 2rpx solid #ece7f1;
  border-radius: 32rpx;
}
.panel-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: #292630;
}
.link {
  padding: 28rpx 0;
  font-size: 26rpx;
  color: #4d4557;
  border-bottom: 2rpx solid #f3eef7;
}
.link:last-child {
  border-bottom: 0;
}

.fine {
  display: block;
  margin-top: 28rpx;
  padding: 0 8rpx;
  font-size: 20rpx;
  line-height: 1.7;
  color: #a398af;
}
</style>
