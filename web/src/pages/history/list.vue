<template>
  <view class="page journey-page">
    <text class="kicker">MY MBTI JOURNEY / 我的轨迹</text>
    <view class="title">
      <text>我还是我，</text>
      <text>也有新的样子。</text>
    </view>
    <text class="sub">留下每个阶段的答案，看看哪些在变化、哪些一直没变。</text>

    <text class="private-badge">🔒 默认仅自己可见 · 本机保存</text>

    <view v-if="loading" class="state"><text class="state-text">正在读取记录…</text></view>

    <view v-else-if="loadError" class="state">
      <text class="state-text">轨迹读取失败</text>
      <view class="btn-secondary mt" @click="load">重试</view>
    </view>

    <template v-else>
      <template v-if="rows.length">
        <view class="journey-summary">
          <text class="summary-kicker">属于自己的阶段档案</text>
          <view class="summary-main">
            <text class="summary-count">{{ rows.length }}</text>
            <text class="summary-unit">次记录</text>
            <text class="summary-type">{{ lastValid?.type_code || rows[0].type_code }}</text>
          </view>
          <text class="summary-text">{{ summary }}</text>
          <text v-if="prevValid && lastValid" class="summary-link" @click="goCompare">
            看看这两次哪里不同 →
          </text>
        </view>

        <view v-if="chartRows.length >= 2" class="journey-chart">
          <view class="chart-dims">
            <view
              v-for="d in DIM_LIST"
              :key="d.key"
              class="chart-dim"
              :class="{ active: chartDim === d.key }"
              @click="chartDim = d.key"
            >
              <text>{{ d.left }} / {{ d.right }}</text>
            </view>
          </view>
          <view class="chart-label">
            <text class="chart-name">{{ chartMeta.name }}</text>
            <text class="chart-unit">{{ chartMeta.rightLabel }}选项题数 / 3</text>
          </view>
          <view class="plot">
            <view
              v-for="g in gridLines"
              :key="g.n"
              class="grid-line"
              :style="{ top: g.y + 'rpx' }"
            >
              <text class="grid-label">{{ g.n }}</text>
            </view>
            <view
              v-for="(s, i) in chartSegments"
              :key="'seg' + i"
              class="chart-seg"
              :style="{
                left: s.cx + 'rpx',
                top: s.cy + 'rpx',
                width: s.len + 'rpx',
                transform: `translate(-50%, -50%) rotate(${s.deg}deg)`,
              }"
            />
            <view
              v-for="(p, i) in chartPoints"
              :key="'dot' + i"
              class="chart-point"
              :style="{ left: p.x + 'rpx', top: p.y + 'rpx' }"
            >
              <text class="point-val">{{ p.count }}</text>
            </view>
            <text class="axis-label first">{{ dateLabel(chartRows[0].submitted_at, true) }}</text>
            <text class="axis-label last">
              {{ dateLabel(chartRows[chartRows.length - 1].submitted_at, true) }}
            </text>
          </view>
          <view class="chart-data">
            <text class="chart-toggle" @click="showChartTable = !showChartTable">
              查看具体题数（{{ chartRows.length }} 次）
            </text>
            <view v-if="showChartTable" class="chart-table">
              <view class="chart-tr chart-th">
                <text>日期</text>
                <text>类型</text>
                <text>{{ chartMeta.left }}</text>
                <text>{{ chartMeta.right }}</text>
              </view>
              <view v-for="r in chartRows" :key="r.id" class="chart-tr">
                <text>{{ dateLabel(r.submitted_at) }}</text>
                <text>{{ r.type_code }}</text>
                <text>{{ r.dimension_counts?.[chartMeta.left] ?? 0 }}/3</text>
                <text>{{ r.dimension_counts?.[chartMeta.right] ?? 0 }}/3</text>
              </view>
            </view>
          </view>
          <text class="chart-fine">
            最近 {{ chartRows.length }} 次同版本记录；横轴为时间，连线仅用于阅读。结果可能受作答状态和测量误差影响。
          </text>
        </view>

        <view v-else class="chart-empty">
          <text class="chart-empty-step">01 → 02</text>
          <text class="chart-empty-title">下一次回来，就有了对照。</text>
          <text class="chart-empty-desc">同版本完成两次后显示趋势；旧版无日期记录不接入折线。</text>
        </view>

        <view class="timeline-heading">
          <text class="timeline-title">我的阶段记录</text>
          <text class="timeline-hint">最新在前</text>
        </view>

        <view class="record-timeline">
          <view
            v-for="(item, i) in rows"
            :key="item.id"
            class="record-tile"
            @click="openRecord(item)"
          >
            <view class="record-node"><text>{{ pad(rows.length - i) }}</text></view>
            <view class="record-body">
              <text class="record-date">{{ recordDate(item) }}</text>
              <view class="record-head">
                <text class="record-type">{{ item.type_code }}</text>
                <text class="record-stage">{{ recordTitle(item) }}</text>
                <text v-if="item.source === 'self_select'" class="record-tag">自行选择</text>
              </view>
              <text class="record-note">{{ recordNote(item) }}</text>
            </view>
            <text class="record-chev">↗</text>
          </view>
        </view>
      </template>

      <view v-else class="history-empty">
        <view class="empty-orbits">
          <text class="orbit-now">NOW</text>
          <text class="orbit-star">✦</text>
          <text class="orbit-next">NEXT</text>
        </view>
        <text class="empty-title">今天的你，就是第一个起点。</text>
        <text class="empty-desc">每次完成测试都会新增一份记录。重测不覆盖过去，也不扣费。</text>
        <view class="btn-primary empty-btn" @click="goQuiz">建立我的第一份记录</view>
      </view>

      <view>
        <view v-if="rows.length" class="btn-primary mt" @click="goQuiz">
          记录现在的我 · 免费复测
        </view>

        <view class="review-plan">
          <text class="review-kicker">下次再认识一下自己</text>
          <text class="review-title">
            {{ reviewDate ? dateLabel(reviewDate + 'T12:00:00') : '给下一次回访，留个约定。' }}
          </text>
          <text class="review-desc">
            {{ reviewDate ? '本机计划已保存，不会自动发送提醒。' : '可以隔一段时间或生活阶段变化后再来。' }}
          </text>
          <view class="review-actions">
            <text class="review-btn" @click="openReviewPlan">
              {{ reviewDate ? '修改计划' : '设定复测计划' }}
            </text>
            <text v-if="reviewDate" class="review-link" @click="exportCalendar">导出日历事项</text>
            <text v-if="reviewDate" class="review-link" @click="clearReviewPlan">取消计划</text>
          </view>
        </view>
      </view>

      <text class="notice">
        这是原创 12 题趣味记录。类型变化不等于人格已经改变；同样的四个字母，也可能有不同的具体回答。
      </text>

      <view v-if="rows.length" class="journey-footer-actions">
        <text class="textbtn" @click="exportHistory">导出我的记录 JSON</text>
      </view>
    </template>

    <!-- 设定复测计划 -->
    <view v-if="planOpen" class="modal-backdrop" @click="planOpen = false">
      <view class="plan-sheet" @click.stop>
        <view class="sheet-handle" />
        <text class="sheet-close" @click="planOpen = false">✕</text>
        <text class="sheet-kicker">— MBTI搭子 / 阶段记录</text>
        <text class="sheet-title">下一次，什么时候回来？</text>
        <text class="sheet-desc">
          可以按阶段回访。时间间隔只是个人安排，不是判断人格变化的科学阈值。
        </text>

        <view class="plan-chips">
          <view class="plan-chip" :class="{ active: planChoice === 30 }" @click="choosePreset(30)">
            <text>30 天后</text>
          </view>
          <view class="plan-chip" :class="{ active: planChoice === 90 }" @click="choosePreset(90)">
            <text>90 天后</text>
          </view>
        </view>

        <text class="plan-label">自己选一天</text>
        <!-- #ifndef H5 -->
        <picker mode="date" :value="planDate" :start="planMinDate" @change="onPickDate">
          <view class="date-row">
            <text class="date-value">{{ planDateText }}</text>
            <view class="cal-icon">
              <view class="cal-dot" />
              <view class="cal-dot" />
              <view class="cal-dot" />
              <view class="cal-dot" />
            </view>
          </view>
        </picker>
        <!-- #endif -->
        <!-- #ifdef H5 -->
        <view class="date-row" @click="openNativeDate">
          <text class="date-value">{{ planDateText }}</text>
          <view class="cal-icon">
            <view class="cal-dot" />
            <view class="cal-dot" />
            <view class="cal-dot" />
            <view class="cal-dot" />
          </view>
        </view>
        <!-- #endif -->

        <view class="btn-primary plan-save" @click="saveReviewPlan">保存本机计划</view>
        <text class="plan-foot">不会发送短信、微信或系统通知；保存后可导出日历事项。</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type {
  DimensionCounts,
  ResultSnapshot,
  ResultSnapshotSummary,
} from '@/api/types'
import { getResult, listResults } from '@/api/results'
import {
  DIM_LIST,
  DIM_MAP,
  dateLabel,
  summaryText,
  type DimKey,
  type JourneyRecord,
} from '@/constants/journey'

