<template>
  <view class="page">
    <view class="hero card">
      <text class="eyebrow">TEST · CREATE · CONNECT</text>
      <text class="h1">MBTI搭子</text>
      <text class="lead muted">趣味倾向体验，非临床测评。带教闭环：测 → 结果 → 晒预览 → 阶段记录。</text>
    </view>

    <view class="actions">
      <view class="btn-primary" @click="startQuiz">{{ starting ? '正在准备题目…' : '测一测（12 题）' }}</view>
      <view v-if="sessionExpired" class="btn-secondary mt" @click="renewGuest">重新建立游客会话</view>
      <view class="btn-secondary mt" @click="goSelfSelect">我已经知道类型</view>
      <view class="btn-secondary mt" @click="goHistory">阶段记录</view>
      <view class="btn-secondary mt" @click="goCatalog">商品目录</view>
      <view class="btn-secondary mt" @click="goOrders">我的订单与权益</view>
      <view class="btn-secondary mt" @click="goCard">我的名片</view>
      <view class="btn-secondary mt" @click="goDiscover">发现搭子</view>
      <view class="btn-secondary mt" @click="goExchanges">我的名片夹</view>
      <view class="btn-secondary mt" @click="goBlocked">屏蔽管理</view>
      <view class="btn-secondary mt" @click="goContacts">本人联系方式</view>
      <view class="btn-secondary mt" @click="goContactRequests">联系方式请求</view>
    </view>

    <text v-if="latest" class="muted foot">最近结果：{{ latest.type_code }}</text>
    <text class="muted foot">趣味倾向体验 · {{ mockMode ? 'Mock 演示' : '在线测评' }}</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { createQuizSession, getCurrentQuizVersion } from '@/api/quiz'
import { listResults } from '@/api/results'
import type { ResultSnapshotSummary } from '@/api/types'
import { isGuestSessionExpired, requestErrorMessage, startNewGuestSession, useMock } from '@/api/client'
import { clearQuizDraft, createQuizDraft, isRestorableDraft, loadQuizDraft, recoveryMessage } from '@/store/quiz-draft'

const starting = ref(false)
const sessionExpired = ref(false)
const latest = ref<ResultSnapshotSummary | null>(null)
const mockMode = useMock()

onShow(async () => {
  sessionExpired.value = isGuestSessionExpired()
  try {
    const response = await listResults({ limit: 1 })
    latest.value = response.items[0] || null
  } catch (error) {
    sessionExpired.value = isGuestSessionExpired()
    uni.showToast({ title: requestErrorMessage(error, '暂时无法读取阶段记录，可稍后重试'), icon: 'none' })
  }
})

async function startQuiz() {
  if (starting.value) return
  if (isGuestSessionExpired()) {
    sessionExpired.value = true
    uni.showToast({ title: '游客会话已失效，请先重新建立会话', icon: 'none' })
    return
  }
  const draft = loadQuizDraft()
  if (draft) {
    uni.showModal({
      title: isRestorableDraft(draft) ? '还有一份没完成的测验' : '需要重新开始',
      content: isRestorableDraft(draft) ? '可以继续上次答题，也可以重新开始。已有历史结果会保留。' : recoveryMessage,
      confirmText: isRestorableDraft(draft) ? '继续答题' : '重新开始',
      cancelText: isRestorableDraft(draft) ? '重新开始' : '暂不开始',
      success: (response) => {
        if (response.confirm && isRestorableDraft(draft)) {
          uni.navigateTo({ url: `/pages/quiz/quiz?sessionId=${encodeURIComponent(draft.sessionId)}` })
        } else if ((response.cancel && isRestorableDraft(draft)) || (response.confirm && !isRestorableDraft(draft))) {
          clearQuizDraft()
          beginQuiz()
        }
      },
    })
    return
  }
  await beginQuiz()
}

async function beginQuiz() {
  if (starting.value) return
  starting.value = true
  try {
    const questionBank = await getCurrentQuizVersion()
    const session = await createQuizSession({ question_bank_version: questionBank.question_bank_version })
    createQuizDraft(session, questionBank)
    uni.navigateTo({ url: `/pages/quiz/quiz?sessionId=${encodeURIComponent(session.id)}` })
  } catch (e) {
    sessionExpired.value = isGuestSessionExpired()
    uni.showToast({ title: requestErrorMessage(e, '无法开始测验，请重试'), icon: 'none' })
  } finally {
    starting.value = false
  }
}

function renewGuest() {
  if (starting.value) return
  uni.showModal({
    title: '建立新的游客会话？',
    content: '原游客历史结果仍保留在服务端，新游客无法访问。本次操作会放弃未完成的答题，之后可重新测评。',
    confirmText: '建立新会话',
    success: async (response) => {
      if (!response.confirm) return
      starting.value = true
      try {
        await startNewGuestSession()
        clearQuizDraft()
        latest.value = null
        sessionExpired.value = false
        uni.showToast({ title: '新会话已建立', icon: 'none' })
      } catch (error) {
        uni.showToast({ title: requestErrorMessage(error, '无法建立会话，请重试'), icon: 'none' })
      } finally {
        starting.value = false
      }
    },
  })
}

function goSelfSelect() {
  uni.navigateTo({ url: '/pages/self-select/self-select' })
}

function goHistory() {
  uni.navigateTo({ url: '/pages/history/list' })
}

function goCatalog() { uni.navigateTo({ url: '/pages/pricing/pricing' }) }
function goOrders() { uni.navigateTo({ url: '/pages/orders/orders' }) }
function goCard() { uni.navigateTo({ url: '/pages/card/card' }) }
function goDiscover() { uni.navigateTo({ url: '/pages/discover/discover' }) }
function goExchanges() { uni.navigateTo({ url: '/pages/exchanges/exchanges' }) }
function goBlocked() { uni.navigateTo({ url: '/pages/buddies/blocked' }) }
function goContacts() { uni.navigateTo({ url: '/pages/contacts/contacts' }) }
function goContactRequests() { uni.navigateTo({ url: '/pages/contact-request/contact-request' }) }
</script>

<style scoped lang="scss">
.hero {
  margin-bottom: 48rpx;
}
.eyebrow {
  font-size: 22rpx;
  letter-spacing: 4rpx;
  color: #7560df;
}
.h1 {
  display: block;
  font-size: 56rpx;
  font-weight: 700;
  margin: 16rpx 0;
}
.lead {
  display: block;
  line-height: 1.7;
}
.actions {
  display: flex;
  flex-direction: column;
}
.mt {
  margin-top: 24rpx;
}
.foot {
  display: block;
  margin-top: 64rpx;
  text-align: center;
}
</style>
