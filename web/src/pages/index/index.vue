<template>
  <view class="page home">
    <view class="brand-row">
      <view class="brand-left">
        <view class="badge"><text>16</text><text class="plus">+</text></view>
        <text class="brand-name">MBTI搭子</text>
      </view>
      <text class="chip" @click="showChannels">微信预览 ⌄</text>
    </view>

    <text class="kicker">MBTI TEST × PERSONALITY CARD</text>
    <text class="h1">你的 MBTI，</text>
    <text class="h1"><text class="hl">值得一张主角卡。</text></text>
    <text class="sub">测出你的类型，晒出专属形象，遇见同频搭子。</text>

    <view class="cover">
      <image class="cover-img" src="/static/cover-illustration.webp" mode="aspectFill" />
      <view class="cover-shade" />
      <view class="cover-top">
        <text>MY MBTI / MY MAIN CHARACTER</text>
        <text>{{ coverIndex }}</text>
      </view>
      <view class="stamp"><text>今日人设</text><text>我来晒</text></view>
      <view class="cover-bottom">
        <text class="cover-type">{{ coverType }}</text>
        <text class="cover-name">{{ coverName }}</text>
        <text class="cover-quote">{{ coverQuote }}</text>
      </view>
    </view>

    <view class="entry">
      <view class="btn-primary" @click="startQuiz">免费测测我的 MBTI</view>
      <text class="quick" @click="goSelfSelect">已经知道类型？直接做专属名片 →</text>
      <text class="fine">12 题趣味版 · 非官方量表 · 基础结果免费</text>
    </view>

    <view class="scenes">
      <view class="scene" @click="goPricing">
        <text class="scene-mark">↗</text>
        <text class="scene-title">发漂亮朋友圈</text>
        <text class="scene-desc">看 ¥9.9 晒图套装</text>
      </view>
      <view class="scene" @click="goDiscover">
        <text class="scene-mark">⇄</text>
        <text class="scene-title">交换 MBTI 名片</text>
        <text class="scene-desc">遇见相同与不同的你</text>
      </view>
    </view>

    <view class="journey-entry" @click="goHistory">
      <view class="journey-main">
        <text class="journey-kicker">MY MBTI JOURNEY</text>
        <text class="journey-title">{{ resultCount ? '看看不同阶段的我' : '给现在的自己，留一个起点。' }}</text>
        <text class="journey-desc">
          {{ resultCount
            ? '已留存 ' + resultCount + ' 次结果' + (latest ? ' · 最近 ' + latest.submitted_at.slice(0, 10) : '')
            : '免费复测 · 私密记录 · 前后对比' }}
        </text>
      </view>
      <text class="journey-arrow">↗</text>
    </view>

    <view class="mini-tools">
      <view class="mini-tools-head">
        <text class="mini-tools-title">MBTI 的另一种打开方式</text>
        <text class="tag">小应用</text>
      </view>
      <view class="tool-grid">
        <view class="tool-tile radar-tile" @click="goRadar">
          <text class="tool-icon">◎</text>
          <text class="tool-name">同型雷达</text>
          <text class="tool-desc">周边 500 米</text>
          <text class="tool-desc">有多少同型搭子？</text>
          <text class="tool-note">人数为模拟数据 ↗</text>
        </view>
        <view class="tool-tile" @click="goCompat">
          <text class="tool-icon">✧</text>
          <text class="tool-name">相处小抄</text>
          <text class="tool-desc">{{ compatTileLine }}</text>
          <text class="tool-desc">找个舒服的相处方式</text>
          <text class="tool-note">趣味建议，无配对分数 ↗</text>
        </view>
      </view>
    </view>

    <text class="demo-fine">V0.4 交互原型 · 人物、订单、推荐与附近人数均为示例</text>
    <text class="foot">MBTI搭子 · 原创趣味版 · 非官方测评</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { ResultSnapshotSummary } from '@/api/types'
import { listResults } from '@/api/results'
import { TYPE_NAMES, DECLARATIONS } from '@/constants/types'
import { DEFAULT_COMPARE_TYPE } from '@/constants/compat'

