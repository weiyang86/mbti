<template>
  <view class="page">
    <view class="card">
      <text class="label">晒图预览</text>
      <text class="muted block" v-if="generating">正在生成分享图片…</text>
      <text class="muted block" v-else-if="loadError">{{ loadError }}</text>
      <text class="muted block" v-else>{{ imageLoaded ? '分享图片已就绪' : '正在加载分享图片…' }}</text>
      <image
        v-if="previewUrl"
        v-show="!loadError"
        class="preview-image"
        :src="previewUrl"
        mode="widthFix"
        @load="imageLoaded = true"
        @error="imageFailed"
      />
      <text class="muted block preview-url" v-if="previewUrl" selectable>分享图片链接：{{ previewUrl }}</text>
    </view>
    <view v-if="loadError" class="btn-primary mt" @click="generate">重试生成</view>
    <view class="btn-secondary mt" @click="back">返回结果</view>
  </view>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { createSharePreview } from '@/api/share'
import { requestErrorMessage } from '@/api/client'

const resultId = ref('')
const previewUrl = ref('')
const generating = ref(false)
const imageLoaded = ref(false)
const loadError = ref('')

onLoad((q) => {
  resultId.value = (q?.id as string) || ''
})

onMounted(generate)

async function generate() {
  if (generating.value) return
  if (!resultId.value) {
    loadError.value = '缺少结果编号，请从结果或阶段记录打开'
    return
  }
  generating.value = true
  loadError.value = ''
  previewUrl.value = ''
  imageLoaded.value = false
  try {
    const preview = await createSharePreview({ result_id: resultId.value, scene: 'moments' })
    previewUrl.value = preview.preview_url
  } catch (error) {
    loadError.value = requestErrorMessage(error, '生成分享图片失败，请重试')
    uni.showToast({ title: loadError.value, icon: 'none' })
  } finally {
    generating.value = false
  }
}

function imageFailed() {
  imageLoaded.value = false
  loadError.value = '分享图片加载失败，请重试生成'
  uni.showToast({ title: loadError.value, icon: 'none' })
}

function back() {
  uni.navigateBack()
}
</script>

<style scoped lang="scss">
.preview-image {
  display: block;
  width: 100%;
  margin-top: 24rpx;
  border-radius: 24rpx;
}
.label {
  font-weight: 600;
}
.block {
  display: block;
  margin-top: 16rpx;
}
.preview-url {
  word-break: break-all;
}
.mt {
  margin-top: 24rpx;
}
</style>
