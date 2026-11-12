<template>
  <view class="page compare-page">
    <text class="kicker">THEN & NOW / 前后对比</text>
    <view class="title">
      <text>变了多少，</text>
      <text>让答案自己说。</text>
    </view>
    <text class="sub">比较你选择的两个阶段；没有高低阶，也没有“更好的人格”。</text>

    <view v-if="loading" class="state"><text class="state-text">正在准备对比…</text></view>

    <view v-else-if="error" class="state">
      <text class="state-text">{{ error }}</text>
      <view class="btn-secondary mt" @click="load">重新加载</view>
      <view class="btn-ghost mt" @click="backToJourney">回到我的轨迹</view>
    </view>

    <template v-else-if="ready && a && b">
      <view class="compare-selects">
        <view class="select-field">
          <text class="select-label">之前</text>
          <picker
            :range="pickerLabels"
            :value="fromIndex"
            @change="onPick('from', $event)"
          >
            <view class="select-box">
              <text class="select-text">{{ pickerLabels[fromIndex] || '选择记录' }}</text>
              <text class="select-arrow">⌄</text>
            </view>
          </picker>
        </view>
        <view class="select-field">
          <text class="select-label">这次</text>
          <picker
            :range="pickerLabels"
            :value="toIndex"
            @change="onPick('to', $event)"
          >
            <view class="select-box">
              <text class="select-text">{{ pickerLabels[toIndex] || '选择记录' }}</text>
              <text class="select-arrow">⌄</text>
            </view>
          </picker>
        </view>
      </view>

      <view class="type-transition">
        <view class="transition-side">
          <text class="transition-date">{{ dateLabel(a.submitted_at, true) }}</text>
          <text class="transition-type">{{ a.type_code }}</text>
          <text class="transition-stage">{{ stageOf(a) }}</text>
        </view>
        <text class="transition-arrow">{{ sameType ? '＝' : '→' }}</text>
        <view class="transition-side">
          <text class="transition-date">{{ dateLabel(b.submitted_at, true) }}</text>
          <text class="transition-type current">{{ b.type_code }}</text>
          <text class="transition-stage">{{ stageOf(b) }}</text>
        </view>
      </view>

      <view class="change-insight">
        <text class="insight-kicker">{{ days ? `相隔 ${days} 天` : '同一天的两次作答' }} · {{ changeLine }}</text>
        <text class="insight-title">{{ summary }}</text>
        <text class="insight-desc">
          {{ typeChanges.length ? '变化的类型维度：' + typeChanges.join('、') + '。' : '四字母标签保持一致。' }}
          {{ days < 7 ? '这两次间隔较短，先作为作答波动记录。' : '可结合当时的生活情境回看。' }}
          结果不证明真实人格发生改变。
        </text>
      </view>

      <text class="section-title">四个维度，具体哪里不同？</text>

      <view class="dimension-compare">
        <view v-for="row in dimRows" :key="row.key" class="dim-card">
          <view class="dim-head">
            <text class="dim-name">{{ row.name }}</text>
            <text class="dim-pair">{{ row.leftLabel }} / {{ row.rightLabel }}</text>
          </view>
          <view class="count-row">
            <text class="count-label">之前</text>
            <view class="count-dots before">
              <view
                v-for="n in 3"
                :key="'b' + n"
                class="dot"
                :class="{ filled: n <= row.before }"
              />
            </view>
            <text class="count-value">{{ row.right }} {{ row.before }}/3</text>
          </view>
          <view class="count-row">
            <text class="count-label">这次</text>
            <view class="count-dots after">
              <view
                v-for="n in 3"
                :key="'a' + n"
                class="dot"
                :class="{ filled: n <= row.after }"
              />
            </view>
            <text class="count-value">{{ row.right }} {{ row.after }}/3</text>
            <text class="count-delta">
              {{ row.delta === 0 ? '相同' : (row.delta > 0 ? '+' : '') + row.delta + ' 题' }}
            </text>
          </view>
        </view>
      </view>
      <text class="fine">
        每个维度只有 3 道题，圆点表示选到右侧偏好的题数，不是人格强度、准确率或成长分数。
      </text>

      <!-- TODO: 待 Remy 确认「历史作答回放」服务端接口；当前仅回放本机保存的作答 -->
      <view v-if="answerDiff" class="answer-replay">
        <view class="replay-head" @click="showAnswerDiff = !showAnswerDiff">
          <text class="replay-title">查看 {{ localChangedCount }} 道不同的回答</text>
          <text class="replay-toggle">{{ showAnswerDiff ? '收起 ⌃' : '展开 ⌄' }}</text>
        </view>
        <text class="replay-hint">仅自己可见 · 不会出现在分享图或名片中</text>
        <view v-if="showAnswerDiff" class="replay-list">
          <view
            v-for="item in answerDiff.filter((d) => d.changed)"
            :key="item.no"
            class="replay-item"
          >
            <text class="replay-no">{{ String(item.no).padStart(2, '0') }} / 12</text>
            <text class="replay-question">{{ item.question }}</text>
            <text class="replay-before">之前：{{ item.before }}</text>
            <text class="replay-after">这次：{{ item.after }}</text>
          </view>
          <text v-if="localChangedCount === 0" class="replay-same">
            12 道题的选择完全相同。稳定也是这次记录的一部分。
          </text>
        </view>
      </view>

      <view v-if="notes.length" class="notes">
        <text v-for="(note, i) in notes" :key="i" class="note-line">· {{ note }}</text>
      </view>

      <view class="reflection-card">
        <text class="reflection-title">把变化放回生活里看</text>
        <text class="reflection-desc">
          可以想想：最近的生活节奏、环境或作答理解有没有不同？这里不把阶段标签当成变化的因果解释。
        </text>
        <text class="reflection-link" @click="openRecord(b.id)">
          回看这次阶段记录 →
        </text>
      </view>

      <view class="btn-primary mt" @click="goShare">把这段变化，做成一张图</view>
      <view class="btn-ghost mt" @click="backToJourney">回到我的轨迹</view>
    </template>

    <view v-else class="empty">
      <text class="empty-mark">01 → 02</text>
      <text class="empty-title">再留一份记录，就能看见前后差别。</text>
      <text class="empty-desc">只比较同一题目、计分规则和回顾时间窗下的两次结果。</text>
      <view class="btn-primary empty-btn" @click="goQuiz">免费记录现在的我</view>
      <view class="btn-secondary" @click="backToJourney">查看已有记录</view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import type {
  CompareResult,
  ResultSnapshot,
  ResultSnapshotSummary,
} from '@/api/types'
import { compareResults, getResult, listResults } from '@/api/results'
import { getLocalAnswers, type LocalAnswerRecord } from '@/store/local-answers'
import {
  DIM_LIST,
  changedAnswerCount,
  chooseSummaryPair,
  dateLabel,
  daysBetween,
  dimCompareRows,
  summaryText,
  type JourneyRecord,
} from '@/constants/journey'

