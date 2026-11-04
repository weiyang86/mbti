<template>
  <view class="page discover-page">
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="demo-link" @click="showDemo">演示状态 ↗</text>
    </view>

    <text class="kicker">MEET YOUR TYPE / MBTI 搭子</text>
    <text class="title">先换张名片，</text>
    <text class="title">看看合不合拍。</text>
    <text class="sub">推荐依据是自选类型和兴趣。是否交换，由你们双方决定。</text>

    <view class="notice">
      当前以 {{ myType }} 示例类型体验。
      <text class="link" @click="goSelfSelect">选择我的 MBTI →</text>
    </view>

    <view class="shortcuts">
      <view class="shortcut" @click="showUnavailable('同型雷达')">
        <text class="s-mark">◎</text>
        <text class="s-title">同型雷达</text>
        <text class="s-desc">周边人数 · 模拟</text>
      </view>
      <view class="shortcut" @click="showUnavailable('相处小抄')">
        <text class="s-mark">✧</text>
        <text class="s-title">相处小抄</text>
        <text class="s-desc">看看彼此的偏好</text>
      </view>
    </view>

    <view class="tabs">
      <view class="tab" :class="{ active: filter === 'recommend' }" @click="filter = 'recommend'">
        <text>推荐搭子</text>
      </view>
      <view class="tab" :class="{ active: filter === 'same' }" @click="filter = 'same'">
        <text>同型优先</text>
      </view>
    </view>

    <view v-for="p in people" :key="p.id" class="buddy">
      <view class="avatar"><text>{{ p.type }}</text></view>
      <view class="buddy-body">
        <view class="buddy-top">
          <text class="name">{{ p.name }}</text>
          <text class="type">{{ p.type }}</text>
        </view>
        <text class="line">{{ p.line }}</text>
        <text class="meta">{{ p.type === myType ? '同型搭子' : '不同类型，也可以认识' }} · 示例用户</text>
      </view>
      <view class="exchange" @click="exchange(p)"><text>换名片</text></view>
      <text class="chev">↗</text>
    </view>

    <text class="foot">示例用户与推荐均为模拟数据 · 不包含真实联系方式</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { listResults } from '@/api/results'

interface Buddy {
  id: string
  name: string
  type: string
  line: string
}

const SAMPLES: Buddy[] = [
  { id: 'p1', name: '小禾', type: 'INFP', line: '喜欢散步和旧书店。' },
  { id: 'p2', name: '阿岚', type: 'ENFJ', line: '把每一次相遇都认真对待。' },
  { id: 'p3', name: '木木', type: 'ISTP', line: '周末在修一台旧相机。' },
  { id: 'p4', name: '小满', type: 'ENTP', line: '想法很多，正在找一个开始。' },
]

const filter = ref<'recommend' | 'same'>('recommend')
const myType = ref('INFP')

onShow(async () => {
  try {
    const res = await listResults({ limit: 1 })
    myType.value = res.items[0]?.type_code || 'INFP'
  } catch {
    myType.value = 'INFP'
  }
})

const people = computed(() =>
  filter.value === 'same' ? SAMPLES.filter((p) => p.type === myType.value) : SAMPLES,
)

function exchange(p: Buddy) {
  uni.showModal({
    title: `向 ${p.name} 发交换请求？`,
    content: '当前为演示环境，不会真实发送，也不包含任何联系方式。',
    confirmText: '模拟发送',
    success: (res) => {
      if (res.confirm) uni.showToast({ title: '已模拟发送', icon: 'none' })
    },
  })
}

function showUnavailable(name: string) {
  uni.showModal({
    title: `${name}本期未实现`,
    content: '该能力需要额外契约支持（雷达 LBS / 相处模板），当前只做入口占位。',
    showCancel: false,
    confirmText: '知道了',
  })
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：搭子列表为本地示例数据，不会真实发送名片或交换联系方式。',
    showCancel: false,
    confirmText: '知道了',
  })
}

function goSelfSelect() {
  uni.navigateTo({ url: '/pages/self-select/self-select' })
}
</script>

<style scoped lang="scss">
.discover-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
}

.demo-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 20rpx;
  color: #a398af;
  margin-bottom: 24rpx;
}
.demo-link {
  color: #7560df;
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
.title + .title {
  margin-top: 0;
}
.sub {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.6;
}

.notice {
  margin-top: 28rpx;
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  background: #f6f3fb;
  font-size: 22rpx;
  color: #77727e;
}
.link {
  color: #7560df;
}

.shortcuts {
  display: flex;
  gap: 20rpx;
  margin-top: 28rpx;
}
.shortcut {
  flex: 1;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 24rpx;
  padding: 24rpx;
}
.s-mark {
  display: block;
  font-size: 28rpx;
  color: #7560df;
}
.s-title {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  font-weight: 700;
}
.s-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 20rpx;
  color: #a398af;
}

.tabs {
  display: flex;
  gap: 8rpx;
  margin-top: 36rpx;
  padding: 8rpx;
  border-radius: 999rpx;
  background: #f1ecfb;
}
.tab {
  flex: 1;
  text-align: center;
  padding: 16rpx 0;
  border-radius: 999rpx;
  font-size: 24rpx;
  color: #77727e;
}
.tab.active {
  background: #fff;
  color: #292630;
  font-weight: 700;
}

.buddy {
  display: flex;
  align-items: center;
  margin-top: 20rpx;
  padding: 24rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 24rpx;
}
.avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background: linear-gradient(140deg, #8b6cf6, #dfff8b);
  color: #fff;
  font-size: 20rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 20rpx;
  flex-shrink: 0;
}
.buddy-body {
  flex: 1;
}
.buddy-top {
  display: flex;
  align-items: baseline;
}
.name {
  font-size: 28rpx;
  font-weight: 700;
}
.type {
  margin-left: 10rpx;
  font-size: 20rpx;
  color: #7560df;
}
.line {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #77727e;
}
.meta {
  display: block;
  margin-top: 8rpx;
  font-size: 20rpx;
  color: #a398af;
}
.exchange {
  font-size: 22rpx;
  color: #7560df;
  border: 2rpx solid #d9cdf0;
  border-radius: 999rpx;
  padding: 8rpx 18rpx;
}
.chev {
  margin-left: 10rpx;
  color: #b9a4da;
}

.foot {
  display: block;
  margin-top: 40rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
}
</style>
