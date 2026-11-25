<template>
  <view class="page journey-page">
    <proto-nav />
    <DemoStrip />

    <view class="page-intro">
      <view class="eyebrow">MY MBTI JOURNEY / 我的轨迹</view>
      <view class="h1">
        <text class="title-line">我还是我，</text>
        <text class="title-line">也有新的样子。</text>
      </view>
      <view class="p">留下每个阶段的答案，看看哪些在变化、哪些一直没变。</view>
    </view>

    <view class="private-badge">
      <AppIcon name="lock" :size="13" color="#6e8064" />
      <text>默认仅自己可见 · 本机保存</text>
    </view>

    <StateView v-if="loading" state="loading" title="正在读取记录…" />

    <StateView v-else-if="loadError" state="error" title="轨迹读取失败" description="请检查网络后重试，已有记录不会被删除。">
      <button class="btn secondary small" @click="load">重试</button>
    </StateView>

    <template v-else>
      <template v-if="rows.length">
        <view class="journey-summary">
          <text class="span">属于自己的阶段档案</text>
          <view class="summary-main">
            <text class="strong">{{ rows.length }}</text>
            <text class="small">次记录</text>
            <text class="b">{{ lastValid?.type_code || rows[0].type_code }}</text>
          </view>
          <view class="p">{{ summary }}</view>
          <text v-if="prevValid && lastValid" class="textbtn" @click="goCompare">
            看看这两次哪里不同 →
          </text>
        </view>

        <view v-if="chartRows.length >= 2" class="journey-chart">
          <view class="chart-dims">
            <button
              v-for="d in DIM_LIST"
              :key="d.key"
              :class="{ active: chartDim === d.key }"
              @click="chartDim = d.key"
            >
              {{ d.left }} / {{ d.right }}
            </button>
          </view>
          <view class="chart-label">
            <text class="b">{{ chartMeta.name }}</text>
            <text class="span">{{ chartMeta.rightLabel }}选项题数 / 3</text>
          </view>

          <view class="plot">
            <view v-for="g in gridLines" :key="g.n" class="grid-line" :style="{ top: g.top }">
              <text class="grid-label">{{ g.n }}</text>
            </view>
            <view
              v-for="(s, i) in chartSegments"
              :key="'seg' + i"
              class="chart-seg"
              :style="{
                left: s.left,
                top: s.top,
                width: s.width,
                transform: `translate(-50%, -50%) rotate(${s.rotate})`,
              }"
            />
            <view
              v-for="(p, i) in chartPoints"
              :key="'dot' + i"
              class="chart-point"
              :style="{ left: p.left, top: p.top }"
            >
              <text class="point-val">{{ p.count }}</text>
            </view>
            <text class="axis-label first">{{ dateLabel(chartRows[0].submitted_at, true) }}</text>
            <text class="axis-label last">
              {{ dateLabel(chartRows[chartRows.length - 1].submitted_at, true) }}
            </text>
          </view>

          <view class="chart-data">
            <view class="chart-summary" @click="showChartTable = !showChartTable">
              查看具体题数（{{ chartRows.length }} 次）
            </view>
            <view v-if="showChartTable" class="chart-table">
              <view class="chart-row chart-head">
                <text>日期</text>
                <text>类型</text>
                <text>{{ chartMeta.left }}</text>
                <text>{{ chartMeta.right }}</text>
              </view>
              <view v-for="r in chartRows" :key="r.id" class="chart-row">
                <text>{{ dateLabel(r.submitted_at) }}</text>
                <text>{{ r.type_code }}</text>
                <text>{{ r.dimension_counts?.[chartMeta.left] ?? 0 }}/3</text>
                <text>{{ r.dimension_counts?.[chartMeta.right] ?? 0 }}/3</text>
              </view>
            </view>
          </view>

          <text class="fine">
            最近 {{ chartRows.length }} 次同版本记录；横轴为时间，连线仅用于阅读。结果可能受作答状态和测量误差影响。
          </text>
        </view>

        <view v-else class="chart-empty">
          <text class="span">01 → 02</text>
          <view class="h3">下一次回来，就有了对照。</view>
          <view class="p">同版本完成两次后显示趋势；旧版无日期记录不接入折线。</view>
        </view>

        <view class="timeline-heading">
          <view class="h2">我的阶段记录</view>
          <text class="span">最新在前</text>
        </view>

        <view class="record-timeline">
          <view
            v-for="(item, i) in rows"
            :key="item.id"
            class="record-tile"
            @click="openRecord(item)"
          >
            <text class="record-node">{{ pad(rows.length - i) }}</text>
            <view class="record-body">
              <text class="small">{{ recordDate(item) }}</text>
              <view class="h3">
                <text>{{ item.type_code }}</text>
                <text class="span">{{ recordTitle(item) }}</text>
              </view>
              <view class="p">{{ recordNote(item) }}</view>
            </view>
            <text class="em">↗</text>
          </view>
        </view>
      </template>

      <view v-else class="history-empty">
        <view class="empty-orbits">
          <text class="span">NOW</text>
          <text class="i">✦</text>
          <text class="b">NEXT</text>
        </view>
        <view class="h2">今天的你，就是第一个起点。</view>
        <view class="p">
          <text class="title-line">每次完成测试都会新增一份记录。</text>
          <text class="title-line">重测不覆盖过去，也不扣费。</text>
        </view>
        <view class="btn full" @click="goQuiz">建立我的第一份记录</view>
      </view>

      <view v-if="rows.length" class="btn full mt" @click="goQuiz">
        记录现在的我 · 免费复测
      </view>

      <view class="review-plan">
        <view>
          <text class="span">下次再认识一下自己</text>
          <view class="h3">
            {{ reviewDate ? dateLabel(reviewDate + 'T12:00:00') : '给下一次回访，留个约定。' }}
          </view>
          <view class="p">
            {{ reviewDate ? '本机计划已保存，不会自动发送提醒。' : '可以隔一段时间或生活阶段变化后再来。' }}
          </view>
        </view>
        <view class="btn secondary small" @click="openReviewPlan">
          {{ reviewDate ? '修改计划' : '设定复测计划' }}
        </view>
        <text v-if="reviewDate" class="textbtn" @click="exportCalendar">导出日历事项</text>
      </view>

      <view class="notice mt">
        这是原创 12 题趣味记录。类型变化不等于人格已经改变；同样的四个字母，也可能有不同的具体回答。
      </view>

      <view v-if="rows.length" class="journey-footer-actions">
        <text class="textbtn" @click="exportHistory">导出我的记录 JSON</text>
      </view>
    </template>

    <view v-if="planOpen" class="modal-backdrop" @click="planOpen = false">
      <view class="modal" @click.stop>
        <view class="close" @click="planOpen = false">×</view>
        <view class="eyebrow">MBTI搭子 / V0.4</view>
        <view class="h2">下一次，什么时候回来？</view>
        <view class="p">可以按阶段回访。时间间隔只是个人安排，不是判断人格变化的科学阈值。</view>

        <view class="btnrow mt">
          <view class="btn secondary" @click="choosePreset(30)">30 天后</view>
          <view class="btn secondary" @click="choosePreset(90)">90 天后</view>
        </view>

        <view class="field mt">
          <text class="label">自己选一天</text>
          <!-- #ifndef H5 -->
          <picker mode="date" :value="planDate" :start="planMinDate" @change="onPickDate">
            <view class="input date-row">{{ planDateText }}</view>
          </picker>
          <!-- #endif -->
          <!-- #ifdef H5 -->
          <view class="input date-row" @click="openNativeDate">{{ planDateText }}</view>
          <!-- #endif -->
        </view>

        <view class="btn full" @click="saveReviewPlan">保存本机计划</view>
        <view class="fine mt">不会发送短信、微信或系统通知；保存后可导出日历事项。</view>
        <text v-if="reviewDate" class="textbtn full" @click="clearReviewPlan">取消本机计划</text>
      </view>
    </view>
  <proto-tabbar />
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import StateView from '@/components/state-view.vue'
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type {
  DimensionCounts,
  ResultSnapshot,
  ResultSnapshotSummary,
} from '@/api/types'
import { getResult, listResults } from '@/api/results'
import AppIcon from '@/components/AppIcon.vue'
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
  left: string
  top: string
  count: number
}

