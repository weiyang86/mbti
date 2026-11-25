<template>
  <view class="page">
    <proto-nav />
    <DemoStrip />

    <StateView v-if="loading" state="loading" title="正在生成阶段图…" />

    <template v-else-if="error || !a || !b">
      <view class="page-intro">
        <view class="eyebrow">MY NEXT CHAPTER / 阶段分享</view>
        <view class="h1">{{ JOURNEY_COPY.emptyTitle }}</view>
        <view class="p">{{ error || '先完成两次同版本测试，再回来做成一张图。' }}</view>
      </view>
      <view class="btn full" @click="backToJourney">回到我的轨迹</view>
    </template>

    <template v-else>
      <view class="page-intro">
        <view class="eyebrow">MY NEXT CHAPTER / 阶段分享</view>
        <view class="h1">
          <text class="title-line">{{ JOURNEY_COPY.titleLines[0] }}</text>
          <text class="title-line">{{ JOURNEY_COPY.titleLines[1] }}</text>
        </view>
        <view class="p">只分享你选择的两个结果，完整历史与作答不会被公开。</view>
      </view>

      <view class="journey-poster-preview">
        <text class="poster-kicker">MBTI搭子 / MY NEXT CHAPTER</text>
        <view class="h2">
          <text class="title-line">{{ sameType ? '还是这个类型，' : '同一个我，' }}</text>
          <text class="title-line">{{ sameType ? '也有新的自己。' : '新的章节。' }}</text>
        </view>
        <view class="poster-type-pair">
          <text class="strong">{{ a.type_code }}</text>
          <text class="span">{{ sameType ? '＝' : '→' }}</text>
          <text class="strong">{{ b.type_code }}</text>
        </view>
        <view class="p">{{ dateLabel(a.submitted_at) }} → {{ dateLabel(b.submitted_at) }}</view>
        <view class="poster-line" />
        <text class="b">{{ posterSummary }}</text>
        <view v-if="showName" class="p">{{ nickname }}</view>
        <view v-if="showStage" class="p">{{ stageOf(a) }} → {{ stageOf(b) }}</view>
        <text class="small">{{ JOURNEY_COPY.posterDisclaimer }}</text>
        <text class="i">✦</text>
      </view>

      <view class="share-privacy">
        <view class="label" @click="showName = !showName">
          <view class="checkbox" :class="{ checked: showName }">
            <text v-if="showName" class="check">✓</text>
          </view>
          <text>带上我的昵称</text>
        </view>
        <view class="label" @click="showStage = !showStage">
          <view class="checkbox" :class="{ checked: showStage }">
            <text v-if="showStage" class="check">✓</text>
          </view>
          <text>带上这两次的阶段标签</text>
        </view>
        <view class="fine">
          默认不带昵称与阶段。近期状态、具体答案、其他记录和联系方式始终不进入分享图。
        </view>
      </view>

      <view class="btn full" @click="savePoster">预览并保存我的阶段图</view>
      <view class="btn secondary full mt" @click="copyCaption">复制阶段配文</view>
      <view class="fine centered mt">基础阶段图免费 · 可保存 PNG · 不会自动发布</view>
    </template>

    <view v-if="showPreview" class="modal-backdrop">
      <view class="modal">
        <view class="close" @click="showPreview = false">×</view>
        <view class="h2">把这一段，留在相册里。</view>
        <view class="p">1080 × 1440 PNG。手机可以长按图片保存。</view>
        <image class="poster-preview-image" :src="posterUrl" mode="widthFix" />
        <view class="btnrow">
          <view class="btn" @click="downloadPoster">下载 PNG</view>
          <view class="btn secondary" @click="showPreview = false">完成</view>
        </view>
        <view class="fine mt">仅含预览中可见的两次结果，不会自动发布。</view>
      </view>
    </view>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import StateView from '@/components/state-view.vue'
import { JOURNEY_COPY } from '@/constants/copy'
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { ResultSnapshot, ResultSnapshotSummary } from '@/api/types'
import { getResult, listResults } from '@/api/results'
import { account } from '@/store/account'
import {
  changedAnswerCount,
  chooseSummaryPair,
  dateLabel,
  dimCompareRows,
  summaryText,
} from '@/constants/journey'

type PickRow = ResultSnapshotSummary & { recent_status?: string }

const baselineId = ref('')
const targetId = ref('')
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
  const accountName = account.profile.nickname.trim()
  if (accountName) return accountName
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

function caption(): string {
  if (!a.value || !b.value) return ''
  return [
    `${dateLabel(a.value.submitted_at)} → ${dateLabel(b.value.submitted_at)}`,
    summaryText(a.value, b.value),
    JOURNEY_COPY.captionLead,
    '#MBTI搭子 #我的阶段记录',
    JOURNEY_COPY.captionDisclaimer,
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
  ctx.fillText('两次趣味复测记录 · 仅展示所选结果', 80, 1290)
  ctx.fillText('不代表人格已改变 · 不含具体答案与联系方式', 80, 1350)

  return canvas.toDataURL('image/png')
}
// #endif

function backToJourney() {
  uni.switchTab({ url: '/pages/history/list', fail: () => uni.reLaunch({ url: '/pages/history/list' }) })
}
</script>

<style scoped lang="scss">
.title-line {
  display: block;
}

.h2 {
  font-weight: 700;
}

.poster-kicker {
  display: block;
}

.demo-strip .textbtn {
  font-size: 9px;
  color: #a197ad;
}
.share-privacy .fine {
  font-size: 10px;
  margin: 10px 0 0;
}
.checkbox {
  width: 17px;
  height: 17px;
  margin: 0 3px 0 4px;
  flex-shrink: 0;
  border: 1px solid #767676;
  border-radius: 3px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
}
.checkbox.checked {
  background: #7652df;
  border-color: #7652df;
}
.checkbox .check {
  font-size: 11px;
  line-height: 1;
  color: #fff;
}

.centered {
  text-align: center;
  display: block;
  margin-bottom: 10px;
}

.modal-backdrop {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
}
.modal .close {
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