type TimelineRow = ResultSnapshotSummary & {
  recent_status?: string
}

interface ChartPoint {
  x: number
  y: number
  count: number
}

const REVIEW_KEY = 'mbti_journey_review_v1'

const summaries = ref<ResultSnapshotSummary[]>([])
const details = ref<JourneyRecord[]>([])
const loading = ref(true)
const loadError = ref(false)
const chartDim = ref<DimKey>('EI')
const showChartTable = ref(false)
const reviewDate = ref('')
const planOpen = ref(false)
const planChoice = ref<0 | 30 | 90>(0)
const planDate = ref('')
const planMinDate = ref('')

const rows = computed<TimelineRow[]>(() => summaries.value)

const planDateText = computed(() => planDate.value.replaceAll('-', '/'))

const ownVersion = computed(
  () => summaries.value.find((i) => i.source === 'quiz')?.question_bank_version || '',
)

const chartRows = computed<JourneyRecord[]>(() => {
  const version = ownVersion.value
  return details.value
    .filter(
      (r) =>
        r.source === 'quiz' &&
        r.question_bank_version === version &&
        !!r.dimension_counts,
    )
    .slice()
    .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))
    .slice(-6)
})

const validRecords = computed(() => chartRows.value.slice().reverse())
const lastValid = computed(() => validRecords.value[0] || null)
const prevValid = computed(() => validRecords.value[1] || null)

