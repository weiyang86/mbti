<template>
  <view class="page">
    <view class="panel">
      <text class="kicker">CONNECT / 换名片</text>
      <text class="title">名片交换本周未做</text>
      <text class="desc">双向名片交换与联系方式授权属于 CONNECT 深链路，接口契约里明确标为 OUT OF SCOPE；本页只作为底部导航占位，不代表功能已实现。</text>
      <view class="btn-secondary mt" @click="goHome">回测一测</view>
    </view>
  </view>
</template>

<script setup lang="ts">
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
  margin-top: 48rpx;
}
</style>
