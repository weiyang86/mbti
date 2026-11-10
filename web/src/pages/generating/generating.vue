<template>
  <view class="page generation">
    <view class="demo-strip">
      <text>V0.4 · 趣味体验 · 不产生费用</text>
    </view>

    <view class="gen-orb">✦</view>
    <text class="gen-title">正在准备你的 MBTI 晒图套装</text>
    <text class="gen-sub">组合个人信息与预置 AI 视觉素材</text>

    <view class="progress"><view class="bar" :style="{ width: progress + '%' }" /></view>
    <text class="progress-num">{{ progress }}%</text>

    <view class="gen-steps">
      <view class="gen-step" :class="{ done: progress >= 20 }">
        <text class="step-no">01</text>
        <text class="step-text">排好我的人格主图</text>
      </view>
      <view class="gen-step" :class="{ done: progress >= 60 }">
        <text class="step-no">02</text>
        <text class="step-text">准备同款头像与相处卡</text>
      </view>
      <view class="gen-step" :class="{ done: progress >= 100 }">
        <text class="step-no">03</text>
        <text class="step-text">整理分享配文</text>
      </view>
    </view>

    <view class="btn-secondary mt" @click="cancel">返回编辑</view>
    <text class="foot">模拟生成过程，不会上传照片或产生真实费用。</text>
  </view>
</template>

<script setup lang="ts">
// TODO: 待 Remy 确认接口路径和字段（AI 形象生成任务接口未定义，当前为本地进度模拟，未上传照片）
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { markCardReady, studio } from '@/store/studio'

const progress = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

onLoad(() => {
  if (studio.tier === 0) {
    uni.redirectTo({ url: '/pages/pricing/pricing' })
    return
  }
  timer = setInterval(() => {
    progress.value = Math.min(100, progress.value + 20)
    if (progress.value >= 100) {
      finish()
    }
  }, 400)
})

onUnload(() => {
  clear()
})

function clear() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function finish() {
  clear()
  markCardReady()
  uni.showToast({ title: '晒图套装已准备好', icon: 'none' })
  setTimeout(() => {
    uni.switchTab({ url: '/pages/card/card' })
  }, 600)
}

function cancel() {
  clear()
  uni.navigateBack()
}
</script>

<style scoped lang="scss">
.generation {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
}

.demo-strip {
  font-size: 20rpx;
  color: #a398af;
  margin-bottom: 28rpx;
}

.gen-orb {
  width: 168rpx;
  height: 168rpx;
  margin: 120rpx auto 0;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #ffffff, #e5dbff 55%, #cbbcff);
  color: #7560df;
  font-size: 62rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 24rpx 60rpx rgba(117, 96, 223, 0.28);
}

.gen-title {
  display: block;
  margin-top: 54rpx;
  text-align: center;
  font-size: 38rpx;
  font-weight: 800;
  line-height: 1.5;
}
.gen-sub {
  display: block;
  margin-top: 12rpx;
  text-align: center;
  font-size: 23rpx;
  color: #77727e;
}

.progress {
  margin-top: 56rpx;
  height: 16rpx;
  border-radius: 999rpx;
  background: #ece7f5;
  overflow: hidden;
}
.bar {
  height: 100%;
  border-radius: 999rpx;
  background: linear-gradient(90deg, #8b6cf6, #7160e0);
  transition: width 0.35s ease;
}
.progress-num {
  display: block;
  margin-top: 12rpx;
  text-align: right;
  font-size: 20rpx;
  color: #8b8099;
}

.gen-steps {
  margin-top: 48rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 26rpx;
  padding: 10rpx 28rpx;
}
.gen-step {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 24rpx 0;
  border-bottom: 2rpx solid #f3eef7;
  opacity: 0.45;
}
.gen-step:last-child {
  border-bottom: none;
}
.gen-step.done {
  opacity: 1;
}
.step-no {
  font-size: 20rpx;
  color: #7560df;
  font-weight: 700;
}
.step-text {
  font-size: 24rpx;
  color: #292630;
}

.mt {
  margin-top: 48rpx;
}
.foot {
  display: block;
  margin-top: 28rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
}
</style>