const summary = computed(() => {
  if (prevValid.value && lastValid.value) {
    return summaryText(prevValid.value, lastValid.value)
  }
  if (lastValid.value) {
    return '第一份基线已经留好，下次复测会新增记录。'
  }
  return '旧版记录已保留；重新测试后建立可比较的基线。'
})

const chartMeta = computed(() => DIM_MAP[chartDim.value])

const gridLines = computed(() =>
  [3, 2, 1, 0].map((n) => ({ n, y: 20 + (3 - n) * 60 })),
)

function rightCount(record: ResultSnapshot, dim: DimKey): number {
  const meta = DIM_MAP[dim]
  return record.dimension_counts?.[meta.right as keyof DimensionCounts] ?? 0
}

const chartPoints = computed<ChartPoint[]>(() => {
  const list = chartRows.value
  if (list.length < 2) return []
  const span = 560 / (list.length - 1)
  return list.map((r, i) => ({
    x: Math.round(i * span),
    y: 20 + (3 - rightCount(r, chartDim.value)) * 60,
    count: rightCount(r, chartDim.value),
  }))
})

const chartSegments = computed(() =>
  chartPoints.value.slice(1).map((p, i) => {
    const prev = chartPoints.value[i]
    const dx = p.x - prev.x
    const dy = p.y - prev.y
    return {
      cx: Math.round((p.x + prev.x) / 2),
      cy: Math.round((p.y + prev.y) / 2),
      len: Math.round(Math.sqrt(dx * dx + dy * dy)),
      deg: Math.round((Math.atan2(dy, dx) * 180) / Math.PI),
    }
  }),
)

onShow(() => {
  loadReviewPlan()
  load()
})

