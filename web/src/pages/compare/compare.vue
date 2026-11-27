<template>
  <view class="page" :class="{ 'comparison-page': ready }">
    <proto-nav />
    <DemoStrip />

    <StateView v-if="loading" state="loading" title="正在准备对比…" />

    <template v-else-if="error">
      <view class="page-intro">
        <view class="eyebrow">THEN & NOW / 前后对比</view>
        <view class="h1">对比加载失败</view>
        <view class="p">{{ error }}</view>
      </view>
      <view v-if="!incomparable" class="btn secondary full" @click="load">重新加载</view>
      <view class="btn ghost full mt" @click="backToJourney">回到我的轨迹</view>
    </template>

    <template v-else-if="ready && a && b">
      <view class="page-intro">
        <view class="eyebrow">THEN & NOW / 前后对比</view>
        <view class="h1">
          <text class="title-line">{{ compareCopy.title }}</text>
          <text class="title-line">{{ compareCopy.accent }}</text>
        </view>
        <view class="p">{{ compareCopy.description }}</view>
      </view>

      <view class="compare-selects">
        <view class="select-field">
          <text class="label">之前</text>
          <picker
            :range="pickerLabels"
            :value="fromIndex"
            @change="onPick('from', $event)"
          >
            <view class="select-box">{{ pickerLabels[fromIndex] || '选择记录' }}</view>
          </picker>
        </view>
        <view class="select-field">
          <text class="label">这次</text>
          <picker
            :range="pickerLabels"
            :value="toIndex"
            @change="onPick('to', $event)"
          >
            <view class="select-box">{{ pickerLabels[toIndex] || '选择记录' }}</view>
          </picker>
        </view>
      </view>

      <view class="type-transition">
        <view class="transition-side">
          <text class="small">{{ dateLabel(a.submitted_at, true) }}</text>
          <text class="strong">{{ a.type_code }}</text>
          <text class="span">{{ stageOf(a) }}</text>
        </view>
        <text class="b">{{ sameType ? '＝' : '→' }}</text>
        <view class="transition-side">
          <text class="small">{{ dateLabel(b.submitted_at, true) }}</text>
          <text class="strong">{{ b.type_code }}</text>
          <text class="span">{{ stageOf(b) }}</text>
        </view>
      </view>

      <view class="change-insight">
        <text class="span">{{ days ? `相隔 ${days} 天` : '同一天的两次作答' }} · {{ changeLine }}</text>
        <view class="h3">{{ summary }}</view>
        <view class="p">{{ insightDesc }}</view>
        <view v-for="(note, i) in notes" :key="i" class="p">{{ note }}</view>
      </view>

      <view class="small-section-title">四个维度，具体哪里不同？</view>

      <view class="dimension-compare">
        <view v-for="row in dimRows" :key="row.key" class="dim-row">
          <view class="dimension-name">
            <text class="b">{{ row.name }}</text>
            <text class="span">{{ row.left }} / {{ row.right }}</text>
          </view>
          <view class="count-row">
            <text>之前</text>
            <view class="count-dots before">
              <text
                v-for="n in 3"
                :key="'b' + n"
                class="i"
                :class="{ filled: n <= row.before }"
              />
            </view>
            <text class="b">{{ row.right }} {{ row.before }}/3</text>
          </view>
          <view class="count-row">
            <text>这次</text>
            <view class="count-dots after">
              <text
                v-for="n in 3"
                :key="'a' + n"
                class="i"
                :class="{ filled: n <= row.after }"
              />
            </view>
            <text class="b">{{ row.right }} {{ row.after }}/3</text>
            <text class="em">{{ deltaText(row.delta) }}</text>
          </view>
        </view>
      </view>
      <text class="fine">
        每个维度只有 3 道题，圆点表示选到右侧偏好的题数，不是人格强度、准确率或成长分数。
      </text>

      <!-- TODO: 待 Remy 确认「历史作答回放」服务端接口；当前仅回放本机保存的作答 -->
      <view v-if="answerDiff" class="record-answers">
        <view class="answers-summary" @click="showAnswerDiff = !showAnswerDiff">
          查看 {{ localChangedCount }} 道不同的回答
        </view>
        <view v-if="showAnswerDiff">
          <view v-for="item in changedAnswers" :key="item.no" class="answer-item">
            <text class="small">{{ String(item.no).padStart(2, '0') }} / {{ item.question }}</text>
            <view class="p answer-before">之前：{{ item.before }}</view>
            <view class="p">这次：{{ item.after }}</view>
          </view>
          <view v-if="localChangedCount === 0" class="p">
            12 道题的选择完全相同。稳定也是这次记录的一部分。
          </view>
        </view>
      </view>

      <view class="reflection-card">
        <view class="h3">把变化放回生活里看</view>
        <view class="p">
          可以想想：最近的生活节奏、环境或作答理解有没有不同？这里不把阶段标签当成变化的因果解释。
        </view>
        <text class="textbtn" @click="openRecord(b.id)">回看这次阶段记录 →</text>
      </view>

      <view class="btn full mt" @click="goShare">把这段变化，做成一张图</view>
      <view class="btn ghost full mt" @click="backToJourney">回到我的轨迹</view>
    </template>

    <template v-else>
      <view class="page-intro">
        <view class="eyebrow">THEN & NOW / 前后对比</view>
        <view class="h1">
          <text class="title-line">{{ compareCopy.emptyTitle }}</text>
          <text class="title-line">{{ compareCopy.emptyAccent }}</text>
        </view>
        <view class="p">{{ compareCopy.emptyDescription }}</view>
      </view>
      <view class="btn full" @click="goQuiz">免费记录现在的我</view>
      <view class="btn secondary full mt" @click="backToJourney">查看已有记录</view>
    </template>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import StateView from '@/components/state-view.vue'
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import type {
  CompareResult,
  ResultSnapshot,
  ResultSnapshotSummary,
} from '@/api/types'
import { compareResults, getResult, listResults } from '@/api/results'
import { HttpError, requestErrorMessage } from '@/api/client'
import { getLocalAnswers, type LocalAnswerRecord } from '@/store/local-answers'
import {
  DIM_LIST,
  changedAnswerCount,
  chooseSummaryPair,
  dateLabel,
  daysBetween,
  dimCompareRows,
  summaryText,
} from '@/constants/journey'
import { ensurePublishedConfig, published } from '@/store/published'

