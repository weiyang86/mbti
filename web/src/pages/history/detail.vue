<template>
  <view class="page" v-if="result">
    <view class="card">
      <text class="code">{{ result.type_code }}</text>
      <text class="muted">{{ formatSource(result.source) }}</text>
      <text class="muted block">提交于 {{ formatTime(result.submitted_at) }}</text>
      <text class="muted block">版本 {{ result.question_bank_version }}</text>
    </view>

    <view class="card mt" v-if="compare">
      <text class="section">与上一条同版本对比</text>
      <text v-if="compare.type_changed">类型变化：{{ compare.baseline_type_code }} → {{ compare.target_type_code }}</text>
      <text v-else>类型未变（{{ compare.target_type_code }}）</text>
      <text class="muted block" v-for="(n, i) in compare.stability_notes || []" :key="i">{{ n }}</text>
    </view>

    <view class="btn-primary mt" @click="share">晒图预览</view>
    <view class="btn-secondary mt danger" @click="remove">删除记录</view>
  </view>
  <view class="page" v-else>
    <text class="muted">{{ loadError || '正在读取记录…' }}</text>
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { CompareResult, ResultSnapshot } from '@/api/types'
import { compareResults, deleteResult, getResult, listResults } from '@/api/results'
import { requestErrorMessage } from '@/api/client'

const resultId = ref('')
const result = ref<ResultSnapshot | null>(null)
const compare = ref<CompareResult | null>(null)
const loadError = ref('')

onLoad((q) => {
  resultId.value = (q?.id as string) || ''
})

onMounted(async () => {
  if (!resultId.value) {
    loadError.value = '缺少记录编号，请从阶段记录打开'
    return
  }
  try {
    result.value = await getResult(resultId.value)
    const list = await listResults({ limit: 50 })
    const sameVersion = list.items.filter(
      (i) =>
        i.question_bank_version === result.value!.question_bank_version &&
        i.id !== resultId.value,
    )
    if (sameVersion.length > 0) {
      try {
        compare.value = await compareResults(sameVersion[0].id, resultId.value)
      } catch {
        compare.value = null
      }
    }
  } catch (error) {
    loadError.value = requestErrorMessage(error, '读取记录失败，请重试')
    uni.showToast({ title: loadError.value, icon: 'none' })
  }
})

function formatSource(s: string) {
  return s === 'self_select' ? '自行选择' : '趣味测试'
}

function formatTime(iso: string) {
  return iso.replace('T', ' ').slice(0, 19)
}

function share() {
  uni.navigateTo({ url: `/pages/share-preview/share-preview?id=${resultId.value}` })
}

async function remove() {
  await deleteResult(resultId.value)
  uni.showToast({ title: '已删除', icon: 'success' })
  setTimeout(() => uni.navigateBack(), 400)
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
