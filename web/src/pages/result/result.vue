<template>
  <view class="page" v-if="result">
    <view class="card center">
      <text class="type-code">{{ result.type_code }}</text>
      <text class="muted">来源：{{ sourceLabel }}</text>
      <text class="muted small">question_bank_version: {{ result.question_bank_version }}</text>
    </view>

    <view class="card mt" v-if="result.source === 'quiz' && result.dimension_counts">
      <text class="section">四维计数（题数）</text>
      <text>E/I {{ result.dimension_counts.E }}/{{ result.dimension_counts.I }}</text>
      <text>S/N {{ result.dimension_counts.S }}/{{ result.dimension_counts.N }}</text>
      <text>T/F {{ result.dimension_counts.T }}/{{ result.dimension_counts.F }}</text>
      <text>J/P {{ result.dimension_counts.J }}/{{ result.dimension_counts.P }}</text>
    </view>
    <text v-if="result.source === 'self_select'" class="muted small">自行选择类型，无答题分布，不参与测评对比。</text>

    <view class="btn-primary mt" @click="goShare">生成晒图预览</view>
    <view class="btn-secondary mt" @click="goHistory">查看阶段记录</view>
    <view class="btn-secondary mt" @click="goCatalog">查看此结果的测试商品</view>
    <view class="btn-secondary mt" @click="goHome">再测一次</view>
    <view class="btn-secondary mt" @click="goHome">返回首页</view>
  </view>
  <view class="page" v-else>
    <text class="muted">{{ loadError || '正在读取结果…' }}</text>
    <view v-if="loadError" class="btn-secondary mt" @click="goHome">返回首页</view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { ResultSnapshot } from '@/api/types'
import { getResult, listResults } from '@/api/results'
import { requestErrorMessage } from '@/api/client'

const resultId = ref('')
const result = ref<ResultSnapshot | null>(null)
const loadError = ref('')

onLoad((q) => {
  resultId.value = (q?.id as string) || ''
})

onMounted(async () => {
  if (!resultId.value) {
    loadError.value = '缺少结果编号，请从阶段记录打开'
    return
  }
  try {
    result.value = await getResult(resultId.value)
    // A fresh guest's empty history must not block rendering their current result.
    await listResults({ limit: 1 })
  } catch (error) {
    loadError.value = requestErrorMessage(error, '读取结果失败，请稍后重试')
    uni.showToast({ title: loadError.value, icon: 'none' })
  }
})

const sourceLabel = computed(() =>
  result.value?.source === 'self_select' ? '自行选择 self_select' : '趣味测试 quiz',
)

function goShare() {
  uni.navigateTo({ url: `/pages/share-preview/share-preview?id=${resultId.value}` })
}

function goHistory() {
  uni.navigateTo({ url: '/pages/history/list' })
}

function goCatalog() {
  uni.navigateTo({ url: `/pages/pricing/pricing?result_id=${encodeURIComponent(resultId.value)}` })
}

function goHome() {
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<style scoped lang="scss">
.center {
  text-align: center;
}
.type-code {
  font-size: 80rpx;
  font-weight: 800;
  display: block;
  color: #7560df;
}
.small {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
}
.mt {
  margin-top: 24rpx;
}
.section {
  display: block;
  font-weight: 600;
  margin-bottom: 12rpx;
}
</style>
