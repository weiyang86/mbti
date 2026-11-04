<template>
  <view class="page" v-if="result">
    <view class="card center">
      <text class="type-code">{{ result.type_code }}</text>
      <text class="muted">来源：{{ sourceLabel }}</text>
      <text class="muted small">question_bank_version: {{ result.question_bank_version }}</text>
    </view>

    <view class="card mt" v-if="result.dimension_counts">
      <text class="section">四维计数（题数）</text>
      <text>E/I {{ result.dimension_counts.E }}/{{ result.dimension_counts.I }}</text>
      <text>S/N {{ result.dimension_counts.S }}/{{ result.dimension_counts.N }}</text>
      <text>T/F {{ result.dimension_counts.T }}/{{ result.dimension_counts.F }}</text>
      <text>J/P {{ result.dimension_counts.J }}/{{ result.dimension_counts.P }}</text>
    </view>

    <view class="btn-primary mt" @click="goShare">生成晒图预览</view>
    <view class="btn-secondary mt" @click="goHistory">查看阶段记录</view>
    <view class="btn-secondary mt" @click="goHome">返回首页</view>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { ResultSnapshot } from '@/api/types'
import { getResult } from '@/api/results'

const resultId = ref('')
const result = ref<ResultSnapshot | null>(null)

onLoad((q) => {
  resultId.value = (q?.id as string) || ''
})

onMounted(async () => {
  if (!resultId.value) return
  result.value = await getResult(resultId.value)
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
