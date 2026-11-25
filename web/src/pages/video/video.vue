<template>
  <view class="page">
    <proto-nav />
    <template v-if="!studio.hasCard">
      <view class="page-intro">
        <view class="eyebrow">MBTI BUDDY</view>
        <view class="h1">先制作你的形象套装</view>
        <view class="p">再预览 15 秒分镜。</view>
      </view>
      <view class="btn full" @click="goCreate">开始制作</view>
    </template>

    <template v-else>
      <DemoStrip />

      <view class="page-intro">
        <view class="eyebrow">STORYBOARD / 分镜预览</view>
        <view class="h1">15 秒，晒出我的 MBTI。</view>
        <view class="p">静态分镜预览，逐帧切换素材。</view>
      </view>

      <view class="video-story">
        <image class="story-img" :src="asset" mode="aspectFill" />
        <view class="story-copy">
          <text class="tag white">{{ current.time }}</text>
          <view class="h3">{{ current.title }}</view>
          <view class="p">{{ current.line }}</view>
        </view>
      </view>

      <view class="video-steps">
        <button
          v-for="(f, i) in frames"
          :key="i"
          :class="{ active: step === i }"
          @click="jump(i)"
        >0{{ i + 1 }} · {{ f.label }}</button>
      </view>

      <button class="btn full mt" @click="togglePlay">{{ playing ? '暂停预览' : '播放分镜预览' }}</button>
    </template>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
// TODO: 待 Remy 确认接口路径和字段（视频分镜生成接口未定义，当前为本地静态分镜预览）
import { computed, ref } from 'vue'
import { onShow, onUnload } from '@dcloudio/uni-app'
import { listResults } from '@/api/results'
import { TYPE_NAMES } from '@/constants/types'
import { VIDEO_COPY } from '@/constants/copy'
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
    title: VIDEO_COPY.titles[0] || '我的 MBTI 有了新形象',
    line: `${typeCode.value} · ${TYPE_NAMES[typeCode.value] || 'MBTI'}`,
  },
  {
    label: '宣言',
    time: '05–10 秒',
    title: VIDEO_COPY.titles[1] || '同一种类型，不同的我',
    line: currentQuote(typeCode.value),
  },
  {
    label: '名片',
    time: '10–15 秒',
    title: VIDEO_COPY.titles[2] || '先交换名片，再认识彼此',
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
.story-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
.story-copy {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #fff;
  padding: 25px;
  text-align: center;
}
.story-copy .h3 {
  font-weight: 700;
  margin-bottom: 27px;
}

.video-steps uni-button {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
