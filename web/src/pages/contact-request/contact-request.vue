<template>
  <view class="page placeholder-page">
    <text class="placeholder-kicker">COMING SOON</text>
    <text class="placeholder-title">双向确认还没做</text>
    <text class="placeholder-desc">
      联系方式授权依赖 F5 接口，当前后端尚未就绪，这里不展示任何示例申请或授权结果。
    </text>
    <view class="btn-secondary placeholder-btn" @click="goHome">返回首页</view>
  </view>
</template>

<script setup lang="ts">
function goHome() {
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<style scoped lang="scss">
.placeholder-page {
  padding-top: 160rpx;
  text-align: center;
}
.placeholder-kicker {
  display: block;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: #a398af;
}
.placeholder-title {
  display: block;
  margin-top: 24rpx;
  font-size: 40rpx;
  font-weight: 800;
  color: #292630;
}
.placeholder-desc {
  display: block;
  margin: 24rpx auto 0;
  max-width: 520rpx;
  font-size: 24rpx;
  line-height: 1.8;
  color: #77727e;
}
.placeholder-btn {
  display: inline-block;
  margin-top: 48rpx;
  padding: 20rpx 48rpx;
}
</style>