type PickRow = ResultSnapshotSummary & { recent_status?: string }

const baselineId = ref('')
const targetId = ref('')
const loading = ref(true)
const error = ref('')
const a = ref<ResultSnapshot | null>(null)
const b = ref<ResultSnapshot | null>(null)
const compare = ref<CompareResult | null>(null)
const options = ref<PickRow[]>([])
const localA = ref<LocalAnswerRecord | null>(null)
const localB = ref<LocalAnswerRecord | null>(null)
const showAnswerDiff = ref(false)

onLoad((q) => {
  baselineId.value = (q?.baseline as string) || ''
  targetId.value = (q?.target as string) || ''
})

onShow(() => {
  load()
})

const ready = computed(() => !!a.value && !!b.value)
const sameType = computed(() => a.value?.type_code === b.value?.type_code)
const days = computed(() =>
  a.value && b.value ? daysBetween(a.value, b.value) : 0,
)
const summary = computed(() =>
  a.value && b.value ? summaryText(a.value, b.value) : '',
)
const dimRows = computed(() =>
  a.value && b.value ? dimCompareRows(a.value, b.value) : [],
)
const changedDims = computed(() => dimRows.value.filter((d) => d.delta !== 0))

// TODO: 待 Remy 确认「历史作答回放」服务端接口；当前仅回放本机保存的作答
const answerDiff = computed(() => {
  const left = localA.value?.items
  const right = localB.value?.items
  if (!left || !right || left.length !== right.length) return null
  return left.map((item, i) => ({
    no: i + 1,
    question: item.question,
    before: item.answer,
    after: right[i].answer,
    changed: item.answer !== right[i].answer,
  }))
})

const localChangedCount = computed(
  () => answerDiff.value?.filter((item) => item.changed).length ?? null,
)