function profileName(): string {
  try {
    const raw = uni.getStorageSync('mbti_test_profile_v1')
    if (raw && typeof raw === 'object' && typeof raw.name === 'string' && raw.name.trim()) {
      return raw.name.trim()
    }
  } catch {
    /* ignore */
  }
  return '小禾'
}

const latest = ref<ResultSnapshotSummary | null>(null)
const resultCount = ref(0)

onShow(async () => {
  try {
    const res = await listResults({ limit: 50 })
    resultCount.value = res.items.length
    latest.value = res.items[0] || null
  } catch {
    latest.value = null
    resultCount.value = 0
  }
})

const coverIndex = computed(() => (latest.value ? '001' : '000'))

const coverType = computed(() => latest.value?.type_code || '----')

const coverName = computed(() =>
  latest.value
    ? `${TYPE_NAMES[latest.value.type_code] || 'MBTI'} / ${profileName()}`
    : '还没测过，先测一次',
)

const coverQuote = computed(() =>
  latest.value
    ? DECLARATIONS[latest.value.type_code] || '四个字母之外，还有不一样的你。'
    : '测完这里会换成你的类型和一句话人设。',
)

const compatTileLine = computed(() =>
  latest.value ? `${latest.value.type_code} × ${DEFAULT_COMPARE_TYPE}` : '和不同 MBTI',
)

function startQuiz() {
  uni.navigateTo({ url: '/pages/test-intro/test-intro' })
}

function goSelfSelect() {
  uni.navigateTo({ url: '/pages/self-select/self-select' })
}

function goPricing() {
  uni.navigateTo({ url: '/pages/pricing/pricing' })
}

function goHistory() {
  uni.switchTab({ url: '/pages/history/list' })
}

function goDiscover() {
  uni.switchTab({ url: '/pages/discover/discover' })
}

function goRadar() {
  uni.navigateTo({ url: '/pages/radar/radar' })
}

function goCompat() {
  uni.navigateTo({ url: '/pages/compat/compat' })
}

function showChannels() {
  uni.showModal({
    title: '预览渠道',
    content: '微信小程序 · 小红书小程序 · 抖音小程序 · 公众号 H5\n当前为演示版本，仅展示微信预览效果。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.home {
  padding-top: 32rpx;
  padding-bottom: 48rpx;
}

.brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand-left {
  display: flex;
  align-items: center;
}
.badge {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: linear-gradient(140deg, #8b6cf6, #6c53f5);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  font-weight: 700;
}
.plus {
  font-size: 18rpx;
  margin-left: 2rpx;
}
.brand-name {
  margin-left: 12rpx;
  font-size: 30rpx;
  font-weight: 700;
}
.chip {
  font-size: 22rpx;
  color: #77727e;
  background: #eeeaf3;
  border-radius: 999rpx;
  padding: 8rpx 20rpx;
}

.kicker {
  display: block;
  margin-top: 40rpx;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: #a398af;
  font-weight: 600;
}
.h1 {
  display: block;
  font-size: 68rpx;
  font-weight: 800;
  line-height: 1.24;
  letter-spacing: -2rpx;
  margin-top: 12rpx;
}
.hl {
  color: #7560df;
  border-bottom: 12rpx solid #dfff8b;
}
.sub {
  display: block;
  margin-top: 20rpx;
  font-size: 26rpx;
  color: #a398af;
}

.cover {
  position: relative;
  margin-top: 36rpx;
  height: 640rpx;
  border-radius: 32rpx;
  overflow: hidden;
  box-shadow: 0 24rpx 60rpx rgba(49, 33, 77, 0.18);
}
.cover-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
.cover-shade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 62%;
  background: linear-gradient(180deg, rgba(20, 12, 40, 0) 0%, rgba(20, 12, 40, 0.82) 100%);
}
.cover-top {
  position: absolute;
  left: 32rpx;
  right: 32rpx;
  top: 28rpx;
  display: flex;
  justify-content: space-between;
  font-size: 18rpx;
  letter-spacing: 2rpx;
  color: rgba(255, 255, 255, 0.8);
}
.stamp {
  position: absolute;
  right: 32rpx;
  top: 96rpx;
  width: 140rpx;
  height: 140rpx;
  border-radius: 50%;
  background: rgba(223, 255, 139, 0.9);
  color: #4a3a86;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 20rpx;
  font-weight: 600;
  line-height: 1.4;
  transform: rotate(6deg);
}
.cover-bottom {
  position: absolute;
  left: 32rpx;
  right: 32rpx;
  bottom: 32rpx;
}
.cover-type {
  display: block;
  font-size: 96rpx;
  font-weight: 800;
  letter-spacing: 4rpx;
  line-height: 1;
  color: #fff;
}
.cover-name {
  display: block;
  margin-top: 16rpx;
  font-size: 26rpx;
  color: #fff;
}
.cover-quote {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.72);
}

.entry {
  margin-top: 40rpx;
}
.btn-primary {
  font-weight: 700;
}
.quick {
  display: block;
  margin-top: 24rpx;
  text-align: center;
  font-size: 26rpx;
  color: #7560df;
}
.fine {
  display: block;
  margin-top: 14rpx;
  text-align: center;
  font-size: 22rpx;
  color: #a398af;
}

.scenes {
  display: flex;
  gap: 20rpx;
  margin-top: 48rpx;
}
.scene {
  flex: 1;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 24rpx;
  padding: 28rpx 24rpx;
}
.scene-mark {
  display: block;
  font-size: 30rpx;
  color: #7560df;
}
.scene-title {
  display: block;
  margin-top: 10rpx;
  font-size: 26rpx;
  font-weight: 700;
}
.scene-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.5;
}