async function load() {
  if (!summaries.value.length) loading.value = true
  loadError.value = false
  try {
    const res = await listResults({ limit: 50 })
    summaries.value = res.items
    const quiz = res.items.filter((i) => i.source === 'quiz')
    const version = quiz[0]?.question_bank_version
    const candidates = quiz
      .filter((i) => i.question_bank_version === version)
      .slice(0, 6)
    const loaded = await Promise.all(
      candidates.map((i) => getResult(i.id).catch(() => null)),
    )
    details.value = loaded.filter((r): r is JourneyRecord => !!r)
  } catch {
    summaries.value = []
    details.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function loadReviewPlan() {
  try {
    const stored = uni.getStorageSync(REVIEW_KEY)
    reviewDate.value = typeof stored === 'string' ? stored : ''
  } catch {
    reviewDate.value = ''
  }
}

function recordTitle(row: TimelineRow): string {
  return (
    row.life_stage ||
    (row.source === 'self_select' ? '自行选择' : '日常生活')
  )
}

function recordNote(row: TimelineRow): string {
  if (!row.submitted_at) return '保留旧结果，不补造日期或曲线'
  if (row.source === 'self_select') return '自行选择类型 · 不做四维比较'
  if (row.recent_status) return `${row.recent_status} · 仅作为回看背景`
  return '近期状态未记录'
}

function recordDate(row: TimelineRow): string {
  return row.submitted_at ? dateLabel(row.submitted_at) : '测试日期未知 · 旧版导入'
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function openRecord(item: TimelineRow) {
  uni.navigateTo({ url: `/pages/history/detail?id=${item.id}` })
}

function goCompare() {
  if (!prevValid.value || !lastValid.value) return
  uni.navigateTo({
    url: `/pages/compare/compare?baseline=${prevValid.value.id}&target=${lastValid.value.id}`,
  })
}

function goQuiz() {
  uni.reLaunch({ url: '/pages/index/index' })
}

function dateToStr(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function presetOf(date: string): 0 | 30 | 90 {
  const target = new Date(`${date}T00:00:00`).getTime()
  const today = new Date(`${dateToStr(new Date())}T00:00:00`).getTime()
  const days = Math.round((target - today) / 86400000)
  if (days === 30) return 30
  if (days === 90) return 90
  return 0
}

function openReviewPlan() {
  planMinDate.value = dateToStr(new Date())
  if (reviewDate.value) {
    planDate.value = reviewDate.value
    planChoice.value = presetOf(reviewDate.value)
  } else {
    planDate.value = planMinDate.value
    planChoice.value = 0
  }
  planOpen.value = true
}

function choosePreset(days: 30 | 90) {
  planChoice.value = days
  planDate.value = dateToStr(new Date(Date.now() + days * 86400000))
}

function onPickDate(e: { detail: { value: number | string } }) {
  const value = String(e.detail.value || '')
  if (!value) return
  planDate.value = value
  planChoice.value = 0
}

/** H5 用浏览器原生日期选择器，避免 uni-app 日期弹层在底部弹层内不显示 */
// #ifdef H5
function openNativeDate() {
  const input = document.createElement('input')
  input.type = 'date'
  input.value = planDate.value
  input.min = planMinDate.value
  input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0'
  document.body.appendChild(input)
  const timer = setTimeout(() => input.remove(), 8000)
  input.addEventListener('change', () => {
    if (input.value) {
      planDate.value = input.value
      planChoice.value = 0
    }
    clearTimeout(timer)
    input.remove()
  })
  if (typeof input.showPicker === 'function') input.showPicker()
  else input.click()
}
// #endif

function saveReviewPlan() {
  if (!planDate.value) return
  reviewDate.value = planDate.value
  uni.setStorageSync(REVIEW_KEY, reviewDate.value)
  planOpen.value = false
  uni.showToast({ title: '已保存本机计划', icon: 'none' })
}

function clearReviewPlan() {
  uni.showModal({
    title: '取消复测计划？',
    content: '只会移除本机提醒计划，不影响任何阶段记录。',
    confirmText: '取消计划',
    success: (res) => {
      if (!res.confirm) return
      reviewDate.value = ''
      uni.removeStorageSync(REVIEW_KEY)
      uni.showToast({ title: '已取消', icon: 'none' })
    },
  })
}

function exportCalendar() {
  if (!reviewDate.value) return
  const ds = reviewDate.value.replaceAll('-', '')
  const [y, m, d] = reviewDate.value.split('-').map(Number)
  const end = new Date(Date.UTC(y, m - 1, d + 1))
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '')
  const text = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MBTI Buddy//Stage Review//ZH',
    'BEGIN:VEVENT',
    `UID:mbti-review-${ds}@local`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART;VALUE=DATE:${ds}`,
    `DTEND;VALUE=DATE:${end}`,
    'SUMMARY:给自己留一份阶段记录',
    'DESCRIPTION:自愿复测与回看，不要求得到不同类型。',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  downloadOrCopy(text, 'MBTI搭子-阶段回访.ics', 'text/calendar')
}

async function exportHistory() {
  try {
    const res = await listResults({ limit: 100 })
    const loaded = await Promise.all(
      res.items.map((i) => getResult(i.id).catch(() => null)),
    )
    const payload = {
      format: 'mbti-buddy-private-history-v1',
      exportedAt: new Date().toISOString(),
      records: loaded.filter((r) => !!r),
    }
    downloadOrCopy(
      JSON.stringify(payload, null, 2),
      'MBTI搭子-我的私密记录.json',
      'application/json',
    )
  } catch {
    uni.showToast({ title: '导出失败，请稍后再试', icon: 'none' })
  }
}

function downloadOrCopy(text: string, filename: string, mime: string) {
  // #ifdef H5
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
  // #endif
  // #ifndef H5
  uni.setClipboardData({
    data: text,
    success: () => uni.showToast({ title: '已复制到剪贴板', icon: 'none' }),
  })
  // #endif
}
</script>

<style scoped lang="scss">
.journey-page {
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

.private-badge {
  display: inline-block;
  margin-top: 24rpx;
  padding: 10rpx 18rpx;
  border-radius: 12rpx;
  background: #eef4e9;
  color: #6e8064;
  font-size: 20rpx;
}

.state {
  padding-top: 160rpx;
  text-align: center;
}
.state-text {
  font-size: 26rpx;
  color: #77727e;
}

.journey-summary {
  position: relative;
  overflow: hidden;
  margin-top: 28rpx;
  padding: 36rpx 32rpx;
  border-radius: 32rpx;
  background: #2e253e;
  color: #fff;
}
.journey-summary::after {
  content: '✦';
  position: absolute;
  right: 0;
  bottom: -70rpx;
  font-size: 200rpx;
  color: rgba(191, 224, 171, 0.16);
  pointer-events: none;
}
.summary-kicker {
  position: relative;
  font-size: 20rpx;
  color: #c9bcdc;
}
.summary-main {
  position: relative;
  display: flex;
  align-items: baseline;
  margin-top: 18rpx;
}
.summary-count {
  font-size: 76rpx;
  font-weight: 800;
  letter-spacing: -3rpx;
  line-height: 1;
}
.summary-unit {
  margin-left: 14rpx;
  font-size: 22rpx;
  color: #cbbfda;
}
.summary-type {
  margin-left: auto;
  font-size: 56rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
  color: #c7e3b0;
}
.summary-text {
  position: relative;
  display: block;
  margin-top: 22rpx;
  font-size: 24rpx;
  line-height: 1.8;
  color: #ddd4e7;
}
.summary-link {
  position: relative;
  display: inline-block;
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #d7c7ff;
}

.journey-chart {
  margin-top: 28rpx;
  padding: 28rpx;
  border-radius: 28rpx;
  background: #fff;
  border: 2rpx solid #e9e2f0;
}
.chart-dims {
  display: flex;
  gap: 10rpx;
  margin-bottom: 24rpx;
}
.chart-dim {
  flex: 1;
  padding: 16rpx 0;
  border-radius: 14rpx;
  background: #f4f1f8;
  text-align: center;
  font-size: 20rpx;
  color: #8c819c;
}
.chart-dim.active {
  background: #7555e8;
  color: #fff;
}
.chart-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.chart-name {
  font-size: 26rpx;
  font-weight: 700;
}
.chart-unit {
  font-size: 20rpx;
  color: #a194ad;
}

.plot {
  position: relative;
  height: 260rpx;
  margin: 20rpx 24rpx 0 40rpx;
}
.grid-line {
  position: absolute;
  left: 0;
  right: 0;
  height: 2rpx;
  background: #e9e4f0;
}
.grid-label {
  position: absolute;
  left: -34rpx;
  top: -16rpx;
  font-size: 20rpx;
  color: #8d8399;
}
.chart-seg {
  position: absolute;
  height: 4rpx;
  border-radius: 2rpx;
  background: #7151e8;
  transform-origin: center;
}
.chart-point {
  position: absolute;
  width: 18rpx;
  height: 18rpx;
  border-radius: 50%;
  background: #7151e8;
  border: 4rpx solid #fff;
  box-sizing: border-box;
  transform: translate(-50%, -50%);
}
.point-val {
  position: absolute;
  left: 50%;
  top: -34rpx;
  width: 60rpx;
  transform: translateX(-50%);
  text-align: center;
  font-size: 22rpx;
  font-weight: 700;
  color: #5841ac;
}
.axis-label {
  position: absolute;
  bottom: 0;
  font-size: 20rpx;
  color: #8d8399;
}
.axis-label.first {
  left: 0;
}
.axis-label.last {
  right: 0;
}

.chart-data {
  margin-top: 12rpx;
}
.chart-toggle {
  display: inline-block;
  padding: 12rpx 0;
  font-size: 22rpx;
  color: #8b789d;
}
.chart-table {
  margin-top: 6rpx;
}
.chart-tr {
  display: flex;
  padding: 12rpx 0;
  border-bottom: 2rpx solid #eee9f3;
  font-size: 22rpx;
  color: #292630;
}
.chart-tr > text {
  flex: 1;
}
.chart-th {
  color: #8d7c9c;
}
.chart-fine {
  display: block;
  margin-top: 14rpx;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.7;
}

.chart-empty {
  margin-top: 28rpx;
  padding: 48rpx 28rpx;
  border-radius: 28rpx;
  border: 2rpx dashed #d7cbe7;
  background: rgba(255, 255, 255, 0.6);
  text-align: center;
}
.chart-empty-step {
  display: block;
  font-size: 36rpx;
  letter-spacing: 12rpx;
  color: #b9a4da;
}
.chart-empty-title {
  display: block;
  margin-top: 20rpx;
  font-size: 28rpx;
  font-weight: 700;
}
.chart-empty-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.7;
}

.timeline-heading {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 40rpx 0 16rpx;
}
.timeline-title {
  font-size: 30rpx;
  font-weight: 700;
}
.timeline-hint {
  font-size: 20rpx;
  color: #a395af;
}

.record-timeline {
  position: relative;
}
.record-timeline::before {
  content: '';
  position: absolute;
  left: 30rpx;
  top: 30rpx;
  bottom: 30rpx;
  width: 2rpx;
  background: #ded5eb;
}
.record-tile {
  position: relative;
  display: flex;
  align-items: center;
  padding: 20rpx 0;
}
.record-node {
  flex-shrink: 0;
  width: 60rpx;
  height: 60rpx;
  margin-top: 6rpx;
  border-radius: 50%;
  background: #eee7f8;
  border: 8rpx solid #faf8ff;
  color: #8a74ad;
  font-size: 18rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  align-self: flex-start;
}
.record-body {
  flex: 1;
  min-width: 0;
  margin-left: 20rpx;
  padding-bottom: 20rpx;
  border-bottom: 2rpx solid #eee7f3;
}
.record-date {
  display: block;
  font-size: 20rpx;
  color: #9b8ba9;
}
.record-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 8rpx;
}
.record-type {
  font-size: 40rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
}
.record-stage {
  font-size: 22rpx;
  color: #766882;
}
.record-tag {
  font-size: 18rpx;
  color: #2f8f6b;
  background: #e3f4ec;
  border-radius: 999rpx;
  padding: 2rpx 12rpx;
}
.record-note {
  display: block;
  margin-top: 8rpx;
  font-size: 20rpx;
  color: #a398ac;
}
.record-chev {
  margin-left: 10rpx;
  font-size: 30rpx;
  color: #b6a5c7;
}

.history-empty {
  margin-top: 32rpx;
  padding: 56rpx 28rpx 44rpx;
  border-radius: 32rpx;
  border: 2rpx solid #ece5f3;
  background: #fff;
  text-align: center;
}
.empty-orbits {
  position: relative;
  height: 190rpx;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 24rpx;
}
.orbit-now,
.orbit-next {
  width: 150rpx;
  height: 150rpx;
  border: 2rpx solid #d5cae8;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  letter-spacing: 3rpx;
  color: #6d578d;
}
.orbit-now {
  background: #eee6fb;
  transform: rotate(-12deg);
  margin-right: -24rpx;
}
.orbit-next {
  background: #e9f0df;
  transform: rotate(12deg);
  margin-left: -24rpx;
}
.orbit-star {
  position: relative;
  z-index: 1;
  font-size: 60rpx;
  color: #8b6fc1;
}
.empty-title {
  display: block;
  font-size: 34rpx;
  font-weight: 800;
}
.empty-desc {
  display: block;
  margin-top: 14rpx;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.9;
}
.empty-btn {
  margin: 36rpx 0 20rpx;
}
.textbtn {
  font-size: 22rpx;
  color: #7560df;
}

.review-plan {
  margin-top: 32rpx;
  padding: 28rpx;
  border-radius: 28rpx;
  border: 2rpx solid #e0e7d6;
  background: #f0f4e9;
}
.review-kicker {
  font-size: 20rpx;
  letter-spacing: 1rpx;
  color: #8a977c;
}
.review-title {
  display: block;
  margin-top: 12rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: #526148;
}
.review-desc {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #8c9483;
}
.review-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 20rpx;
  margin-top: 20rpx;
}
.review-btn {
  padding: 14rpx 28rpx;
  border-radius: 999rpx;
  border: 2rpx solid #d8e1cb;
  background: #fff;
  font-size: 22rpx;
  color: #526148;
}
.review-link {
  font-size: 22rpx;
  color: #728264;
}

.notice {
  display: block;
  margin-top: 36rpx;
  padding: 24rpx;
  border-radius: 20rpx;
  background: #f1ecfb;
  font-size: 20rpx;
  color: #77727e;
  line-height: 1.8;
}

.journey-footer-actions {
  display: flex;
  justify-content: space-between;
  gap: 20rpx;
  margin-top: 32rpx;
}

.mt {
  margin-top: 36rpx;
}

.modal-backdrop {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 1000;
  background: rgba(43, 33, 51, 0.37);
  display: flex;
  align-items: flex-end;
}
.plan-sheet {
  position: relative;
  width: 100%;
  background: #f8f7f4;
  border-radius: 36rpx 36rpx 0 0;
  padding: 20rpx 36rpx calc(48rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}
.sheet-handle {
  width: 64rpx;
  height: 6rpx;
  border-radius: 999rpx;
  background: #d9d2dd;
  margin: 0 auto 28rpx;
}
.sheet-close {
  position: absolute;
  top: 28rpx;
  right: 32rpx;
  width: 60rpx;
  height: 60rpx;
  line-height: 60rpx;
  text-align: center;
  border-radius: 50%;
  background: #efeaf0;
  font-size: 26rpx;
  color: #77727e;
}
.sheet-kicker {
  display: block;
  font-size: 20rpx;
  letter-spacing: 2rpx;
  color: #7560df;
}
.sheet-title {
  display: block;
  margin-top: 20rpx;
  font-size: 44rpx;
  font-weight: 800;
  line-height: 1.35;
  letter-spacing: -1rpx;
  color: #17141c;
}
.sheet-desc {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  line-height: 1.7;
  color: #77727e;
}
.plan-chips {
  display: flex;
  gap: 20rpx;
  margin-top: 32rpx;
}
.plan-chip {
  flex: 1;
  height: 96rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 20rpx;
  border: 2rpx solid #ece7f1;
  background: #fff;
  font-size: 28rpx;
  font-weight: 700;
  color: #292630;
  box-sizing: border-box;
}
.plan-chip.active {
  border-color: #7560df;
  background: #f4f0ff;
  color: #7560df;
}
.plan-label {
  display: block;
  margin-top: 32rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: #292630;
}
.date-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 96rpx;
  margin-top: 16rpx;
  padding: 0 28rpx;
  border-radius: 20rpx;
  border: 2rpx solid #ece7f1;
  background: #fff;
  box-sizing: border-box;
}
.date-value {
  font-size: 30rpx;
  color: #292630;
}
.cal-icon {
  width: 34rpx;
  height: 34rpx;
  border: 2rpx solid #292630;
  border-radius: 6rpx;
  padding: 11rpx 7rpx 5rpx;
  box-sizing: border-box;
  display: flex;
  flex-wrap: wrap;
  align-content: space-between;
  justify-content: space-between;
}
.cal-dot {
  width: 4rpx;
  height: 4rpx;
  border-radius: 1rpx;
  background: #292630;
}
.plan-save {
  margin-top: 36rpx;
  border-radius: 24rpx;
  padding: 28rpx;
  font-size: 30rpx;
  font-weight: 700;
}
.plan-foot {
  display: block;
  margin-top: 20rpx;
  font-size: 20rpx;
  line-height: 1.7;
  color: #a398af;
}
</style>