const changeLine = computed(() => {
  if (!a.value || !b.value) return ''
  if (localChangedCount.value !== null) {
    return `${localChangedCount.value} / 12 题选择不同`
  }
  const changed = changedAnswerCount(a.value, b.value)
  if (changed !== null) return `${changed} / 12 题选择不同`
  if (changedDims.value.length === 0) return '四维计数一致'
  return `${changedDims.value.length} 个维度题数有变化`
})

const typeChanges = computed(() => {
  const left = a.value?.type_code || ''
  const right = b.value?.type_code || ''
  return DIM_LIST.filter((d) => left.includes(d.left) !== right.includes(d.left)).map(
    (d) => `${d.left}/${d.right}`,
  )
})

const notes = computed(() => compare.value?.stability_notes || [])

const pickerRows = computed<PickRow[]>(() => options.value)

const pickerLabels = computed(() =>
  pickerRows.value.map(
    (r) =>
      `${dateLabel(r.submitted_at)} · ${r.type_code} · ${r.life_stage || '日常生活'}`,
  ),
)

const fromIndex = computed(() => {
  const i = pickerRows.value.findIndex((r) => r.id === a.value?.id)
  return i >= 0 ? i : 0
})
const toIndex = computed(() => {
  const i = pickerRows.value.findIndex((r) => r.id === b.value?.id)
  return i >= 0 ? i : 0
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await listResults({ limit: 100 })
    const quiz = res.items.filter((i) => i.source === 'quiz')
    const version = quiz[0]?.question_bank_version
    options.value = quiz.filter((i) => i.question_bank_version === version)
    const pair = chooseSummaryPair(options.value, baselineId.value, targetId.value)
    if (!pair[0] || !pair[1]) {
      a.value = null
      b.value = null
      localA.value = null
      localB.value = null
      compare.value = null
    } else {
      const [from, to] = await Promise.all([
        getResult(pair[0].id),
        getResult(pair[1].id),
      ])
      a.value = from
      b.value = to
      localA.value = getLocalAnswers(from.id)
      localB.value = getLocalAnswers(to.id)
      baselineId.value = from.id
      targetId.value = to.id
      compare.value = await compareResults(from.id, to.id)
    }
  } catch {
    error.value = '对比加载失败，请稍后再试。'
    a.value = null
    b.value = null
  } finally {
    loading.value = false
  }
}

function onPick(which: 'from' | 'to', e: { detail: { value: number | string } }) {
  const row = pickerRows.value[Number(e.detail.value)]
  if (!row) return
  if (which === 'from') {
    if (row.id === b.value?.id && a.value) {
      targetId.value = a.value.id
    }
    baselineId.value = row.id
  } else {
    if (row.id === a.value?.id && b.value) {
      baselineId.value = b.value.id
    }
    targetId.value = row.id
  }
  load()
}

function stageOf(record: ResultSnapshot): string {
  return record.life_stage || '日常生活'
}

function openRecord(id: string) {
  uni.navigateTo({ url: `/pages/history/detail?id=${id}` })
}

function goShare() {
  if (!a.value || !b.value) return
  uni.navigateTo({
    url: `/pages/journey-share/journey-share?baseline=${a.value.id}&target=${b.value.id}`,
  })
}

function goQuiz() {
  uni.reLaunch({ url: '/pages/index/index' })
}

function backToJourney() {
  uni.switchTab({ url: '/pages/history/list', fail: () => uni.reLaunch({ url: '/pages/history/list' }) })
}
</script>

<style scoped lang="scss">
.compare-page {
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


.state {
  padding-top: 160rpx;
  text-align: center;
}
.state-text {
  display: block;
  font-size: 26rpx;
  color: #77727e;
}

.type-transition {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 36rpx;
  padding: 40rpx 32rpx;
  border-radius: 32rpx;
  background: #eee8fa;
  border: 2rpx solid #e0d5f1;
}
.transition-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
}
.transition-date {
  font-size: 20rpx;
  color: #9a84b2;
}
.transition-type {
  margin: 10rpx 0;
  font-size: 64rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
  color: #a495b5;
}
.transition-type.current {
  color: #7552b5;
}
.transition-stage {
  font-size: 20rpx;
  color: #907e9f;
}
.transition-arrow {
  font-size: 40rpx;
  color: #b9a2ce;
}

.change-insight {
  padding: 32rpx 0 12rpx;
}
.insight-kicker {
  display: block;
  font-size: 20rpx;
  color: #9985b0;
}
.insight-title {
  display: block;
  margin-top: 16rpx;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 1.7;
}
.insight-desc {
  display: block;
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.9;
}

.section-title {
  display: block;
  margin: 28rpx 0 4rpx;
  font-size: 28rpx;
  font-weight: 700;
}

