<template>
  <view class="page generation">
    <proto-nav />
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="textbtn" @click="demoInfo">演示状态 ↗</text>
    </view>

    <view class="gen-orb">✦</view>
    <view class="h2">正在准备你的 MBTI 晒图套装</view>
    <view class="p">组合个人信息与预置 AI 视觉素材</view>

    <view class="progress">
      <view class="i" :style="{ width: progress + '%' }" />
    </view>

    <view class="gen-steps">
      <view class="gen-step"><text>01 · 排好我的人格主图</text></view>
      <view class="gen-step"><text>02 · 准备同款头像与相处卡</text></view>
      <view class="gen-step"><text>03 · 整理分享配文</text></view>
    </view>

    <button class="btn secondary" @click="cancel">返回编辑</button>
  <proto-footer />
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

function demoInfo() {
  uni.showToast({ title: '演示模式，未产生真实操作', icon: 'none' })
}
</script>

<style scoped lang="scss">
.page.generation {
  padding-top: 93px;
  padding-bottom: 45px;
}
.generation .h2 {
  font-weight: 700;
  margin-bottom: 19px;
}
.gen-steps > .gen-step {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #a69aac;
}
</style>
