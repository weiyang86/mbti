<template>
  <view class="page">
    <view class="panel">
      <text class="kicker">MY CARD / 我的名片</text>
      <text class="title">名片功能本周未做</text>
      <text class="desc">名片、头像与晒图套装的视觉生成不在本周带教范围，接口只有 `POST /share/preview` 的 stub；本页只作为底部导航占位。</text>
      <view class="btn-primary mt" @click="goShare">看晒图预览（先用最近结果）</view>
      <view class="btn-secondary mt" @click="goHome">回测一测</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { listResults } from '@/api/results'

async function goShare() {
  try {
    const res = await listResults({ limit: 1 })
    const latest = res.items[0]
    if (!latest) {
      uni.showToast({ title: '先测一次再晒图', icon: 'none' })
      return
    }
    uni.navigateTo({ url: `/pages/share-preview/share-preview?id=${latest.id}` })
  } catch {
    uni.showToast({ title: '暂时无法打开', icon: 'none' })
  }
}

function goHome() {
  uni.switchTab({ url: '/pages/index/index' })
}
</script>

<style scoped lang="scss">
.panel {
  margin-top: 64rpx;
  background: #fff;
  border-radius: 24rpx;
  padding: 40rpx 32rpx;
}
.kicker {
  display: block;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: #7560df;
}
.title {
  display: block;
  margin-top: 16rpx;
  font-size: 40rpx;
  font-weight: 700;
}
.desc {
  display: block;
  margin-top: 20rpx;
  font-size: 26rpx;
  line-height: 1.7;
  color: #77727e;
}
.mt {
  margin-top: 32rpx;
}
</style>
