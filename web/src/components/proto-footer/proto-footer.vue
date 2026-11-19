<template>
  <view v-if="visible" class="app-footer">
    <text class="span">MBTI搭子 · 原创趣味版 · 非官方测评</text>
    <text class="footer-link" @click="toast">演示中心</text>
    <text class="footer-link" @click="toast">产品 SOP ↗</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'

const route = ref('pages/index/index')
const HIDDEN = ['pages/quiz/quiz', 'pages/create/create', 'pages/generating/generating', 'pages/video/video']
const visible = computed(() => !HIDDEN.includes(route.value))

onShow(() => {
  const pages = getCurrentPages()
  const current = pages[pages.length - 1]
  if (current?.route) route.value = String(current.route)
})

function toast() {
  uni.showToast({ title: '演示模式，未产生真实操作', icon: 'none' })
}
</script>

<style scoped>
.footer-link {
  display: inline-block;
  font-size: 9px;
  line-height: 18px;
  color: #9b8bad;
  padding: 3px 6px;
}
</style>