interface ChartSegment {
  left: string
  top: string
  width: string
  rotate: string
}

const REVIEW_KEY = 'mbti_journey_review_v1'
const CHART_W = 320
const CHART_H = 195

const summaries = ref<ResultSnapshotSummary[]>([])
const details = ref<JourneyRecord[]>([])
const loading = ref(true)
const loadError = ref(false)
const chartDim = ref<DimKey>('EI')
const showChartTable = ref(false)
const reviewDate = ref('')
const planOpen = ref(false)
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
  [3, 2, 1, 0].map((n) => ({ n, top: `${((155 - n * 40) / CHART_H) * 100}%` })),
)

function rightCount(record: ResultSnapshot, dim: DimKey): number {
  const meta = DIM_MAP[dim]
  return record.dimension_counts?.[meta.right as keyof DimensionCounts] ?? 0
}

function chartX(list: JourneyRecord[], index: number): number {
  const first = new Date(list[0].submitted_at).getTime()
  const last = new Date(list[list.length - 1].submitted_at).getTime()
  const span = last - first || 1
  const offset = new Date(list[index].submitted_at).getTime() - first
  return 35 + (offset / span) * 250
}

const chartPoints = computed<ChartPoint[]>(() => {
  const list = chartRows.value
  if (list.length < 2) return []
  return list.map((r, i) => {
    const x = chartX(list, i)
    const y = 155 - rightCount(r, chartDim.value) * 40
    return {
      left: `${(x / CHART_W) * 100}%`,
      top: `${(y / CHART_H) * 100}%`,
      count: rightCount(r, chartDim.value),
    }
  })
})

