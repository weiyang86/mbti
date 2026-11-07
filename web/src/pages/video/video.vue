<template>
  <view class="page video-page">
    <view v-if="!studio.hasCard" class="state-empty">
      <text class="empty-mark">▶</text>
      <text class="empty-title">先制作你的形象套装</text>
      <text class="empty-desc">再预览 15 秒静态分镜演示。</text>
      <view class="btn-primary mt" @click="goCreate">
        {{ studio.tier === 0 ? '去看晒图套装' : '开始制作' }}
      </view>
    </view>

    <view v-else>
      <view class="demo-strip">
        <text>V0.4 · Mock 演示 · 不产生费用</text>
      </view>

      <text class="kicker">STORYBOARD / 分镜预览</text>
      <text class="title">15 秒，<text class="hl">晒出我的 MBTI。</text></text>
      <text class="sub">静态素材切换演示，不是实际视频生成或导出。</text>

      <view class="video-story">
        <image class="story-img" :src="asset" mode="aspectFill" />
        <view class="story-shade" />
        <view class="story-copy">
          <text class="story-time">{{ current.time }}</text>
          <text class="story-head">{{ current.title }}</text>
          <text class="story-line">{{ current.line }}</text>
        </view>
      </view>

      <view class="video-steps">
        <view
          v-for="(f, i) in frames"
          :key="i"
          class="video-step"
          :class="{ active: step === i }"
          @click="jump(i)"
        >
          <text>0{{ i + 1 }} · {{ f.label }}</text>
        </view>
      </view>

      <view class="btn-primary mt" @click="togglePlay">
        {{ playing ? '暂停预览' : '播放分镜预览' }}
      </view>

      <text class="foot">仅为围绕形象、宣言与名片的三段静态分镜演示。</text>
    </view>
  </view>
</template>

<script setup lang="ts">
// TODO: 待 Remy 确认接口路径和字段（视频分镜生成接口未定义，当前为本地静态分镜演示）
import { computed, ref } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import { listResults } from '@/api/results'
import { TYPE_NAMES } from '@/constants/types'
import { currentQuote, studio, styleAsset } from '@/store/studio'

const typeCode = ref('INFP')
const step = ref(0)
const playing = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

onShow(async () => {
  try {
    const res = await listResults({ limit: 1 })
    typeCode.value = res.items[0]?.type_code || 'INFP'
  } catch {
    typeCode.value = 'INFP'
  }
})

onUnload(() => {
  stop()
})

const asset = computed(() => styleAsset(studio.style))

const frames = computed(() => [
  {
    label: '形象',
    time: '00–05 秒',
    title: '我的 MBTI 有了新形象',
    line: `${typeCode.value} · ${TYPE_NAMES[typeCode.value] || 'MBTI'}`,
  },
  {
    label: '宣言',
    time: '05–10 秒',
    title: '同一种类型，不同的我',
    line: currentQuote(typeCode.value),
  },
  {
    label: '名片',
    time: '10–15 秒',
    title: '先交换名片，再认识彼此',
    line: 'MBTI搭子 / 晒出我的主角卡',
  },
])

const current = computed(() => frames.value[step.value])

function jump(index: number) {
  stop()
  step.value = index
}

function togglePlay() {
  if (playing.value) {
    stop()
    return
  }
  step.value = 0
  playing.value = true
  timer = setInterval(() => {
    if (step.value >= 2) {
      stop()
      return
    }
    step.value += 1
  }, 5000)
}

function stop() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  playing.value = false
}

function goCreate() {
  uni.navigateTo({
    url: studio.tier === 0 ? '/pages/pricing/pricing' : '/pages/create/create',
  })
}
</script>

<style scoped lang="scss">
.video-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
}

.state-empty {
  padding: 200rpx 12rpx 40rpx;
  text-align: center;
}
.empty-mark {
  display: block;
  font-size: 52rpx;
  color: #b9a4da;
}
.empty-title {
  display: block;
  margin-top: 22rpx;
  font-size: 32rpx;
  font-weight: 700;
}
.empty-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 23rpx;
  color: #77727e;
}

.demo-strip {
  font-size: 20rpx;
  color: #a398af;
  margin-bottom: 26rpx;
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
  margin-top: 14rpx;
  font-size: 54rpx;
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

.video-story {
  position: relative;
  margin-top: 32rpx;
  height: 620rpx;
  border-radius: 30rpx;
  overflow: hidden;
}
.story-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
.story-shade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 70%;
  background: linear-gradient(180deg, rgba(20, 12, 40, 0), rgba(20, 12, 40, 0.86));
}
.story-copy {
  position: absolute;
  left: 32rpx;
  right: 32rpx;
  bottom: 40rpx;
}
.story-time {
  display: inline-block;
  font-size: 19rpx;
  color: #2c2550;
  background: rgba(255, 255, 255, 0.9);
  border-radius: 999rpx;
  padding: 6rpx 16rpx;
}
.story-head {
  display: block;
  margin-top: 18rpx;
  font-size: 42rpx;
  font-weight: 800;
  color: #fff;
  line-height: 1.35;
}
.story-line {
  display: block;
  margin-top: 12rpx;
  font-size: 23rpx;
  color: rgba(255, 255, 255, 0.8);
}

.video-steps {
  display: flex;
  gap: 14rpx;
  margin-top: 24rpx;
}
.video-step {
  flex: 1;
  text-align: center;
  font-size: 21rpx;
  color: #77727e;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 16rpx;
  padding: 18rpx 6rpx;
}
.video-step.active {
  color: #fff;
  background: #7560df;
  border-color: #7560df;
}

.mt {
  margin-top: 36rpx;
}
.btn-primary {
  font-weight: 700;
}

.foot {
  display: block;
  margin-top: 26rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
}
</style>
