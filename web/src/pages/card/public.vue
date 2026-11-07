<template>
  <view class="page public-page">
    <view v-if="loading" class="state"><text class="state-text">正在生成公开预览…</text></view>

    <view v-else-if="!card || !card.type_code" class="state">
      <text class="state-text">还没有可以公开的名片</text>
      <view class="btn-primary mt" @click="goCard">先去生成名片</view>
    </view>

    <view v-else>
      <view class="demo-strip">
        <text>V0.4 · Mock 演示 · 不产生费用</text>
        <text class="demo-link" @click="showDemo">演示状态 ↗</text>
      </view>

      <text class="kicker">PUBLIC CARD / 亮名片</text>
      <text class="title">这是别人看到的</text>
      <text class="title"><text class="hl">你的名片。</text></text>
      <text class="sub">只包含你允许公开的字段，不含微信、QQ、电话。</text>

      <view class="basic-type-card">
        <text class="card-kicker">TYPE CARD / 基础名片</text>
        <text class="card-type">{{ card.type_code }}</text>
        <text class="card-type-name">{{ card.type_name }}</text>
        <text class="card-name">{{ card.nickname }} · {{ card.type_code }}</text>
        <text v-if="card.declaration" class="card-declaration">{{ card.declaration }}</text>
        <view v-if="card.interests.length" class="tag-row">
          <text v-for="i in card.interests" :key="i" class="interest">{{ i }}</text>
        </view>
        <text class="card-small">公开名片 · 不含联系方式</text>
      </view>

      <view v-if="card.manual" class="panel">
        <text class="panel-title">相处说明书</text>
        <view class="manual-row">
          <text class="manual-label">充电方式</text>
          <text class="manual-text">{{ card.manual.recharge }}</text>
        </view>
        <view class="manual-row">
          <text class="manual-label">沟通偏好</text>
          <text class="manual-text">{{ card.manual.communication }}</text>
        </view>
        <view class="manual-row">
          <text class="manual-label">被照顾的方式</text>
          <text class="manual-text">{{ card.manual.care }}</text>
        </view>
      </view>

      <view class="notice mt">
        关闭的字段不会出现在这里。换名片只是获得对方公开名片，不等于获得联系方式。
      </view>

      <view class="btn-primary mt" @click="goDiscover">去换一张 MBTI 名片</view>
      <view class="btn-ghost mt" @click="goCard">调整公开范围</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { PublicCard } from '@/api/types-social'
import { getPublicCard } from '@/api/cards'

const card = ref<PublicCard | null>(null)
const loading = ref(true)

onShow(() => {
  load()
})

async function load() {
  loading.value = !card.value
  try {
    card.value = await getPublicCard('card_me')
  } catch {
    card.value = null
  } finally {
    loading.value = false
  }
}

function goCard() {
  uni.switchTab({ url: '/pages/card/card' })
}

function goDiscover() {
  uni.switchTab({ url: '/pages/discover/discover' })
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：公开名片仅在本机生成，不会发布到真实平台。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.public-page {
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
  margin-top: 12rpx;
  font-size: 56rpx;
  font-weight: 800;
  line-height: 1.28;
  letter-spacing: -1rpx;
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

.state {
  padding-top: 220rpx;
  text-align: center;
}
.state-text {
  display: block;
  font-size: 28rpx;
  color: #77727e;
}

.basic-type-card {
  margin-top: 36rpx;
  padding: 42rpx 38rpx;
  border-radius: 34rpx;
  background: #e6e0ff;
  border: 2rpx solid #d5c9f7;
  color: #2c2550;
}
.card-kicker {
  display: block;
  font-size: 18rpx;
  letter-spacing: 3rpx;
  color: #7560df;
  font-weight: 700;
}
.card-type {
  display: block;
  font-size: 92rpx;
  font-weight: 800;
  letter-spacing: -2rpx;
  line-height: 1.1;
  margin-top: 18rpx;
}
.card-type-name {
  display: block;
  font-size: 24rpx;
  color: #6d58b2;
  margin-top: 6rpx;
}
.card-name {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  margin-top: 28rpx;
}
.card-declaration {
  display: block;
  font-size: 24rpx;
  line-height: 1.7;
  margin-top: 12rpx;
  color: #4b4268;
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 24rpx;
}
.interest {
  font-size: 20rpx;
  padding: 8rpx 18rpx;
  border-radius: 14rpx;
  background: rgba(255, 255, 255, 0.6);
  color: #6d58b2;
}
.card-small {
  display: block;
  margin-top: 28rpx;
  font-size: 18rpx;
  color: #7f6aa1;
}

.panel {
  margin-top: 28rpx;
  background: #fff;
  border: 2rpx solid #e9e3f1;
  border-radius: 28rpx;
  padding: 32rpx;
}
.panel-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: #292630;
  margin-bottom: 12rpx;
}
.manual-row {
  padding: 20rpx 0;
  border-bottom: 2rpx solid #f3eef7;
}
.manual-row:last-child {
  border-bottom: none;
}
.manual-label {
  display: block;
  font-size: 20rpx;
  color: #9c88ac;
  margin-bottom: 8rpx;
}
.manual-text {
  display: block;
  font-size: 24rpx;
  color: #292630;
  line-height: 1.7;
}

.notice {
  display: block;
  background: #f5f3fa;
  border: 2rpx solid #e9e3f3;
  padding: 26rpx 30rpx;
  border-radius: 24rpx;
  color: #7c728b;
  font-size: 24rpx;
  line-height: 1.7;
}

.btn-primary,
.btn-ghost {
  display: block;
  text-align: center;
  border-radius: 24rpx;
  padding: 24rpx;
  font-size: 28rpx;
  font-weight: 600;
}
.btn-primary {
  background: #6c4cf3;
  color: #fff;
}
.btn-ghost {
  background: transparent;
  color: #77727e;
  border: 2rpx solid #ece7f1;
}
.mt {
  margin-top: 24rpx;
}
</style>
