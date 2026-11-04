<template>
  <view class="page">
    <view class="hero card">
      <text class="eyebrow">TEST · CREATE · CONNECT</text>
      <text class="h1">MBTI搭子</text>
      <text class="lead muted">趣味倾向体验，非临床测评。带教闭环：测 → 结果 → 晒预览 → 阶段记录。</text>
    </view>

    <view class="actions">
      <view class="btn-primary" @click="startQuiz">测一测（12 题）</view>
      <view class="btn-secondary mt" @click="goSelfSelect">我已经知道类型</view>
      <view class="btn-secondary mt" @click="goHistory">阶段记录</view>
    </view>

    <text class="muted foot">API 契约：draft / pending Remy 定稿 · mock 模式默认开启</text>
  </view>
</template>

<script setup lang="ts">
import { createQuizSession } from '@/api/quiz'

async function startQuiz() {
  try {
    const session = await createQuizSession()
    uni.navigateTo({ url: `/pages/quiz/quiz?sessionId=${session.id}` })
  } catch (e) {
    uni.showToast({ title: '无法开始测验', icon: 'none' })
  }
}

function goSelfSelect() {
  uni.navigateTo({ url: '/pages/self-select/self-select' })
}

function goHistory() {
  uni.navigateTo({ url: '/pages/history/list' })
}
</script>

<style scoped lang="scss">
.hero {
  margin-bottom: 48rpx;
}
.eyebrow {
  font-size: 22rpx;
  letter-spacing: 4rpx;
  color: #7560df;
}
.h1 {
  display: block;
  font-size: 56rpx;
  font-weight: 700;
  margin: 16rpx 0;
}
.lead {
  display: block;
  line-height: 1.7;
}
.actions {
  display: flex;
  flex-direction: column;
}
.mt {
  margin-top: 24rpx;
}
.foot {
  display: block;
  margin-top: 64rpx;
  text-align: center;
}
</style>
