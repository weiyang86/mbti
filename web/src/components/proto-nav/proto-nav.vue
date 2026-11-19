<template>
  <view class="host-nav">
    <button class="host-back" aria-label="返回上一页" @click="goBack">‹</button>
    <text class="host-title">{{ title }}</text>
    <button class="host-capsule" aria-label="切换平台预览" @click="switchChannel">
      <text>•••</text>
      <text class="host-divider"></text>
      <text>◎</text>
    </button>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'

const TITLES: Record<string, string> = {
  'pages/index/index': 'MBTI搭子',
  'pages/test-intro/test-intro': 'MBTI 趣味测试',
  'pages/quiz/quiz': '12 题 MBTI 趣味测试',
  'pages/self-select/self-select': '选择已有 MBTI',
  'pages/result/result': '我的 MBTI 结果',
  'pages/pricing/pricing': '我的 MBTI 晒图套装',
  'pages/create/create': '形象工作台',
  'pages/generating/generating': '制作我的 MBTI 形象',
  'pages/card/card': '我的 MBTI 名片',
  'pages/share-preview/share-preview': '晒出我的 MBTI',
  'pages/card/public': '亮出我的名片',
  'pages/discover/discover': '交换 MBTI 名片',
  'pages/buddies/detail': '搭子名片',
  'pages/contacts/contacts': '我的交换资料',
  'pages/contact-request/contact-request': '双向确认交换',
  'pages/contact-request/granted': '双向确认交换',
  'pages/exchanges/exchanges': '我的名片夹',
  'pages/radar/radar': '同型雷达 · Mock',
  'pages/compat/compat': 'MBTI 相处小抄',
  'pages/account/account': '我的',
  'pages/video/video': '视频分镜预览',
  'pages/history/list': '我的 MBTI 轨迹',
  'pages/history/detail': '阶段记录',
  'pages/compare/compare': '两次结果对比',
  'pages/journey-share/journey-share': '我的阶段分享图',
  'pages/orders/orders': '我的订单',
  'pages/order-status/order-status': '订单状态',
  'pages/buddies/blocked': '管理屏蔽列表',
}

const route = ref('pages/index/index')
const title = computed(() => TITLES[route.value] || 'MBTI搭子')

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

function switchChannel() {
  uni.showActionSheet({
    itemList: ['微信预览', '小红书预览', '抖音预览', '公众号预览'],
    success: (res) => {
      const names = ['微信', '小红书', '抖音', '公众号']
      uni.showToast({ title: `已切换为${names[res.tapIndex] || '微信'}预览（模拟）`, icon: 'none' })
    },
  })
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
.host-divider {
  width: 1px;
  height: 12px;
  background: #e2dbea;
}
</style>
