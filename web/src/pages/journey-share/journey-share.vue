<template>
  <view class="page share-page">
    <text class="kicker">MY NEXT CHAPTER / 阶段分享</text>
    <view class="title">
      <text>每一面的我，</text>
      <text>都值得留一张。</text>
    </view>
    <text class="sub">只分享你选择的两个结果，完整历史与作答不会被公开。</text>

    <view v-if="demo" class="journey-demo">
      <text class="demo-title">示例档案 · 不是你的测试记录</text>
      <text class="demo-desc">三个虚构阶段，只演示变化；不会合并到你的历史。</text>
    </view>

    <view v-if="loading" class="state"><text class="state-text">正在生成阶段图…</text></view>

    <view v-else-if="error || !a || !b" class="state">
      <text class="state-text">{{ error || '还没有两份可比较的记录' }}</text>
      <view class="btn-primary mt" @click="backToJourney">回到我的轨迹</view>
      <view class="btn-ghost mt" @click="openDemoCompare">先看变化示例</view>
    </view>

    <template v-else>
      <view class="journey-poster-preview">
        <text class="poster-kicker">MBTI搭子 / MY NEXT CHAPTER</text>
        <view class="poster-title">
          <text>{{ sameType ? '还是这个类型，' : '同一个我，' }}</text>
          <text>{{ sameType ? '也有新的自己。' : '新的章节。' }}</text>
        </view>
        <view class="poster-type-pair">
          <text class="poster-type before">{{ a.type_code }}</text>
          <text class="poster-arrow">{{ sameType ? '＝' : '→' }}</text>
          <text class="poster-type after">{{ b.type_code }}</text>
        </view>
        <text class="poster-date">
          {{ dateLabel(a.submitted_at) }} → {{ dateLabel(b.submitted_at) }}
        </text>
        <view class="poster-line" />
        <text class="poster-summary">{{ posterSummary }}</text>
        <text v-if="showName" class="poster-name">{{ nickname }}</text>
        <text v-if="showStage" class="poster-stage">{{ stageOf(a) }} → {{ stageOf(b) }}</text>
        <text class="poster-fine">
          {{ demo ? '虚构示例 · ' : '' }}趣味复测记录，不代表人格已改变
        </text>
        <text class="poster-star">✦</text>
      </view>

      <view class="share-privacy">
        <view class="privacy-row">
          <text class="privacy-label">带上我的昵称</text>
          <switch :checked="showName" color="#7652df" @change="toggleName" />
        </view>
        <view class="privacy-row">
          <text class="privacy-label">带上这两次的阶段标签</text>
          <switch :checked="showStage" color="#7652df" @change="toggleStage" />
        </view>
        <text class="privacy-fine">
          默认不带昵称与阶段。近期状态、具体答案、其他记录和联系方式始终不进入分享图。
        </text>
      </view>

      <view class="btn-primary mt" @click="savePoster">预览并保存我的阶段图</view>
      <view class="btn-secondary mt" @click="copyCaption">复制阶段配文</view>
      <text class="foot">基础阶段图免费 · 可保存 PNG · 不会自动发布</text>
    </template>

    <view v-if="showPreview" class="poster-modal">
      <view class="poster-modal-card">
        <text class="modal-title">把这一段，留在相册里。</text>
        <text class="modal-desc">1080 × 1440 PNG。手机可以长按图片保存。</text>
        <image class="poster-image" :src="posterUrl" mode="widthFix" />
        <view class="btn-primary modal-btn" @click="downloadPoster">下载 PNG</view>
        <view class="btn-secondary modal-btn" @click="showPreview = false">完成</view>
        <text class="modal-fine">仅含预览中可见的两次结果，不会自动发布。</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { ResultSnapshot, ResultSnapshotSummary } from '@/api/types'