.compare-selects {
  display: flex;
  gap: 16rpx;
  margin-top: 20rpx;
}
.select-field {
  flex: 1;
  min-width: 0;
}
.select-label {
  display: block;
  font-size: 20rpx;
  color: #9c8da9;
}
.select-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10rpx;
  padding: 18rpx 20rpx;
  border-radius: 16rpx;
  border: 2rpx solid #e4ddeb;
  background: #fff;
}
.select-text {
  flex: 1;
  min-width: 0;
  font-size: 20rpx;
  color: #292630;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.select-arrow {
  margin-left: 8rpx;
  font-size: 20rpx;
  color: #a398af;
}

.dimension-compare {
  margin-top: 24rpx;
  padding: 2rpx 28rpx;
  border-radius: 28rpx;
  background: #fff;
  border: 2rpx solid #e8e1f1;
}
.dim-card {
  padding: 28rpx 0;
  border-bottom: 2rpx solid #efe9f5;
}
.dim-card:last-child {
  border-bottom: 0;
}
.dim-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 16rpx;
}
.dim-name {
  font-size: 24rpx;
  font-weight: 700;
  color: #645174;
}
.dim-pair {
  font-size: 20rpx;
  color: #a08db0;
}
.count-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 12rpx;
}
.count-label {
  font-size: 20rpx;
  color: #9887a7;
}
.count-dots {
  display: flex;
  gap: 8rpx;
}
.dot {
  width: 30rpx;
  height: 12rpx;
  border-radius: 8rpx;
  background: #f0ecf5;
}
.count-dots.before .dot.filled {
  background: #c4b2da;
}
.count-dots.after .dot.filled {
  background: #805ae0;
}
.count-value {
  font-size: 20rpx;
  font-weight: 600;
  color: #8c77a1;
}
.count-delta {
  margin-left: auto;
  font-size: 20rpx;
  color: #9b87ae;
}

.fine {
  display: block;
  margin-top: 18rpx;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.8;
}

.notes {
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
}
.answer-replay {
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
}
.replay-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.replay-title {
  font-size: 24rpx;
  font-weight: 600;
  color: #292630;
}
.replay-toggle {
  font-size: 20rpx;
  color: #7560df;
}
.replay-hint {
  display: block;
  margin-top: 8rpx;
  font-size: 20rpx;
  color: #a398af;
}
.replay-list {
  margin-top: 16rpx;
}
.replay-item {
  padding: 18rpx 0;
  border-top: 2rpx solid #f1edf6;
}
.replay-no {
  display: block;
  font-size: 20rpx;
  color: #b49aca;
}
.replay-question {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #5d5568;
  line-height: 1.6;
}
.replay-before {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #8f8298;
  line-height: 1.6;
}
.replay-after {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
  color: #292630;
  line-height: 1.6;
}
.replay-same {
  display: block;
  padding-top: 16rpx;
  border-top: 2rpx solid #f1edf6;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.7;
}
.note-line {
  display: block;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.8;
}

.reflection-card {
  margin-top: 32rpx;
  padding: 32rpx;
  border-radius: 28rpx;
  background: #ecf1e5;
}
.reflection-title {
  display: block;
  font-size: 26rpx;
  font-weight: 700;
  color: #60714c;
}
.reflection-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  line-height: 1.85;
  color: #829071;
}
.reflection-link {
  display: inline-block;
  margin-top: 16rpx;
  font-size: 22rpx;
  color: #73865a;
}

.empty {
  margin-top: 64rpx;
  padding: 56rpx 32rpx;
  border-radius: 32rpx;
  border: 2rpx dashed #d7cbe7;
  background: rgba(255, 255, 255, 0.6);
  text-align: center;
}
.empty-mark {
  display: block;
  font-size: 36rpx;
  letter-spacing: 10rpx;
  color: #b9a4da;
}
.empty-title {
  display: block;
  margin-top: 24rpx;
  font-size: 32rpx;
  font-weight: 800;
  line-height: 1.5;
}
.empty-desc {
  display: block;
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.8;
}
.empty-btn {
  margin: 36rpx 0 16rpx;
}
.textbtn {
  display: inline-block;
  margin-top: 24rpx;
  font-size: 22rpx;
  color: #7560df;
}

.btn-ghost {
  margin-top: 20rpx;
  padding: 24rpx 40rpx;
  text-align: center;
  font-size: 28rpx;
  color: #7560df;
}
.mt {
  margin-top: 28rpx;
}
</style>
