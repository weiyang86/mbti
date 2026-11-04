<template>
  <view class="page">
    <view class="panel">
      <text class="kicker">ACCOUNT / 我的</text>
      <text class="title">账号中心本周未做</text>
      <text class="desc">微信登录、账号绑定与订单都不在接口草案内（登录为 TODO、支付为 OUT OF SCOPE）。本页只作为底部导航占位。</text>
      <view class="btn-secondary mt" @click="goHistory">看我的轨迹</view>
    </view>
  </view>
</template>

<script setup lang="ts">
function goHistory() {
  uni.switchTab({ url: '/pages/history/list' })
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
