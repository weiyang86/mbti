<template>
  <view class="host-nav">
    <button class="host-back" aria-label="返回上一页" @click="goBack">‹</button>
    <text class="host-title">{{ title }}</text>
    <view class="host-spacer" />
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { PAGE_TITLES } from '@/constants/copy'

const route = ref('pages/index/index')
const title = computed(() => PAGE_TITLES[route.value] || 'MBTI搭子')

onShow(() => {
  const pages = getCurrentPages()
  const current = pages[pages.length - 1]
  if (current?.route) route.value = String(current.route)
})

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
  } else {
    uni.switchTab({ url: '/pages/index/index', fail: () => uni.reLaunch({ url: '/pages/index/index' }) })
  }
}

</script>

<style scoped>
.host-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  max-width: 480px;
  margin: 0 auto;
  box-sizing: border-box;
}
.host-back {
  padding: 1px 6px;
  border-radius: 0;
}
.host-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
}
.host-spacer {
  width: 36px;
}
</style>
