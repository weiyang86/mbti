<template>
  <view class="page detail-page">
    <view v-if="loading" class="state"><text class="state-text">正在读取这份记录…</text></view>

    <view v-else-if="!result" class="state">
      <text class="state-text">这份记录已不可用</text>
      <view class="btn-secondary mt" @click="backList">回到我的轨迹</view>
    </view>

    <view v-else>
      <text class="kicker">A MOMENT OF ME / 阶段记录</text>
      <text class="title">{{ result.type_code }} · {{ meta?.name_zh || 'MBTI' }}</text>
      <text class="sub">{{ dateText }} · {{ sourceLabel }}</text>

      <view class="private-card">
        <text class="private-badge">🔒 阶段信息仅自己可见</text>
        <text class="private-title">{{ result.type_code }} 这一章</text>
        <text class="private-line" v-if="result.life_stage">阶段：{{ result.life_stage }}</text>
        <text class="private-line" v-if="result.recent_status">最近状态：{{ result.recent_status }}</text>
        <text class="private-fine">回顾最近四周 · 固定 12 题 · {{ result.question_bank_version }}</text>
      </view>

      <view class="dims" v-if="result.dimension_counts">
        <text class="section">当时的四维分布</text>
        <view class="dim-row" v-for="d in dimRows" :key="d.key">
          <view class="dim-head">
            <text class="dim-label">{{ d.left }}</text>
            <text class="dim-count">{{ d.l }} : {{ d.r }}</text>
            <text class="dim-label right">{{ d.right }}</text>
          </view>
          <view class="track"><view class="fill" :style="{ width: d.pct }" /></view>
        </view>
        <text class="fine">只展示计数分布，不展示原始答题选项。</text>
      </view>

      <view class="compare">
        <text class="section">与上一次同版本记录比较</text>

        <view v-if="compare" class="compare-result">
          <text class="compare-type">
            {{ compare.type_changed ? compare.baseline_type_code + ' → ' + compare.target_type_code : '类型未变（' + compare.target_type_code + '）' }}
          </text>
          <text class="compare-note" v-for="(n, i) in compare.stability_notes || []" :key="i">{{ n }}</text>
          <view class="delta-row" v-for="d in deltas" :key="d.key">
            <text class="delta-key">{{ d.key }}</text>
            <text class="delta-val">{{ d.val > 0 ? '+' + d.val : d.val }}</text>
          </view>
          <text class="fine">仅比较题库版本相同的两份快照。</text>
        </view>

        <view v-else-if="older" class="btn-secondary" @click="runCompare">与上一次同版本记录比较</view>
        <text v-else class="notice">这份记录之前还没有可比较的同版本结果。</text>
      </view>

      <view class="actions">
        <view class="btn-primary" @click="goShare">去晒成一张图</view>
        <view class="btn-secondary mt danger" @click="confirmDelete">删除这份记录</view>
      </view>

      <text class="foot">删除后不影响其他记录；已下载的图片无法一并删除。</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { CompareResult, ResultSnapshot, ResultSnapshotSummary, TypeMeta } from '@/api/types'
import {
  compareResults,
  deleteResult,
  getResult,
  listResults,
} from '@/api/results'
import { listTypes } from '@/api/types-api'

const resultId = ref('')
const result = ref<ResultSnapshot | null>(null)
const meta = ref<TypeMeta | null>(null)
const older = ref<ResultSnapshotSummary | null>(null)
const compare = ref<CompareResult | null>(null)
const loading = ref(true)

onLoad((q) => {
  resultId.value = (q?.id as string) || ''
})

onMounted(async () => {
  if (!resultId.value) {
    loading.value = false
    return
  }
  try {
    const [snapshot, types, list] = await Promise.all([
      getResult(resultId.value),
      listTypes(),
      listResults({ limit: 50 }),
    ])
    result.value = snapshot
    meta.value = types.items.find((t) => t.type_code === snapshot.type_code) || null
    older.value =
      list.items
        .filter(
          (i) =>
            i.id !== resultId.value &&
            i.question_bank_version === snapshot.question_bank_version &&
            i.submitted_at < snapshot.submitted_at,
        )
        .sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1))[0] || null
  } catch {
    result.value = null
  } finally {
    loading.value = false
  }
})

const sourceLabel = computed(() =>
  result.value?.source === 'self_select' ? '自行选择' : '趣味测试',
)

