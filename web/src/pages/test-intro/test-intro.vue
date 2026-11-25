<template>
  <view>
    <proto-nav />
  <view class="page">
    <DemoStrip />

    <view class="page-intro">
      <view class="eyebrow">{{ LIMITS.questionCount }} QUESTIONS / MBTI 趣味测试</view>
      <view class="h1">{{ LIMITS.questionCount }} 个选择，<text class="line">找到你更像的那一面。</text></view>
      <view class="p">只做选择题，无自由聊天。基础类型结果免费查看。</view>
    </view>

    <view class="field">
      <text class="label">名片昵称</text>
      <input class="input" v-model="profile.name" :maxlength="LIMITS.nickname" placeholder="例如：小禾" />
    </view>

    <view class="field">
      <text class="label">
        最近喜欢什么？ <text class="muted">选填 · 最多 {{ LIMITS.interests }} 项</text>
      </text>
      <view class="choice-row">
        <button
          v-for="i in INTERESTS"
          :key="i"
          class="choice"
          :class="{ sel: profile.interests.includes(i) }"
          @click="toggleInterest(i)"
        >
          {{ i }}
        </button>
      </view>
    </view>

    <view class="stage-context">
      <text class="section-kicker">给这次记录加一个阶段 · 仅自己可见</text>

      <view class="field">
        <text class="label">我正处于</text>
        <view class="choice-row">
          <button
            v-for="s in STAGES"
            :key="s"
            class="choice"
            :class="{ sel: profile.stage === s }"
            @click="profile.stage = s"
          >
            {{ s }}
          </button>
        </view>
      </view>

      <view class="field">
        <text class="label">
          最近的状态 <text class="muted">选填</text>
        </text>
        <view class="choice-row">
          <button
            v-for="s in RECENT_STATES"
            :key="s"
            class="choice"
            :class="{ sel: profile.recent === s }"
            @click="profile.recent = s"
          >
            {{ s }}
          </button>
        </view>
      </view>

      <text class="fine">按最近四周的通常状态作答。阶段标签只帮助回想，不作为变化原因的判断依据。</text>
    </view>

    <view class="notice">
      按日常倾向选择即可，偏好会随情境变化。这是原创趣味问卷，不是官方 MBTI 测评或心理诊断。
    </view>

    <text v-if="draftCount" class="fine mt">已保存 {{ draftCount }} / 12 题，可以继续。</text>
  </view>

  <view class="action-dock">
    <button class="btn full" :disabled="submitting" @click="start">
      {{ draftCount ? '继续 MBTI 测试' : '免费开始 · 12 道选择题' }}
    </button>
    <text class="dock-hint">趣味版非官方量表 · 基础结果免费</text>
  </view>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { createQuizSession } from '@/api/quiz'
import {
  INTERESTS,
  RECENT_STATES,
  STAGES,
  loadProfile,
  saveProfile,
} from '@/store/profile'
import {
  clearQuizDraft,
  loadQuizDraft,
  saveQuizDraft,
  type QuizDraft,
} from '@/store/quiz-draft'
import { LIMITS } from '@/constants/copy'

const profile = ref(loadProfile())
const submitting = ref(false)
const draft = ref<QuizDraft | null>(null)
const draftCount = computed(() => draftAnswerCount(draft.value))

function draftAnswerCount(item: QuizDraft | null): number {
  return item ? Object.keys(item.answers || {}).length : 0
}

onShow(() => {
  profile.value = loadProfile()
  draft.value = loadQuizDraft()
})

function toggleInterest(value: string) {
  const list = profile.value.interests
  const idx = list.indexOf(value)
  if (idx >= 0) {
    list.splice(idx, 1)
    return
  }
  if (list.length >= LIMITS.interests) {
    uni.showToast({ title: `最多选 ${LIMITS.interests} 项`, icon: 'none' })
    return
  }
  list.push(value)
}

function start() {
  if (submitting.value) return
  const current = loadQuizDraft()
  if (current && draftAnswerCount(current) > 0) {
    uni.showModal({
      title: '还有一份没完成的记录',
      content: `已选 ${draftAnswerCount(current)} / 12 题。既有历史仍保留。`,
      confirmText: '继续这次测试',
      cancelText: '放弃并重新开始',
      success: (res) => {
        if (res.confirm) continueDraft(current)
        else if (res.cancel) discardDraft()
      },
    })
    return
  }
  beginNewTest()
}

/** 继续本机保存的草稿会话，不新建 session */
function continueDraft(target?: QuizDraft | null) {
  const current = target || draft.value
  if (!current) return
  saveProfile({ ...profile.value })
  uni.navigateTo({ url: `/pages/quiz/quiz?sessionId=${current.sessionId}` })
}

/** 放弃未完成进度，重新开一场 */
function discardDraft() {
  clearQuizDraft()
  draft.value = null
  beginNewTest()
}

async function beginNewTest() {
  if (submitting.value) return
  submitting.value = true
  saveProfile({ ...profile.value })
  try {
    const session = await createQuizSession()
    clearQuizDraft()
    saveQuizDraft({
      sessionId: session.id,
      questionBankVersion: session.question_bank_version,
      answers: {},
      index: 0,
      updatedAt: new Date().toISOString(),
    })
    draft.value = loadQuizDraft()
    uni.navigateTo({ url: `/pages/quiz/quiz?sessionId=${session.id}` })
  } catch {
    uni.showToast({ title: '无法开始测验', icon: 'none' })
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped lang="scss">
.line {
  display: block;
  border-top: 0;
}

.fine {
  display: block;
}

.input {
  display: block;
  height: 54px;
  min-height: 54px;
}

.choice {
  margin: 0;
}

.page {
  padding-bottom: 120px;
}

.action-dock {
  display: block;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
}
</style>
