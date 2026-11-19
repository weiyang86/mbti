<template>
  <view class="mobile-nav">
    <view
      v-for="item in items"
      :key="item.key"
      class="a"
      :class="{ active: current === item.key }"
      @click="go(item)"
    >
      <AppIcon :name="item.icon" :size="22" :color="current === item.key ? '#6854f5' : '#b5aabd'" />
      <text>{{ item.label }}</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import AppIcon from '@/components/AppIcon.vue'

const items = [
  { key: 'index', icon: 'spark', label: '测一测', url: '/pages/index/index' },
  { key: 'history', icon: 'history', label: '我的轨迹', url: '/pages/history/list' },
  { key: 'discover', icon: 'friends', label: '换名片', url: '/pages/discover/discover' },
  { key: 'card', icon: 'card', label: '我的名片', url: '/pages/card/card' },
  { key: 'account', icon: 'user', label: '我的', url: '/pages/account/account' },
]

const current = ref('index')

onShow(() => {
  const pages = getCurrentPages()
  const route = String(pages[pages.length - 1]?.route || '')
  if (route.includes('history')) current.value = 'history'
  else if (route.includes('discover')) current.value = 'discover'
  else if (route.includes('card')) current.value = 'card'
  else if (route.includes('account')) current.value = 'account'
  else current.value = 'index'
  uni.hideTabBar({ animation: false, fail: () => {} })
})

function go(item: { key: string; url: string }) {
  if (item.key === current.value) return
  uni.switchTab({ url: item.url })
}
</script>

<style scoped>
.mobile-nav {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-width: 480px;
  margin: 0 auto;
}
</style>
