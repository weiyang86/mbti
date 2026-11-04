<template>
  <view class="page quiz">
    <view v-if="loading" class="state"><text class="state-text">正在加载题目…</text></view>

    <view v-else-if="!questions.length" class="state">
      <text class="state-text">题库加载失败</text>
      <view class="btn-secondary mt" @click="load">重试</view>
      <text class="back" @click="goHome">返回首页</text>
    </view>

    <view v-else>
      <view class="head">
        <text class="head-label">选择更接近日常的你</text>
        <text class="head-count">{{ pad(currentIndex + 1) }} / {{ pad(questions.length) }}</text>
      </view>
      <view class="bar"><view class="bar-fill" :style="{ width: barWidth }" /></view>

      <text class="dim">{{ dim.left }} <text class="slash">/</text> {{ dim.right }}</text>
      <text class="prompt">{{ question?.prompt || '' }}</text>

      <view class="options">
        <view
          v-for="(opt, i) in question?.options || []"
          :key="opt.id"
          class="option"
          :class="{ active: question && answers[question.id] === opt.id }"
          @click="pick(opt.id)"
        >
          <text class="letter">{{ i === 0 ? 'A' : 'B' }}</text>
          <text class="label">{{ opt.label }}</text>
        </view>
      </view>

      <view class="tools">
        <text class="prev" :class="{ disabled: currentIndex === 0 }" @click="prev">← 上一题</text>
        <text class="hint">选择后自动进入下一题</text>
      </view>

      <view class="notice">固定选项 · 不收集自由聊天内容</view>
    </view>
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
import { HttpError } from '@/api/client'

const DIM_LABELS: Record<Question['dimension'], [string, string]> = {
  EI: ['E', 'I'],
  SN: ['S', 'N'],
  TF: ['T', 'F'],
  JP: ['J', 'P'],
}

const sessionId = ref('')
const questions = ref<Question[]>([])
const currentIndex = ref(0)
const answers = ref<Record<string, string>>({})
const loading = ref(true)
const submitting = ref(false)

onLoad((q) => {
  sessionId.value = (q?.sessionId as string) || ''
})

onMounted(() => {
  load()
})

async function load() {
  loading.value = true
  try {
    const payload = await getCurrentQuizVersion()
    questions.value = payload.questions
  } catch {
    questions.value = []
  } finally {
    loading.value = false
  }
}

const question = computed<Question | undefined>(() => questions.value[currentIndex.value])

const dim = computed(() => {
  const key = question.value?.dimension ?? 'EI'
  const [left, right] = DIM_LABELS[key]
  return { left, right }
})

const barWidth = computed(() => {
  if (!questions.value.length) return '0%'
  return `${Math.round((currentIndex.value / questions.value.length) * 100)}%`
})

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function pick(optionId: string) {
  if (submitting.value || !question.value) return
  const qid = question.value.id
  answers.value[qid] = optionId

  const isLast = currentIndex.value === questions.value.length - 1
  if (!isLast) {
    currentIndex.value += 1
    persistOne(qid, optionId)
    return
  }
  submitAll()
}

/** 单题增量落库；失败不阻塞答题，最终提交时会用全集重试一次 */
function persistOne(questionId: string, optionId: string) {
  if (!sessionId.value) return
  updateQuizSessionAnswers(sessionId.value, [
    { question_id: questionId, option_id: optionId },
  ]).catch(() => {
    /* 静默失败，交给最终提交兜底 */
  })
}

async function submitAll() {
  if (!sessionId.value) {
    uni.showToast({ title: '会话已失效，请重新开始', icon: 'none' })
    setTimeout(() => uni.reLaunch({ url: '/pages/index/index' }), 800)
    return
  }
  submitting.value = true
  uni.showLoading({ title: '正在计算结果' })
  try {
    await updateQuizSessionAnswers(
      sessionId.value,
      questions.value.map((q) => ({
        question_id: q.id,
        option_id: answers.value[q.id],
      })),
    )
    const result = await submitQuizSession(sessionId.value, {})
    uni.hideLoading()
    uni.redirectTo({ url: `/pages/result/result?id=${result.id}` })
  } catch (e) {
    uni.hideLoading()
    if (e instanceof HttpError && e.status === 409) {
      uni.showToast({ title: '这场测验已提交，去记录里看', icon: 'none' })
      setTimeout(() => uni.reLaunch({ url: '/pages/history/list' }), 800)
      return
    }
    uni.showToast({ title: '提交失败，请重试', icon: 'none' })
  } finally {
    submitting.value = false
  }
}

function prev() {
  if (submitting.value || currentIndex.value === 0) return
  currentIndex.value -= 1
}

function goHome() {
  uni.reLaunch({ url: '/pages/index/index' })
}
</script>

<style scoped lang="scss">
.quiz {
  padding-top: 40rpx;
}

.state {
  padding-top: 200rpx;
  text-align: center;
}
.state-text {
  display: block;
  color: #77727e;
  font-size: 26rpx;
}
.back {
  display: block;
  margin-top: 32rpx;
  font-size: 24rpx;
  color: #7560df;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.head-label {
  font-size: 22rpx;
  color: #a398af;
  letter-spacing: 1rpx;
}
.head-count {
  font-size: 24rpx;
  font-weight: 700;
  color: #292630;
}

.bar {
  margin-top: 16rpx;
  height: 10rpx;
  border-radius: 999rpx;
  background: #ece8f3;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 999rpx;
  background: linear-gradient(90deg, #8b6cf6, #dfff8b);
  transition: width 0.25s ease;
}

.dim {
  display: block;
  margin-top: 48rpx;
  font-size: 36rpx;
  font-weight: 800;
  letter-spacing: 2rpx;
  color: #292630;
}
.slash {
  color: #7560df;
  font-weight: 400;
}

.prompt {
  display: block;
  margin-top: 24rpx;
  font-size: 44rpx;
  font-weight: 700;
  line-height: 1.5;
  color: #292630;
}

.options {
  margin-top: 48rpx;
}
.option {
  display: flex;
  align-items: center;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 24rpx;
  padding: 32rpx 28rpx;
  margin-bottom: 20rpx;
}
.option.active {
  border-color: #7560df;
  background: #f6f2ff;
}
.letter {
  flex-shrink: 0;
  width: 52rpx;
  height: 52rpx;
  border-radius: 50%;
  background: #f1ecfb;
  color: #7560df;
  font-size: 24rpx;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 24rpx;
}
.option.active .letter {
  background: #7560df;
  color: #fff;
}
.label {
  flex: 1;
  font-size: 28rpx;
  line-height: 1.5;
  color: #292630;
}

.tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 16rpx;
}
.prev {
  font-size: 26rpx;
  color: #7560df;
}
.prev.disabled {
  color: #c9c3d4;
}
.hint {
  font-size: 22rpx;
  color: #a398af;
}

.notice {
  margin-top: 48rpx;
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  background: #f3f0f8;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.6;
}

.mt {
  margin-top: 32rpx;
}
</style>