const chartSegments = computed<ChartSegment[]>(() =>
  chartPoints.value.slice(1).map((p, i) => {
    const prev = chartPoints.value[i]
    const dx = ((parseFloat(p.left) - parseFloat(prev.left)) / 100) * CHART_W
    const dy = ((parseFloat(p.top) - parseFloat(prev.top)) / 100) * CHART_H
    return {
      left: `${(parseFloat(p.left) + parseFloat(prev.left)) / 2}%`,
      top: `${(parseFloat(p.top) + parseFloat(prev.top)) / 2}%`,
      width: `${(Math.sqrt(dx * dx + dy * dy) / CHART_W) * 100}%`,
      rotate: `${(Math.atan2(dy, dx) * 180) / Math.PI}deg`,
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

function openReviewPlan() {
  planMinDate.value = dateToStr(new Date())
  planDate.value = reviewDate.value || planMinDate.value
  planOpen.value = true
}

function choosePreset(days: 30 | 90) {
  planDate.value = dateToStr(new Date(Date.now() + days * 86400000))
}

function onPickDate(e: { detail: { value: number | string } }) {
  const value = String(e.detail.value || '')
  if (!value) return
  planDate.value = value
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
      planOpen.value = false
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
.title-line {
  display: block;
}

.demo-strip .textbtn {
  font-size: 9px;
  color: #a197ad;
}
.record-body .h3 .span {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0;
  color: #766882;
}
.journey-footer-actions .textbtn {
  font-size: 11px;
}

.history-empty .h2 {
  font-weight: 700;
  margin-bottom: 17.4px;
}
.review-plan .h3 {
  font-weight: 700;
}
.review-plan .btn {
  border-radius: 15px;
}

.summary-main {
  display: flex;
  align-items: baseline;
  gap: 9px;
  margin: 12px 0;
}
.record-body {
  flex: 1;
  min-width: 0;
  padding-bottom: 13px;
  border-bottom: 1px solid #eee7f3;
}

.plot {
  position: relative;
  width: 100%;
  aspect-ratio: 320 / 195;
  margin: 8px 0 0;
}
.grid-line {
  position: absolute;
  left: 9.375%;
  right: 8.125%;
  height: 1px;
  background: #e9e4f0;
}
.grid-label {
  position: absolute;
  left: -24px;
  top: -7px;
  font-size: 10px;
  color: #8d8399;
}
.chart-seg {
  position: absolute;
  height: 2.5px;
  border-radius: 2px;
  background: #7151e8;
  transform-origin: center;
}
.chart-point {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #7151e8;
  border: 2px solid #fff;
  box-sizing: border-box;
  transform: translate(-50%, -50%);
}
.point-val {
  position: absolute;
  left: 50%;
  top: -17px;
  width: 30px;
  transform: translateX(-50%);
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  color: #5841ac;
}
.axis-label {
  position: absolute;
  bottom: 0;
  font-size: 10px;
  color: #8d8399;
}
.axis-label.first {
  left: 0;
}
.axis-label.last {
  right: 0;
}

.chart-summary {
  font-size: 11px;
  color: #8b789d;
  padding: 10px 0;
}
.chart-row {
  display: flex;
  padding: 9px 0;
  border-bottom: 1px solid #eee9f3;
  font-size: 11px;
}
.chart-row > text {
  flex: 1;
}
.chart-head {
  color: #8d7c9c;
}

.review-plan .btn {
  margin-top: 10px;
}

.modal-backdrop {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1000;
  align-items: flex-end;
  padding: 0;
}
.modal .close {
  display: flex;
  align-items: center;
  justify-content: center;
}
.date-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>

