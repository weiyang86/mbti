<template>
  <view class="page">
    <view class="preview card">
      <text class="label">晒图预览（占位）</text>
      <view class="mock-canvas">
        <text class="big">{{ typeCode }}</text>
        <text class="muted">不含原始答题 · 场景 {{ scene }}</text>
      </view>
      <text class="muted" v-if="previewUrl">stub preview_url: {{ previewUrl }}</text>
    </view>
    <view class="btn-secondary mt" @click="back">返回结果</view>
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { createSharePreview } from '@/api/share'
import { getResult } from '@/api/results'

const resultId = ref('')
const typeCode = ref('----')
const previewUrl = ref('')
const scene = ref('moments')

onLoad((q) => {
  resultId.value = (q?.id as string) || ''
})

onMounted(async () => {
  if (!resultId.value) return
  const result = await getResult(resultId.value)
  typeCode.value = result.type_code
  const preview = await createSharePreview({
    result_id: resultId.value,
    scene: 'moments',
  })
  previewUrl.value = preview.preview_url || preview.job_id || ''
})

function back() {
  uni.navigateBack()
}
</script>

<style scoped lang="scss">
.mock-canvas {
  margin-top: 24rpx;
  height: 420rpx;
  border-radius: 24rpx;
  background: linear-gradient(135deg, #ede8fb, #dceee6);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.big {
  font-size: 96rpx;
  font-weight: 800;
  color: #7560df;
}
.label {
  font-weight: 600;
}
.mt {
  margin-top: 24rpx;
}
</style>
