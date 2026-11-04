<template>
  <view class="page home">
    <view class="brand-row">
      <view class="brand-left">
        <view class="badge"><text>16</text><text class="plus">+</text></view>
        <text class="brand-name">MBTI搭子</text>
      </view>
      <text class="chip">微信预览 ⌄</text>
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
import type { ResultSnapshotSummary, TypeMeta } from '@/api/types'
import { createQuizSession } from '@/api/quiz'
import { listResults } from '@/api/results'
import { listTypes } from '@/api/types-api'

const latest = ref<ResultSnapshotSummary | null>(null)
const metas = ref<TypeMeta[]>([])

onShow(async () => {
  try {
    const [res, types] = await Promise.all([listResults({ limit: 1 }), listTypes()])
    latest.value = res.items[0] || null
    metas.value = types.items
  } catch {
    latest.value = null
  }
})

const meta = computed(() =>
  latest.value ? metas.value.find((t) => t.type_code === latest.value!.type_code) : undefined,
)

const coverIndex = computed(() => (latest.value ? '001' : '000'))

const coverType = computed(() => latest.value?.type_code || '----')

const coverName = computed(() =>
  latest.value ? meta.value?.name_zh || 'MBTI' : '还没测过，先测一次',
)

const coverQuote = computed(() => {
  if (!latest.value) return '测完这里会换成你的类型和一句话人设。'
  const source = latest.value.source === 'self_select' ? '自行选择' : '趣味测试'
  return `${source} · ${latest.value.submitted_at.slice(0, 10)}`
})

async function startQuiz() {
  try {
    const session = await createQuizSession()
    uni.navigateTo({ url: `/pages/quiz/quiz?sessionId=${session.id}` })
  } catch {
    uni.showToast({ title: '无法开始测验', icon: 'none' })
  }
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
