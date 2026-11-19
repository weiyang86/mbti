<template>
  <view class="page">
    <proto-nav />
    <view v-if="loading" class="notice mt">正在读取这份记录…</view>

    <template v-else-if="loadError">
      <view class="page-intro">
        <view class="eyebrow">A MOMENT OF ME / 阶段记录</view>
        <view class="h1">读取这份记录失败</view>
        <view class="p">请检查网络后再试一次。</view>
      </view>
      <view class="btn secondary full" @click="load">重试</view>
      <view class="btn ghost full mt" @click="backList">回到我的轨迹</view>
    </template>

    <template v-else-if="!result">
      <view class="page-intro">
        <view class="eyebrow">MBTI BUDDY</view>
        <view class="h1">这份记录已不可用</view>
        <view class="p">请返回轨迹查看仍然保留的记录。</view>
      </view>
      <view class="btn full" @click="backList">回到我的轨迹</view>
    </template>

    <template v-else>
      <view class="demo-strip">
        <text>V0.4 · Mock 演示 · 不产生费用</text>
        <text class="textbtn" @click="toastDemo">演示状态 ↗</text>
      </view>

      <view class="page-intro">
        <view class="eyebrow">A MOMENT OF ME / 阶段记录</view>
        <view class="h1">{{ result.type_code }} · {{ meta?.name_zh || 'MBTI' }}</view>
        <view class="p">{{ subtitle }}</view>
      </view>

      <view class="stage-private-card">
        <view class="private-badge">
          <AppIcon name="lock" :size="13" color="#6e8064" />
          <text>阶段信息仅自己可见</text>
        </view>
        <view class="h3">{{ stageTitle }}</view>
        <view class="p">
          最近状态：{{ result.recent_status || '未记录' }}。这些信息不用于自动判断变化原因。
        </view>
        <view class="fine">{{ privateFine }}</view>
      </view>

      <view v-if="older" class="btn full mt" @click="openCompare">与上一次同版本记录比较</view>
      <view v-else class="notice mt">这份记录之前还没有可比较的同版本结果。</view>

      <view v-if="result.dimension_counts" class="record-dimensions">
        <view v-for="d in dimRows" :key="d.key" class="dim-row">
          <text class="span">{{ d.name }}</text>
          <text class="b">{{ d.key[0] }} {{ d.l }} : {{ d.r }} {{ d.key[1] }}</text>
        </view>
      </view>

      <!-- TODO: 待 Remy 确认「历史作答回放」服务端接口；当前仅回放本机保存的作答 -->
      <view v-if="result.source === 'quiz'" class="record-answers">
        <view class="answers-summary" @click="showAnswers = !showAnswers">
          <text class="answers-caret" :class="{ open: showAnswers }">▶</text>
          <text>回看当时的 12 个选择</text>
        </view>
        <template v-if="showAnswers">
          <view v-for="(item, i) in answerRecord?.items || []" :key="i" class="answer-item">
            <text class="small">{{ pad(i + 1) }} / {{ item.question }}</text>
            <view class="p">{{ item.answer }}</view>
          </view>
          <view v-if="!answerRecord" class="p answers-empty">
            本机没有保留这次作答，仍可查看上面的四维计数。
          </view>
        </template>
      </view>

      <view class="btnrow mt">
        <view class="btn secondary" @click="confirmUseRecord">用这次类型更新名片</view>
        <text class="textbtn" @click="confirmDelete">删除这一份记录</text>
      </view>

      <view class="btn ghost full mt" @click="backList">回到我的轨迹</view>
    </template>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { ResultSnapshot, ResultSnapshotSummary, TypeMeta } from '@/api/types'
import { deleteResult, getResult, listResults } from '@/api/results'
import { updateMyCard } from '@/api/cards'
import { DECLARATIONS } from '@/constants/types'
import { listTypes } from '@/api/types-api'
import { DIM_LIST, dateLabel } from '@/constants/journey'
import { getLocalAnswers, type LocalAnswerRecord } from '@/store/local-answers'
import AppIcon from '@/components/AppIcon.vue'

const resultId = ref('')
const result = ref<ResultSnapshot | null>(null)
const meta = ref<TypeMeta | null>(null)
const older = ref<ResultSnapshotSummary | null>(null)
const loading = ref(true)
const loadError = ref(false)
const answerRecord = ref<LocalAnswerRecord | null>(null)
const showAnswers = ref(false)

