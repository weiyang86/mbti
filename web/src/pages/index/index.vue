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
      <view class="scene" @click="goShare">
        <text class="scene-mark">↗</text>
        <text class="scene-title">晒成一张图</text>
        <text class="scene-desc">用最近一次结果生成晒图预览</text>
      </view>
      <view class="scene" @click="goDiscover">
        <text class="scene-mark">⇄</text>
        <text class="scene-title">交换 MBTI 名片</text>
        <text class="scene-desc">遇见相同与不同的你（本期占位）</text>
      </view>
    </view>

    <text class="foot">MBTI搭子 · 原创趣味版 · 非官方测评</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { ResultSnapshotSummary } from '@/api/types'
import { listResults } from '@/api/results'

const TYPE_NAMES: Record<string, string> = {
  INTJ: '独立构想者', INTP: '好奇研究员', ENTJ: '行动策划家', ENTP: '灵感实验家',
  INFJ: '安静观察家', INFP: '理想收藏家', ENFJ: '温暖连接者', ENFP: '灵感漫游者',
  ISTJ: '秩序守护者', ISFJ: '细节记录员', ESTJ: '计划推进者', ESFJ: '关系照料者',
  ISTP: '动手探索家', ISFP: '感受艺术家', ESTP: '即时行动派', ESFP: '快乐分享家',
}

const DECLARATIONS: Record<string, string> = {
  INTJ: '想得很远，也走得很稳。', INTP: '好奇心在线，脑洞不打烊。',
  ENTJ: '有想法，也有把它落地的行动力。', ENTP: '给日常一点新可能。',
  INFJ: '安静观察，也认真理解。', INFP: '温柔有自己的方向。',
  ENFJ: '把温暖，留在每一次相遇里。', ENFP: '今天也想遇见有趣的世界。',
  ISTJ: '把靠谱，藏进每一件小事。', ISFJ: '记得小事，也珍惜身边的人。',
  ESTJ: '喜欢把事情，安排得明明白白。', ESFJ: '让每一次相处都有温度。',
  ISTP: '与其想很久，不如亲手试一试。', ISFP: '把感受到的美，留在生活里。',
  ESTP: '行动是我认识世界的方式。', ESFP: '把快乐，分享给今天的你。',
}

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

onShow(async () => {
  try {
    const res = await listResults({ limit: 1 })
    latest.value = res.items[0] || null
  } catch {
    latest.value = null
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

function startQuiz() {
  uni.navigateTo({ url: '/pages/test-intro/test-intro' })
}

function goSelfSelect() {
  uni.navigateTo({ url: '/pages/self-select/self-select' })
}

function goShare() {
  if (!latest.value) {
    uni.showToast({ title: '先测一次再晒图', icon: 'none' })
    return
  }
  uni.navigateTo({ url: `/pages/share-preview/share-preview?id=${latest.value.id}` })
}

function goDiscover() {
  uni.switchTab({ url: '/pages/discover/discover' })
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

.foot {
  display: block;
  margin-top: 48rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
}
</style>
