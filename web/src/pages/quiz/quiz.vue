<template>
  <view class="page quiz-page">
    <proto-nav />
    <DemoStrip />

    <StateView v-if="loading" state="loading" title="正在加载题目…" />

    <StateView v-else-if="!questions.length" state="error" title="题库加载失败" description="请检查网络后再试一次。">
      <button class="btn secondary full" @click="load">重试</button>
      <text class="textbtn" @click="goHome">返回首页</text>
    </StateView>

    <template v-else>
      <view class="question-progress">
        <text>选择更接近日常的你</text>
        <text class="count">{{ pad(currentIndex + 1) }} / {{ pad(questions.length) }}</text>
      </view>
      <view class="progress"><view class="i" :style="{ width: barWidth }" /></view>

      <text class="quiz-mark">{{ dim.left }} <text class="i">/</text> {{ dim.right }}</text>
      <view class="h1">{{ question?.prompt || '' }}</view>

      <view class="question-options">
        <button
          v-for="(opt, i) in question?.options || []"
          :key="opt.id"
          class="question-option"
          :class="{ active: question && answers[question.id] === opt.id }"
          @click="pick(opt.id)"
        >
          <text class="span">{{ i === 0 ? 'A' : 'B' }}</text>
          <text class="b">{{ opt.label }}</text>
        </button>
      </view>

      <view class="chat-tools">
        <text class="textbtn" :class="{ disabled: currentIndex === 0 }" @click="prev">← 上一题</text>
        <text class="fine">选择后自动进入下一题</text>
      </view>

      <view class="notice mt">固定选项 · 不收集自由聊天内容</view>
    </template>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import StateView from '@/components/state-view.vue'
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
.question-progress {
  margin-bottom: 0;
  font-size: 14px;
  letter-spacing: normal;
  color: var(--ink);
  line-height: 1.65;
}
.question-progress .count {
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
}

.quiz-mark .i {
  font-style: normal;
  font-weight: 300;
  color: #d7cdeb;
}

.question-option {
  width: 100%;
  margin: 0;
  font-size: 14px;
}

.question-option.active {
  border-color: #6c4cf3;
  background: #f0eafd;
}

.textbtn.disabled {
  color: var(--accent);
  opacity: 0.5;
}

.chat-tools .fine {
  font-size: 9px;
  color: #b1a3be;
}

.mt {
  margin-top: 20px;
}
</style>