onLoad((q) => {
  resultId.value = (q?.id as string) || ''
})

onMounted(load)

async function load() {
  if (!resultId.value) {
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = false
  try {
    const [snapshot, types, list] = await Promise.all([
      getResult(resultId.value),
      listTypes(),
      listResults({ limit: 50 }),
    ])
    result.value = snapshot
    answerRecord.value = getLocalAnswers(resultId.value)
    meta.value = types.items.find((t) => t.type_code === snapshot.type_code) || null
    older.value =
      snapshot.source === 'quiz'
        ? list.items
            .filter(
              (i) =>
                i.id !== resultId.value &&
                i.source === 'quiz' &&
                i.question_bank_version === snapshot.question_bank_version &&
                i.submitted_at < snapshot.submitted_at,
            )
            .sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1))[0] || null
        : null
  } catch {
    result.value = null
    loadError.value = true
  } finally {
    loading.value = false
  }
}

const stageTitle = computed(() => {
  if (!result.value) return ''
  return (
    result.value.life_stage ||
    (result.value.source === 'self_select' ? '自行选择' : '日常生活')
  )
})

const subtitle = computed(() => {
  if (!result.value) return ''
  if (!result.value.submitted_at) return '旧版导入 · 测试日期未知'
  return `${dateLabel(result.value.submitted_at)} · ${stageTitle.value}`
})

const privateFine = computed(() => {
  if (!result.value) return ''
  if (!result.value.submitted_at) {
    return '旧版未固定回顾时间窗，不与新版直接比较。'
  }
  if (result.value.source === 'self_select') {
    return '自行选择类型 · 无答题分布，不参与同版本对比'
  }
  return `回顾最近四周 · 固定 12 题 · ${result.value.question_bank_version}`
})

const dimRows = computed(() => {
  const counts = result.value?.dimension_counts
  if (!counts) return []
  return DIM_LIST.map((dim) => ({
    key: dim.key,
    name: dim.name,
    l: counts[dim.left] ?? 0,
    r: counts[dim.right] ?? 0,
  }))
})

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function toastDemo() {
  uni.showToast({ title: '当前为 Mock 演示状态', icon: 'none' })
}

function openCompare() {
  if (!older.value) return
  uni.navigateTo({
    url: `/pages/compare/compare?baseline=${older.value.id}&target=${resultId.value}`,
  })
}

function confirmUseRecord() {
  if (!result.value) return
  uni.showModal({
    title: '把这次类型用于名片？',
    content: `名片类型将更新为 ${result.value.type_code}。不会公开你的历史、阶段标签、近期状态或具体回答。`,
    confirmText: '确认更新类型',
    success: async (res) => {
      if (!res.confirm || !result.value) return
      try {
        await updateMyCard({
          type_code: result.value.type_code,
          declaration: DECLARATIONS[result.value.type_code],
        })
        uni.showToast({ title: '已更新名片类型', icon: 'none' })
        setTimeout(() => uni.switchTab({ url: '/pages/card/card' }), 600)
      } catch {
        uni.showToast({ title: '更新失败，请稍后再试', icon: 'none' })
      }
    },
  })
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

function backList() {
  uni.reLaunch({ url: '/pages/history/list' })
}
</script>

<style scoped lang="scss">
.h3 {
  font-weight: 700;
}
.stage-private-card .fine {
  margin: 0 0 10px;
}
.answers-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #6f5b82;
  padding: 17px 0;
  min-height: 48px;
  border-top: 0;
  box-sizing: border-box;
}
.answers-caret {
  display: inline-block;
  font-size: 7px;
  line-height: 1;
  color: #6f5b82;
  transition: transform 0.18s;
}
.answers-caret.open {
  transform: rotate(90deg);
}
.answer-item {
  padding: 15px 0;
  border-top: 1px solid #efe8f5;
}
.answers-empty {
  padding: 15px 0;
  border-top: 1px solid #efe8f5;
  margin: 0;
}
.demo-strip .textbtn {
  font-size: 9px;
  color: #a197ad;
}
.btnrow .textbtn {
  text-align: center;
}
.dim-row {
  display: flex;
  justify-content: space-between;
  padding: 15px 0;
  border-bottom: 1px solid #f0eaf5;
  font-size: 12px;
}
.dim-row:last-child {
  border: 0;
}
</style>