import { getResult, listResults } from '@/api/results'
import {
  DEMO_RECORDS,
  changedAnswerCount,
  chooseSummaryPair,
  dateLabel,
  dimCompareRows,
  pickPair,
  summaryText,
} from '@/constants/journey'

type PickRow = ResultSnapshotSummary & { demo_title?: string; recent_status?: string }

const baselineId = ref('')
const targetId = ref('')
const demo = ref(false)
const loading = ref(true)
const error = ref('')
const a = ref<ResultSnapshot | null>(null)
const b = ref<ResultSnapshot | null>(null)
const showName = ref(false)
const showStage = ref(false)
const posterUrl = ref('')
const showPreview = ref(false)
const nickname = ref('小禾')

onLoad((q) => {
  baselineId.value = (q?.baseline as string) || ''
  targetId.value = (q?.target as string) || ''
  demo.value = q?.demo === '1'
  nickname.value = readNickname()
})

onMounted(load)

const sameType = computed(() => a.value?.type_code === b.value?.type_code)

const changedDims = computed(() =>
  a.value && b.value ? dimCompareRows(a.value, b.value).filter((d) => d.delta !== 0) : [],
)

const posterSummary = computed(() => {
  if (!a.value || !b.value) return ''
  const changed = changedAnswerCount(a.value, b.value)
  if (changed !== null) {
    return changed === 0 ? '这两次，选择一致。' : `${changed} / 12 道题，选择有所不同。`
  }
  if (changedDims.value.length === 0) return '这两次，四维计数一致。'
  return `${changedDims.value.length} 个维度的题数，有所不同。`
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    if (demo.value) {
      const [from, to] = pickPair(DEMO_RECORDS, baselineId.value, targetId.value)
      a.value = from
      b.value = to
      if (!from || !to) error.value = '示例数据不完整，请回到轨迹重新进入。'
      return
    }
    const res = await listResults({ limit: 100 })
    const quiz = res.items.filter((i) => i.source === 'quiz')
    const version = quiz[0]?.question_bank_version
    const options: PickRow[] = quiz.filter((i) => i.question_bank_version === version)
    const pair = chooseSummaryPair(options, baselineId.value, targetId.value)
    if (!pair[0] || !pair[1]) {
      a.value = null
      b.value = null
      return
    }
    const [from, to] = await Promise.all([
      getResult(pair[0].id),
      getResult(pair[1].id),
    ])
    a.value = from
    b.value = to
  } catch {
    error.value = '阶段图加载失败，请稍后再试。'
  } finally {
    loading.value = false
  }
}

