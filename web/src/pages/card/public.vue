<template>
  <view class="page public-page">
    <view v-if="loading" class="state"><text class="state-text">正在生成公开预览…</text></view>

    <view v-else-if="loadError" class="state">
      <text class="state-text">公开名片读取失败</text>
      <view class="btn-secondary mt" @click="load">重试</view>
    </view>

    <view v-else-if="!card || !card.type_code" class="state">
      <text class="state-text">还没有可以公开的名片</text>
      <view class="btn-primary mt" @click="goCard">先去生成名片</view>
    </view>

    <view v-else>
      <view class="demo-strip">
        <text>V0.4 · Mock 演示 · 不产生费用</text>
        <text class="demo-link" @click="showDemo">演示状态 ↗</text>
      </view>

      <text class="kicker">HELLO, THIS IS ME / 亮名片</text>
      <text class="title">认识我，</text>
      <text class="title"><text class="hl">从这张卡开始。</text></text>

      <!-- 形象名片：生成套装后替换基础名片 -->
      <view v-if="hasVisual" class="portrait">
        <image class="portrait-img" :src="styleAsset(card.style)" mode="aspectFill" />
        <view class="portrait-shade" />
        <view class="portrait-top">
          <text>MBTI搭子 / MY TYPE</text>
          <text>16 TYPES / 01 ME</text>
        </view>
        <view class="portrait-info">
          <text class="portrait-type">{{ card.type_code }}</text>
          <text class="portrait-name">{{ publicName }} · {{ card.type_name }}</text>
          <text class="portrait-quote">{{ quoteText }}</text>
          <view v-if="card.interests.length" class="tag-row portrait-tags">
            <text v-for="i in card.interests" :key="i" class="interest">{{ i }}</text>
          </view>
          <text class="portrait-tiny">AI 示例人物 · 趣味人格探索</text>
        </view>
      </view>

      <view v-else class="basic-type-card">
        <text class="card-kicker">MBTI BUDDY / 基础名片</text>
        <text class="card-type">{{ card.type_code }}</text>
        <text class="card-name">{{ publicName }} · {{ card.type_name }}</text>
        <text class="card-declaration">{{ quoteText }}</text>
        <view v-if="card.interests.length" class="tag-row">
          <text v-for="i in card.interests" :key="i" class="interest">{{ i }}</text>
        </view>
        <text class="card-small">联系方式仅在双方同意后单独交换</text>
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
        这里只展示公开名片，不含联系方式。当前是本机公开页预览。
      </view>

      <view class="btn-primary mt" @click="goDiscover">去交换一张 MBTI 名片</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { PublicCard } from '@/api/types-social'
import { getPublicCard } from '@/api/cards'
import { currentQuote, styleAsset, studio } from '@/store/studio'

const card = ref<PublicCard | null>(null)
const loading = ref(true)
const loadError = ref(false)

const hasVisual = computed(() => Boolean(studio.hasCard))
const publicName = computed(() => card.value?.nickname || '匿名搭子')
const quoteText = computed(() => card.value?.declaration || currentQuote(card.value?.type_code || 'INFP'))

onShow(() => {
  load()
})

async function load() {
  loading.value = !card.value
  loadError.value = false
  try {
    card.value = await getPublicCard('card_me')
  } catch {
    card.value = null
    loadError.value = true
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

.portrait {
  position: relative;
  margin-top: 36rpx;
  border-radius: 34rpx;
  overflow: hidden;
  aspect-ratio: 3 / 4;
  background: #2a2142;
  box-shadow: 0 24rpx 48rpx rgba(42, 33, 66, 0.22);
}
.portrait-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.portrait-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(20, 14, 34, 0.18) 0%, rgba(20, 14, 34, 0) 38%, rgba(20, 14, 34, 0.82) 100%);
}
.portrait-top {
  position: absolute;
  top: 26rpx;
  left: 28rpx;
  right: 28rpx;
  display: flex;
  justify-content: space-between;
  font-size: 16rpx;
  letter-spacing: 2rpx;
  color: rgba(255, 255, 255, 0.78);
}
.portrait-info {
  position: absolute;
  left: 30rpx;
  right: 30rpx;
  bottom: 28rpx;
}
.portrait-type {
  display: block;
  font-size: 88rpx;
  font-weight: 800;
  letter-spacing: -2rpx;
  line-height: 1.05;
  color: #fff;
}
.portrait-name {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  font-weight: 700;
  color: #fff;
}
.portrait-quote {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.86);
}
.portrait-tags .interest {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}
.portrait-tiny {
  display: block;
  margin-top: 20rpx;
  font-size: 16rpx;
  letter-spacing: 1rpx;
  color: rgba(255, 255, 255, 0.52);
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
