<template>
  <view class="page quiz">
    <view v-if="loading" class="state"><text class="state-text">正在加载题目…</text></view>

    <view v-else-if="!questions.length" class="state">
      <text class="state-text">题库加载失败</text>
      <view class="btn-secondary mt" @click="load">重试</view>
      <text class="back" @click="goHome">返回首页</text>
    </view>

    <view v-else>
      <view class="demo-strip">
        <text>V0.4 · 趣味体验 · 不产生费用</text>
        <text class="demo-link" @click="showDemo">体验说明 ↗</text>
      </view>

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
import {
  clearQuizDraft,
  loadQuizDraft,
  saveQuizDraft,
} from '@/store/quiz-draft'
import { saveLocalAnswers } from '@/store/local-answers'

const DIM_LABELS: Record<Question['dimension'], [string, string]> = {
  EI: ['E', 'I'],
  SN: ['S', 'N'],
  TF: ['T', 'F'],
  JP: ['J', 'P'],
}

const sessionId = ref('')
const version = ref('')
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
    version.value = payload.question_bank_version
    questions.value = payload.questions
    restoreDraft()
  } catch {
    questions.value = []
  } finally {
    loading.value = false
  }
}

/** 同一 session 的本地草稿：恢复已答题目与当前题号 */
function restoreDraft() {
  const draft = loadQuizDraft()
  if (!draft || draft.sessionId !== sessionId.value) return
  answers.value = { ...draft.answers }
  const max = Math.max(questions.value.length - 1, 0)
  currentIndex.value = Math.min(Math.max(draft.index, 0), max)
}

function persistDraft(index: number) {
  if (!sessionId.value) return
  saveQuizDraft({
    sessionId: sessionId.value,
    questionBankVersion: version.value,
    answers: { ...answers.value },
    index,
    updatedAt: new Date().toISOString(),
  })
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
  persistDraft(isLast ? currentIndex.value : currentIndex.value + 1)
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
    const profile = readProfile()
    const result = await submitQuizSession(sessionId.value, {
      life_stage: profile.stage,
      recent_status: profile.recent,
    })
    saveLocalAnswers(
      result.id,
      result.question_bank_version,
      questions.value.map((q) => ({
        question: q.prompt,
        answer: q.options.find((o) => o.id === answers.value[q.id])?.label || '未作答',
      })),
    )
    uni.hideLoading()
    clearQuizDraft()
    uni.redirectTo({ url: `/pages/result/result?id=${result.id}` })
  } catch (e) {
    uni.hideLoading()
    if (e instanceof HttpError && e.status === 409) {
      clearQuizDraft()
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
  persistDraft(currentIndex.value)
}

function goHome() {
  uni.reLaunch({ url: '/pages/index/index' })
}

function showDemo() {
  uni.showModal({
    title: '体验说明',
    content: '当前为 V0.4 趣味体验版：题目与结果来自正式测试接口，仅供趣味参考，不构成心理诊断。',
    showCancel: false,
    confirmText: '知道了',
  })
}

/** 读取测试入口保存的阶段信息（与 web/src/store/profile.ts 使用同一存储键） */
function readProfile(): { stage?: string; recent?: string } {
  try {
    const raw = uni.getStorageSync('mbti_test_profile_v1')
    if (raw && typeof raw === 'object') {
      return {
        stage: typeof raw.stage === 'string' ? raw.stage : undefined,
        recent: typeof raw.recent === 'string' ? raw.recent : undefined,
      }
    }
  } catch {
    /* ignore */
  }
  return {}
}
</script>

<style scoped lang="scss">
.quiz {
  padding-top: 24rpx;
}

.demo-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 20rpx;
  color: #a398af;
  margin-bottom: 28rpx;
}
.demo-link {
  color: #7560df;
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
  margin-top: 14rpx;
  height: 6rpx;
  border-radius: 999rpx;
  background: #ece8f3;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  border-radius: 999rpx;
  background: #7560df;
  transition: width 0.25s ease;
}

.dim {
  display: block;
  margin-top: 56rpx;
  font-size: 88rpx;
  font-weight: 800;
  letter-spacing: 6rpx;
  color: #7559e8;
  line-height: 1;
}
.slash {
  color: #d9cdf0;
  font-weight: 300;
  margin: 0 8rpx;
}

.prompt {
  display: block;
  margin-top: 40rpx;
  font-size: 48rpx;
  font-weight: 800;
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
