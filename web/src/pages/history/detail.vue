<template>
  <view class="page" v-if="result">
    <view class="card">
      <text class="code">{{ result.type_code }}</text>
      <text class="block" v-if="meta">{{ meta.name_zh }} · {{ meta.tagline }}</text>
      <text class="muted">{{ formatSource(result.source) }}</text>
      <text class="muted block">提交于 {{ formatTime(result.submitted_at) }}</text>
      <text class="muted block">版本 {{ result.question_bank_version }}</text>
    </view>

    <view class="card mt" v-if="result.source === 'quiz' && result.dimension_counts">
      <text class="section">当时的四维计数（题数）</text>
      <text class="block">E/I {{ result.dimension_counts.E }}/{{ result.dimension_counts.I }}</text>
      <text class="block">S/N {{ result.dimension_counts.S }}/{{ result.dimension_counts.N }}</text>
      <text class="block">T/F {{ result.dimension_counts.T }}/{{ result.dimension_counts.F }}</text>
      <text class="block">J/P {{ result.dimension_counts.J }}/{{ result.dimension_counts.P }}</text>
    </view>
    <view class="card mt" v-if="result.source === 'quiz'">
      <text class="section">与上一条同版本对比</text>
      <template v-if="compare">
        <text v-if="compare.type_changed">类型变化：{{ compare.baseline_type_code }} → {{ compare.target_type_code }}</text>
        <text v-else>类型未变（{{ compare.target_type_code }}）</text>
        <text class="muted block" v-for="(n, i) in compare.stability_notes || []" :key="i">{{ n }}</text>
      </template>
      <text v-else class="muted block">{{ compareError || (comparing ? '正在对比…' : '此前还没有同版本测评记录可供对比。') }}</text>
      <view v-if="compareError" class="btn-secondary mt" @click="runCompare">重试对比</view>
    </view>
    <text class="muted block mt" v-else>自行选择类型，无答题分布，不参与测评对比。</text>

    <view class="btn-primary mt" @click="share">晒图预览</view>
    <text class="danger block" v-if="deleteError">{{ deleteError }}</text>
    <view class="btn-secondary mt danger" @click="remove">{{ deleting ? '正在删除…' : '删除记录' }}</view>
  </view>
  <view class="page" v-else>
    <text class="muted">{{ loadError || '正在读取记录…' }}</text>
    <view v-if="loadError" class="btn-secondary mt" @click="load">重试</view>
    <view v-if="loadError" class="btn-secondary mt" @click="backList">返回阶段记录</view>
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { CompareResult, ResultSnapshot, ResultSnapshotSummary, TypeMeta } from '@/api/types'
import { compareResults, deleteResult, getResult, listResults } from '@/api/results'
import { listTypes } from '@/api/types-api'
import { HttpError, requestErrorMessage } from '@/api/client'

const resultId = ref('')
const result = ref<ResultSnapshot | null>(null)
const meta = ref<TypeMeta | null>(null)
const older = ref<ResultSnapshotSummary | null>(null)
const compare = ref<CompareResult | null>(null)
const loadError = ref('')
const loading = ref(false)
const comparing = ref(false)
const compareError = ref('')
const deleting = ref(false)
const deleteError = ref('')

onLoad((q) => {
  resultId.value = (q?.id as string) || ''
})

onMounted(load)

async function load() {
  if (loading.value) return
  if (!resultId.value) {
    loadError.value = '缺少记录编号，请从阶段记录打开'
    return
  }
  loading.value = true
  loadError.value = ''
  result.value = null
  meta.value = null
  older.value = null
  compare.value = null
  compareError.value = ''
  try {
    const [snapshot, types, list] = await Promise.all([
      getResult(resultId.value), listTypes(), listResults({ limit: 50 }),
    ])
    result.value = snapshot
    meta.value = types.items.find((t) => t.type_code === snapshot.type_code) || null
    older.value = snapshot.source === 'quiz'
      ? list.items.filter((i) => i.id !== snapshot.id && i.source === 'quiz' &&
          i.question_bank_version === snapshot.question_bank_version &&
          i.submitted_at < snapshot.submitted_at)
          .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0] || null
      : null
    if (older.value) await runCompare()
  } catch (error) {
    loadError.value = requestErrorMessage(error, '读取记录失败，请重试')
    uni.showToast({ title: loadError.value, icon: 'none' })
  } finally {
    loading.value = false
  }
}

async function runCompare() {
  if (!older.value || comparing.value || deleting.value) return
  comparing.value = true
  compare.value = null
  compareError.value = ''
  try {
    compare.value = await compareResults(older.value.id, resultId.value)
  } catch (error) {
    compareError.value = error instanceof HttpError && error.status === 422
      ? '这两条记录无法对比：仅支持同题库版本的测评记录，自选类型不参与对比。'
      : requestErrorMessage(error, '对比失败，请重试')
    uni.showToast({ title: compareError.value, icon: 'none' })
  } finally {
    comparing.value = false
  }
}

function formatSource(s: string) {
  return s === 'self_select' ? '自行选择' : '趣味测试'
}

function formatTime(iso: string) {
  return iso.replace('T', ' ').slice(0, 19)
}

function share() {
  if (deleting.value) return
  uni.navigateTo({ url: `/pages/share-preview/share-preview?id=${encodeURIComponent(resultId.value)}` })
}

async function remove() {
  if (deleting.value || comparing.value) return
  deleting.value = true
  deleteError.value = ''
  try {
    await deleteResult(resultId.value)
    uni.showToast({ title: '已删除', icon: 'success' })
    backList()
  } catch (error) {
    deleteError.value = requestErrorMessage(error, '删除失败，请重试')
    uni.showToast({ title: deleteError.value, icon: 'none' })
    deleting.value = false
  }
}

function backList() {
  uni.redirectTo({ url: '/pages/history/list' })
}
</script>

<style scoped lang="scss">
.code {
  font-size: 56rpx;
  font-weight: 800;
  display: block;
}
.block {
  display: block;
  margin-top: 8rpx;
}
.mt {
  margin-top: 24rpx;
}
.section {
  font-weight: 600;
  display: block;
  margin-bottom: 12rpx;
}
.danger {
  color: #b42318;
}
</style>