.journey-entry {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-top: 24rpx;
  padding: 28rpx 26rpx;
  border-radius: 24rpx;
  background: linear-gradient(120deg, #211a36, #3a2c58 60%, #4b3570);
  box-shadow: 0 18rpx 40rpx rgba(33, 26, 54, 0.22);
}
.journey-main {
  flex: 1;
}
.journey-kicker {
  display: block;
  font-size: 18rpx;
  letter-spacing: 3rpx;
  color: rgba(255, 255, 255, 0.55);
}
.journey-title {
  display: block;
  margin-top: 8rpx;
  font-size: 28rpx;
  font-weight: 700;
  color: #fff;
}
.journey-desc {
  display: block;
  margin-top: 6rpx;
  font-size: 21rpx;
  color: rgba(255, 255, 255, 0.66);
}
.journey-arrow {
  font-size: 32rpx;
  color: #dfff8b;
}

.mini-tools {
  margin-top: 60rpx;
}
.mini-tools-head {
  display: flex;
  align-items: center;
  margin-bottom: 28rpx;
}
.mini-tools-title {
  font-size: 36rpx;
  font-weight: 800;
}
.tag {
  margin-left: auto;
  font-size: 20rpx;
  color: #8b8099;
  background: #efeaf4;
  border-radius: 999rpx;
  padding: 6rpx 18rpx;
}
.tool-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24rpx;
}
.tool-tile {
  display: flex;
  flex-direction: column;
  min-height: 390rpx;
  box-sizing: border-box;
  border: 2rpx solid #e9e0f5;
  border-radius: 42rpx;
  padding: 38rpx;
  background: #eee8fa;
}
.tool-icon {
  font-size: 64rpx;
  color: #7654b7;
  line-height: 1.1;
}
.tool-name {
  margin: 10rpx 0;
  font-size: 34rpx;
  font-weight: 700;
  color: #292630;
}
.tool-desc {
  font-size: 24rpx;
  color: #77698a;
  line-height: 1.5;
}
.tool-note {
  margin-top: 28rpx;
  font-size: 20rpx;
  color: #94869e;
}
.radar-tile {
  background: #e7eddb;
  border-color: #dce6ca;
}
.radar-tile .tool-icon,
.radar-tile .tool-name {
  color: #596d35;
}

.demo-fine {
  display: block;
  margin-top: 48rpx;
  text-align: center;
  font-size: 19rpx;
  color: #b3a9be;
  line-height: 1.6;
}

.foot {
  display: block;
  margin-top: 12rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
}
</style>
