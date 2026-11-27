<template>
  <view class="page generation">
    <proto-nav />
    <DemoStrip />

    <view class="gen-orb">✦</view>
    <view class="h2">{{ GENERATION_COPY.title }}</view>
    <view class="p">{{ GENERATION_COPY.subtitle }}</view>

    <view class="progress">
      <view class="i" :style="{ width: progress + '%' }" />
    </view>

    <view class="gen-steps">
      <view v-for="step in GENERATION_COPY.steps" :key="step" class="gen-step"><text>{{ step }}</text></view>
    </view>

    <button class="btn secondary" @click="cancel">返回编辑</button>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
// TODO: 待 Remy 确认接口路径和字段（AI 形象生成任务接口未定义，当前为本地进度模拟，未上传照片）
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { ref } from 'vue'
import { markCardReady, studio } from '@/store/studio'
import { GENERATION_COPY } from '@/constants/copy'

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
  uni.showToast({ title: GENERATION_COPY.doneToast, icon: 'none' })
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