function readNickname(): string {
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

function stageOf(record: ResultSnapshot): string {
  return record.life_stage || '日常生活'
}

function toggleName(e: any) {
  showName.value = !!e?.detail?.value
}

function toggleStage(e: any) {
  showStage.value = !!e?.detail?.value
}

function caption(): string {
  if (!a.value || !b.value) return ''
  return [
    `${demo.value ? '【虚构示例】\n' : ''}${dateLabel(a.value.submitted_at)} → ${dateLabel(b.value.submitted_at)}`,
    summaryText(a.value, b.value),
    '每一面的我，都值得记录。',
    '#MBTI搭子 #我的阶段记录',
    '趣味复测结果，不代表人格已改变。',
  ].join('\n')
}

function copyCaption() {
  uni.setClipboardData({
    data: caption(),
    success: () => uni.showToast({ title: '配文已复制', icon: 'none' }),
  })
}

function savePoster() {
  // #ifdef H5
  try {
    posterUrl.value = buildPoster()
    showPreview.value = true
  } catch {
    uni.showToast({ title: '生成图片失败，请稍后再试', icon: 'none' })
  }
  // #endif
  // #ifndef H5
  uni.showToast({ title: '请截屏保存当前海报', icon: 'none' })
  // #endif
}

function downloadPoster() {
  // #ifdef H5
  if (posterUrl.value) {
    const link = document.createElement('a')
    link.href = posterUrl.value
    link.download = 'MBTI搭子-我的阶段变化.png'
    link.click()
  }
  // #endif
  // #ifndef H5
  uni.showToast({ title: '请截屏保存当前海报', icon: 'none' })
  // #endif
}

// #ifdef H5
function buildPoster(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1440
  const ctx = canvas.getContext('2d')
  if (!ctx || !a.value || !b.value) throw new Error('canvas unavailable')

  ctx.fillStyle = '#eee9ff'
  ctx.fillRect(0, 0, 1080, 1440)
  ctx.fillStyle = '#d8eddf'
  ctx.beginPath()
  ctx.arc(1000, 130, 390, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#e4d7ff'
  ctx.beginPath()
  ctx.arc(0, 1330, 390, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#6650ad'
  ctx.font = 'bold 28px "PingFang SC", sans-serif'
  ctx.fillText('MBTI搭子 / MY NEXT CHAPTER', 80, 110)

  ctx.fillStyle = '#2c2141'
  ctx.font = 'bold 74px "PingFang SC", sans-serif'
  ctx.fillText(sameType.value ? '还是这个类型，' : '同一个我，', 80, 285)
  ctx.fillText(sameType.value ? '也有新的自己。' : '新的章节。', 80, 385)

  ctx.font = 'bold 98px "PingFang SC", sans-serif'
  ctx.fillStyle = '#786992'
  ctx.fillText(a.value.type_code, 80, 650)
  ctx.fillStyle = '#7756ea'
  ctx.fillText(b.value.type_code, 625, 650)
  ctx.font = '55px "PingFang SC", sans-serif'
  ctx.fillText(sameType.value ? '＝' : '→', 485, 645)

  ctx.font = '30px "PingFang SC", sans-serif'
  ctx.fillStyle = '#70647f'
  ctx.fillText(dateLabel(a.value.submitted_at), 80, 720)
  ctx.fillText(dateLabel(b.value.submitted_at), 625, 720)

  ctx.strokeStyle = '#c6b7e3'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(80, 810)
  ctx.lineTo(1000, 810)
  ctx.stroke()

  ctx.fillStyle = '#352a49'
  ctx.font = 'bold 42px "PingFang SC", sans-serif'
  ctx.fillText(posterSummary.value, 80, 905)

  let y = 1010
  ctx.font = '32px "PingFang SC", sans-serif'
  if (showName.value) {
    ctx.fillText(`记录者：${nickname.value}`, 80, y)
    y += 65
  }
  if (showStage.value) {
    ctx.fillText(`${stageOf(a.value)} → ${stageOf(b.value)}`, 80, y)
  }

  ctx.fillStyle = '#81718e'
  ctx.font = '25px "PingFang SC", sans-serif'
  ctx.fillText(
    demo.value ? '虚构示例 · 不属于你的真实作答' : '两次趣味复测记录 · 仅展示所选结果',
    80,
    1290,
  )
  ctx.fillText('不代表人格已改变 · 不含具体答案与联系方式', 80, 1350)

  return canvas.toDataURL('image/png')
}
// #endif

function backToJourney() {
  uni.switchTab({ url: '/pages/history/list' })
}

function openDemoCompare() {
  uni.redirectTo({ url: '/pages/compare/compare?demo=1' })
}
</script>

<style scoped lang="scss">
.share-page {
  padding-top: 40rpx;
  padding-bottom: 56rpx;
}

.kicker {
  display: block;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: #a398af;
  font-weight: 600;
}
.title {
  margin-top: 16rpx;
  display: flex;
  flex-direction: column;
  font-size: 52rpx;
  font-weight: 800;
  line-height: 1.35;
  letter-spacing: -1rpx;
}
.sub {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.6;
}

.journey-demo {
  margin-top: 28rpx;
  padding: 24rpx;
  border-radius: 24rpx;
  border: 2rpx solid #dbd1ef;
  background: #f0eafa;
}
.demo-title {
  display: block;
  font-size: 24rpx;
  font-weight: 700;
  color: #746080;
}
.demo-desc {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.6;
}

.state {
  padding-top: 160rpx;
  text-align: center;
}
.state-text {
  display: block;
  font-size: 26rpx;
  color: #77727e;
}

.journey-poster-preview {
  position: relative;
  overflow: hidden;
  margin-top: 32rpx;
  padding: 44rpx 38rpx 50rpx;
  min-height: 720rpx;
  border-radius: 32rpx;
  border: 2rpx solid #e1d7f3;
  background: #eee8fc;
}
.journey-poster-preview::before {
  content: '';
  position: absolute;
  right: -120rpx;
  top: -120rpx;
  width: 400rpx;
  height: 400rpx;
  border-radius: 50%;
  background: #dbe9d3;
  opacity: 0.75;
}
.poster-kicker {
  position: relative;
  display: block;
  font-size: 16rpx;
  letter-spacing: 2rpx;
  color: #9380b0;
}
.poster-title {
  position: relative;
  display: flex;
  flex-direction: column;
  margin: 40rpx 0 44rpx;
  font-size: 52rpx;
  font-weight: 800;
  line-height: 1.5;
  letter-spacing: -1rpx;
}
.poster-type-pair {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.poster-type {
  font-size: 64rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
}
.poster-type.before {
  color: #a391b6;
}
.poster-type.after {
  color: #7953c6;
}
.poster-arrow {
  font-size: 44rpx;
  color: #a897bd;
}
.poster-date {
  position: relative;
  display: block;
  margin-top: 24rpx;
  font-size: 20rpx;
  color: #9b87ab;
}
.poster-line {
  height: 2rpx;
  margin: 36rpx 0;
  background: #d6c8e8;
}
.poster-summary {
  position: relative;
  display: block;
  font-size: 26rpx;
  font-weight: 700;
  color: #6a547d;
}
.poster-name {
  position: relative;
  display: block;
  margin-top: 20rpx;
  font-size: 22rpx;
  color: #6a547d;
}
.poster-stage {
  position: relative;
  display: block;
  margin-top: 12rpx;
  font-size: 20rpx;
  color: #9b87ab;
}
.poster-fine {
  position: relative;
  display: block;
  margin-top: 64rpx;
  font-size: 16rpx;
  color: #9b8aa8;
}
.poster-star {
  position: absolute;
  right: 24rpx;
  bottom: 20rpx;
  font-size: 160rpx;
  line-height: 1;
  color: #c2b2dc;
  opacity: 0.35;
}

.share-privacy {
  margin-top: 32rpx;
  padding: 12rpx 28rpx 24rpx;
  border-radius: 24rpx;
  border: 2rpx solid #e4ddeb;
  background: #fff;
}
.privacy-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16rpx 0;
}
.privacy-label {
  font-size: 24rpx;
  color: #8a7997;
}
.privacy-fine {
  display: block;
  margin-top: 12rpx;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.7;
}

.foot {
  display: block;
  margin-top: 32rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.6;
}

.mt {
  margin-top: 28rpx;
}
.btn-ghost {
  margin-top: 20rpx;
  padding: 24rpx 40rpx;
  text-align: center;
  font-size: 28rpx;
  color: #7560df;
}

.poster-modal {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 99;
  background: rgba(24, 16, 40, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40rpx;
  box-sizing: border-box;
}
.poster-modal-card {
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  padding: 32rpx;
  border-radius: 32rpx;
  background: #fff;
  box-sizing: border-box;
}
.modal-title {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
}
.modal-desc {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #77727e;
}
.poster-image {
  width: 100%;
  margin-top: 24rpx;
  border-radius: 20rpx;
}
.modal-btn {
  margin-top: 24rpx;
}
.modal-fine {
  display: block;
  margin-top: 20rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
}
</style>