const dateText = computed(() =>
  result.value ? result.value.submitted_at.replace('T', ' ').slice(0, 16) : '',
)

const DIM_LABELS: [string, string, string][] = [
  ['EI', '外向 E', '内向 I'],
  ['SN', '实感 S', '直觉 N'],
  ['TF', '思考 T', '情感 F'],
  ['JP', '判断 J', '知觉 P'],
]

const dimRows = computed(() => {
  const counts = result.value?.dimension_counts
  if (!counts) return []
  return DIM_LABELS.map(([key, left, right]) => {
    const l = counts[key[0] as keyof typeof counts] ?? 0
    const r = counts[key[1] as keyof typeof counts] ?? 0
    const total = l + r || 1
    return { key, left, right, l, r, pct: `${Math.round((l / total) * 100)}%` }
  })
})

const deltas = computed(() =>
  Object.entries(compare.value?.dimension_deltas || {})
    .filter(([, val]) => val !== 0)
    .map(([key, val]) => ({ key, val })),
)

async function runCompare() {
  if (!older.value) return
  try {
    compare.value = await compareResults(older.value.id, resultId.value)
  } catch {
    uni.showToast({ title: '对比失败，请稍后再试', icon: 'none' })
  }
}

function confirmDelete() {
  uni.showModal({
    title: '删除这份阶段记录？',
    content: '删除后无法恢复，其他记录与已下载的图片不受影响。',
    confirmText: '删除',
    confirmColor: '#b42318',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await deleteResult(resultId.value)
        uni.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => uni.reLaunch({ url: '/pages/history/list' }), 600)
      } catch {
        uni.showToast({ title: '删除失败，请稍后再试', icon: 'none' })
      }
    },
  })
}

function goShare() {
  if (!resultId.value) return
  uni.navigateTo({ url: `/pages/share-preview/share-preview?id=${resultId.value}` })
}

function backList() {
  uni.reLaunch({ url: '/pages/history/list' })
}
</script>

<style scoped lang="scss">
.detail-page {
  padding-top: 40rpx;
  padding-bottom: 56rpx;
}

.state {
  padding-top: 220rpx;
  text-align: center;
}
.state-text {
  display: block;
  font-size: 26rpx;
  color: #77727e;
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
  margin-top: 16rpx;
  font-size: 48rpx;
  font-weight: 800;
  letter-spacing: 1rpx;
}
.sub {
  display: block;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #77727e;
}

.private-card {
  margin-top: 32rpx;
  padding: 32rpx 28rpx;
  border-radius: 24rpx;
  background: linear-gradient(160deg, #f6f2ff, #eef7f1);
  border: 2rpx solid #e6dffa;
}
.private-badge {
  display: block;
  font-size: 20rpx;
  color: #7560df;
}
.private-title {
  display: block;
  margin-top: 14rpx;
  font-size: 30rpx;
  font-weight: 700;
}
.private-line {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  color: #292630;
}
.private-fine {
  display: block;
  margin-top: 14rpx;
  font-size: 20rpx;
  color: #a398af;
}

.section {
  display: block;
  margin-top: 44rpx;
  font-size: 28rpx;
  font-weight: 700;
}

.dim-row {
  margin-top: 20rpx;
}
.dim-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dim-label {
  font-size: 24rpx;
}
.dim-label.right {
  text-align: right;
}
.dim-count {
  font-size: 22rpx;
  color: #7560df;
}
.track {
  margin-top: 10rpx;
  height: 12rpx;
  border-radius: 999rpx;
  background: #ece8f3;
  overflow: hidden;
}
.fill {
  height: 100%;
  border-radius: 999rpx;
  background: linear-gradient(90deg, #8b6cf6, #dfff8b);
}
.fine {
  display: block;
  margin-top: 14rpx;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.6;
}

.compare-result {
  margin-top: 20rpx;
  padding: 28rpx 24rpx;
  border-radius: 24rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
}
.compare-type {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  color: #7560df;
}
.compare-note {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  color: #77727e;
}
.delta-row {
  display: flex;
  justify-content: space-between;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #77727e;
}
.delta-val {
  color: #292630;
}

.notice {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #77727e;
}

.actions {
  margin-top: 52rpx;
}
.mt {
  margin-top: 20rpx;
}
.danger {
  color: #b42318;
  border-color: #f2d3cf;
}

.foot {
  display: block;
  margin-top: 36rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.6;
}
</style>
