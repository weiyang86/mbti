<template>
  <view class="page" v-if="question">
    <view class="progress muted">第 {{ currentIndex + 1 }} / {{ questions.length }} 题</view>
    <view class="card">
      <text class="prompt">{{ question.prompt }}</text>
      <view
        v-for="opt in question.options"
        :key="opt.id"
        class="option"
        :class="{ active: selectedOption === opt.id }"
        @click="selectOption(opt.id)"
      >
        {{ opt.label }}
      </view>
    </view>
    <view class="nav">
      <view class="btn-secondary half" @click="prev" v-if="currentIndex > 0">上一题</view>
      <view class="btn-primary half" @click="next">{{ isLast ? '提交' : '下一题' }}</view>
    </view>
  </view>
  <view class="page" v-else>
    <text class="muted">加载题目…</text>
  </view>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { Question } from '@/api/types'
import {
  getCurrentQuizVersion,
  submitQuizSession,
  updateQuizSessionAnswers,
} from '@/api/quiz'

const sessionId = ref('')
const questions = ref<Question[]>([])
const currentIndex = ref(0)
const answers = ref<Record<string, string>>({})

onLoad((query) => {
  sessionId.value = (query?.sessionId as string) || ''
})

onMounted(async () => {
  const payload = await getCurrentQuizVersion()
  questions.value = payload.questions
})

const question = computed(() => questions.value[currentIndex.value])
const isLast = computed(() => currentIndex.value === questions.value.length - 1)
const selectedOption = computed(() =>
  question.value ? answers.value[question.value.id] : undefined,
)

function selectOption(optionId: string) {
  if (!question.value) return
  answers.value[question.value.id] = optionId
}

async function persistCurrent() {
  if (!sessionId.value || !question.value || !selectedOption.value) return
  await updateQuizSessionAnswers(sessionId.value, [
    { question_id: question.value.id, option_id: selectedOption.value },
  ])
}

async function next() {
  if (!selectedOption.value) {
    uni.showToast({ title: '请选择一个选项', icon: 'none' })
    return
  }
  await persistCurrent()
  if (isLast.value) {
    try {
      const result = await submitQuizSession(sessionId.value)
      uni.redirectTo({ url: `/pages/result/result?id=${result.id}` })
    } catch {
      uni.showToast({ title: '提交失败', icon: 'none' })
    }
    return
  }
  currentIndex.value += 1
}

function prev() {
  if (currentIndex.value > 0) currentIndex.value -= 1
}
</script>

<style scoped lang="scss">
.progress {
  margin-bottom: 16rpx;
}
.prompt {
  font-size: 34rpx;
  line-height: 1.6;
  display: block;
  margin-bottom: 32rpx;
}
.option {
  border: 2rpx solid #e9e5ed;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 16rpx;
  font-size: 28rpx;
}
.option.active {
  border-color: #7560df;
  background: #ede8fb;
}
.nav {
  display: flex;
  gap: 16rpx;
  margin-top: 32rpx;
}
.half {
  flex: 1;
}
</style>
