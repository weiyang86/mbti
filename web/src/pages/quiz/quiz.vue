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
      <view class="btn-primary half" @click="next">{{ saving ? '正在保存…' : isLast ? '提交' : '下一题' }}</view>
    </view>
    <view class="btn-secondary mt" @click="goHome">返回首页（保留进度）</view>
  </view>
  <view class="page" v-else>
    <text class="muted">{{ recoveryMessage }}</text>
    <view class="btn-primary mt" @click="goHome">返回首页重新开始</view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import type { Question } from '@/api/types'
import { submitQuizSession, updateQuizSessionAnswers } from '@/api/quiz'
import { HttpError, requestErrorMessage } from '@/api/client'
import { clearQuizDraft, isRestorableDraft, loadQuizDraft, recoveryMessage, saveQuizDraft, type QuizDraft } from '@/store/quiz-draft'

const sessionId = ref('')
const questions = ref<Question[]>([])
const currentIndex = ref(0)
const answers = ref<Record<string, string>>({})
const saving = ref(false)
let activeDraft: QuizDraft | null = null

onLoad((query) => {
  sessionId.value = (query?.sessionId as string) || ''
  const draft = loadQuizDraft()
  if (!isRestorableDraft(draft) || draft.sessionId !== sessionId.value) return
  activeDraft = draft
  questions.value = draft.questionBank.questions
  answers.value = { ...draft.answers }
  currentIndex.value = draft.index
})

const question = computed(() => questions.value[currentIndex.value])
const isLast = computed(() => currentIndex.value === questions.value.length - 1)
const selectedOption = computed(() =>
  question.value ? answers.value[question.value.id] : undefined,
)

function selectOption(optionId: string) {
  if (saving.value || !question.value) return
  answers.value[question.value.id] = optionId
  persistDraft()
}

function persistDraft() {
  if (!activeDraft) return
  try {
    saveQuizDraft({ ...activeDraft, answers: { ...answers.value }, index: currentIndex.value, updatedAt: new Date().toISOString() })
  } catch {
    uni.showToast({ title: '本机进度保存失败，请勿刷新页面', icon: 'none' })
  }
}

async function next() {
  if (saving.value || !question.value) return
  if (!selectedOption.value) {
    uni.showToast({ title: '请选择一个选项', icon: 'none' })
    return
  }
  saving.value = true
  try {
    // Await each save; final save reconciles all restored/local answers before submit.
    await updateQuizSessionAnswers(sessionId.value, isLast.value
      ? questions.value.map((q) => ({ question_id: q.id, option_id: answers.value[q.id] }))
      : [{ question_id: question.value.id, option_id: selectedOption.value }])
    if (isLast.value) {
      const result = await submitQuizSession(sessionId.value)
      clearQuizDraft()
      uni.redirectTo({ url: `/pages/result/result?id=${encodeURIComponent(result.id)}` })
    } else {
      currentIndex.value += 1
      persistDraft()
    }
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) {
      clearQuizDraft()
      uni.showToast({ title: '这次测验已提交，请到阶段记录查看', icon: 'none' })
      uni.redirectTo({ url: '/pages/history/list' })
    } else {
      uni.showToast({ title: requestErrorMessage(error, '保存或提交失败，请重试'), icon: 'none' })
    }
  } finally {
    saving.value = false
  }
}

function prev() {
  if (saving.value || currentIndex.value === 0) return
  currentIndex.value -= 1
  persistDraft()
}

function goHome() {
  if (saving.value) return
  uni.reLaunch({ url: '/pages/index/index' })
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
.mt {
  margin-top: 24rpx;
}
</style>
