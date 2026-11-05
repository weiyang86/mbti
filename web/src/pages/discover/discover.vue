<template>
  <view class="page placeholder-page">
    <text class="kicker">MEET YOUR TYPE / MBTI 搭子</text>
    <text class="title">换名片，<text class="hl">还没实现。</text></text>
    <text class="sub">名片推荐与交换需要真实契约支持，本期不展示示例用户。</text>

    <view class="placeholder-card">
      <text class="p-mark">未实现</text>
      <text class="p-title">「换名片」尚未接通</text>
      <text class="p-desc">等接口确认后再做推荐、同型雷达与双向交换，避免把模拟数据当成已完成。</text>
    </view>

    <view class="btn-primary mt" @click="goHome">回首页</view>

    <text class="foot">MBTI搭子 · 趣味人格探索</text>
  </view>
</template>

<script setup lang="ts">
function goHome() {
  uni.switchTab({ url: '/pages/index/index' })
}
</script>

<style scoped lang="scss">
.placeholder-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
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
  margin-top: 16rpx;
  font-size: 52rpx;
  font-weight: 800;
  line-height: 1.3;
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

.placeholder-card {
  margin-top: 36rpx;
  padding: 36rpx 28rpx;
  background: #fff;
  border: 2rpx dashed #d9cdf0;
  border-radius: 24rpx;
}
.p-mark {
  display: inline-block;
  font-size: 20rpx;
  color: #7560df;
  background: #f1ecfb;
  border-radius: 999rpx;
  padding: 4rpx 16rpx;
}
.p-title {
  display: block;
  margin-top: 16rpx;
  font-size: 30rpx;
  font-weight: 700;
}
.p-desc {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.6;
}

.mt {
  margin-top: 32rpx;
}

.foot {
  display: block;
  margin-top: 40rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
}
</style>