type PickRow = ResultSnapshotSummary & { recent_status?: string }

const COMPARE_FALLBACK = {
  title: '变了多少，', accent: '让答案自己说。', description: '比较你选择的两个阶段；没有高低阶，也没有“更好的人格”。',
  emptyTitle: '再留一份记录，', emptyAccent: '就能看见前后差别。', emptyDescription: '只比较同一题目、计分规则和回顾时间窗下的两次结果。',
}
const compareCopy = computed(() => published.copy?.compare ?? COMPARE_FALLBACK)

const baselineId = ref('')
const targetId = ref('')
const loading = ref(true)
const error = ref('')
const incomparable = ref(false)
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
  void ensurePublishedConfig()
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

const changedAnswers = computed(
  () => answerDiff.value?.filter((item) => item.changed) ?? [],
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

const insightDesc = computed(() => {
  const typePart = typeChanges.value.length
    ? `变化的类型维度：${typeChanges.value.join('、')}。`
    : '四字母标签保持一致。'
  const intervalPart =
    days.value < 7 ? '这两次间隔较短，先作为作答波动记录。' : '可结合当时的生活情境回看。'
  return `${typePart}${intervalPart} 结果不证明真实人格发生改变。`
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
  incomparable.value = false
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
  } catch (e) {
    a.value = null
    b.value = null
    compare.value = null
    if (e instanceof HttpError && e.status === 422) {
      incomparable.value = true
      error.value = '这两份结果来自不同题库版本，或不是完整的测评记录，无法直接对比。'
    } else {
      error.value = requestErrorMessage(e, '对比加载失败，请稍后再试。')
    }
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

function deltaText(delta: number): string {
  if (delta === 0) return '相同'
  return (delta > 0 ? '+' : '') + delta + ' 题'
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
.title-line {
  display: block;
}

.demo-strip .textbtn {
  font-size: 9px;
  color: #a197ad;
}

.select-field {
  min-width: 0;
}
.select-box {
  display: flex;
  align-items: center;
  padding: 10px 7px;
  font-size: 11px;
  color: var(--ink);
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 13px;
  min-height: 49px;
  margin-top: 7px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.transition-side {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.transition-side:first-child .strong {
  color: #a495b5;
}

.dim-row {
  padding: 17px 0;
  border-bottom: 1px solid #efe9f5;
}
.dim-row:last-child {
  border: 0;
}

.count-dots .i {
  display: block;
}

.answers-summary {
  font-size: 12px;
  color: #6f5b82;
  padding: 17px 0;
  min-height: 48px;
  box-sizing: border-box;
}
.answer-item {
  padding: 15px 0;
  border-top: 1px solid #efe8f5;
}

.small-section-title {
  font-size: 23px;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: -0.7px;
}
.change-insight .h3 {
  font-weight: 700;
}
.reflection-card .h3 {
  font-weight: 700;
  margin: 0 0 15px;
}
</style>
