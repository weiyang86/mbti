<template>
  <view class="page intro-page">
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="demo-link" @click="showDemo">演示状态 ↗</text>
    </view>

    <text class="kicker"><text class="dash">—</text> 12 QUESTIONS / MBTI 趣味测试</text>
    <text class="title">12 个选择，</text>
    <text class="title">找到你更像的那一面。</text>
    <text class="sub">只做选择题，无自由聊天。基础类型结果免费查看。</text>

    <view class="field">
      <text class="label">名片昵称</text>
      <input class="input" v-model="profile.name" maxlength="12" placeholder="例如：小禾" />
    </view>

    <view class="field">
      <text class="label">最近喜欢什么？ <text class="muted">选填 · 最多 3 项</text></text>
      <view class="chips">
        <view
          v-for="i in INTERESTS"
          :key="i"
          class="chip"
          :class="{ sel: profile.interests.includes(i) }"
          @click="toggleInterest(i)"
        >
          <text>{{ i }}</text>
        </view>
      </view>
    </view>

    <view class="stage-card">
      <text class="section-kicker">给这次记录加一个阶段 · 仅自己可见</text>

      <view class="field">
        <text class="label">我正处于</text>
        <view class="chips">
          <view
            v-for="s in STAGES"
            :key="s"
            class="chip"
            :class="{ sel: profile.stage === s }"
            @click="profile.stage = s"
          >
            <text>{{ s }}</text>
          </view>
        </view>
      </view>

      <view class="field">
        <text class="label">最近的状态 <text class="muted">选填</text></text>
        <view class="chips">
          <view
            v-for="s in RECENT_STATES"
            :key="s"
            class="chip"
            :class="{ sel: profile.recent === s }"
            @click="profile.recent = s"
          >
            <text>{{ s }}</text>
          </view>
        </view>
      </view>

      <text class="fine">按最近四周的通常状态作答。阶段标签只帮助回想，不作为变化原因的判断依据。</text>
    </view>

    <view class="notice">
      按日常倾向选择即可，偏好会随情境变化。这是原创趣味问卷，不是官方 MBTI 测评或心理诊断。
    </view>

    <view class="footer">
      <view class="btn-primary" :class="{ disabled: submitting }" @click="start">免费开始 · 12 道选择题</view>
      <text class="foot-note">趣味版非官方量表 · 基础结果免费</text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { createQuizSession } from '@/api/quiz'
import {
  INTERESTS,
  RECENT_STATES,
  STAGES,
  loadProfile,
  saveProfile,
} from '@/store/profile'

const profile = ref(loadProfile())
const submitting = ref(false)

onLoad(() => {
  profile.value = loadProfile()
})

function toggleInterest(value: string) {
  const list = profile.value.interests
  const idx = list.indexOf(value)
  if (idx >= 0) {
    list.splice(idx, 1)
    return
  }
  if (list.length >= 3) {
    uni.showToast({ title: '最多选 3 项', icon: 'none' })
    return
  }
  list.push(value)
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：页面数据来自本地 mock，不产生真实费用，也未连接真实后端。',
    showCancel: false,
    confirmText: '知道了',
  })
}

async function start() {
  if (submitting.value) return
  submitting.value = true
  saveProfile({ ...profile.value })
  try {
    const session = await createQuizSession()
    uni.navigateTo({ url: `/pages/quiz/quiz?sessionId=${session.id}` })
  } catch {
    uni.showToast({ title: '无法开始测验', icon: 'none' })
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped lang="scss">
.intro-page {
  padding-top: 24rpx;
  padding-bottom: 220rpx;
}

.demo-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 20rpx;
  color: #a398af;
}
.demo-link {
  color: #7560df;
}

.kicker {
  display: block;
  margin-top: 40rpx;
  font-size: 22rpx;
  letter-spacing: 2rpx;
  color: #7560df;
  font-weight: 600;
}
.dash {
  margin-right: 10rpx;
  color: #8b6cf6;
}
.title {
  display: block;
  margin-top: 20rpx;
  font-size: 54rpx;
  font-weight: 800;
  line-height: 1.3;
  letter-spacing: -1rpx;
}
.title + .title {
  margin-top: 0;
}
.sub {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #a398af;
}

.field {
  margin-top: 36rpx;
}
.label {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: #292630;
}
.muted {
  font-size: 20rpx;
  color: #a398af;
  font-weight: 400;
}
.input {
  margin-top: 16rpx;
  height: 88rpx;
  background: #fff;
  border: 2rpx solid #ece8f3;
  border-radius: 16rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: #292630;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 16rpx;
}
.chip {
  padding: 14rpx 26rpx;
  border-radius: 999rpx;
  border: 2rpx solid #ece8f3;
  background: #fff;
  font-size: 24rpx;
  color: #77727e;
}
.chip.sel {
  border-color: #7560df;
  background: #f1ecfb;
  color: #7560df;
  font-weight: 600;
}

.stage-card {
  margin-top: 40rpx;
  padding: 28rpx 24rpx 32rpx;
  border-radius: 24rpx;
  background: #f6f3fb;
  border: 2rpx solid #ece6f7;
}
.section-kicker {
  display: block;
  font-size: 22rpx;
  color: #a398af;
}
.fine {
  display: block;
  margin-top: 20rpx;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.6;
}

.notice {
  margin-top: 36rpx;
  padding: 20rpx 24rpx;
  border-radius: 16rpx;
  background: #f3f0f8;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.6;
}

.footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 20rpx 32rpx 28rpx;
  background: #f8f7f4;
  box-shadow: 0 -12rpx 32rpx rgba(49, 33, 77, 0.06);
}
.footer .btn-primary {
  font-weight: 700;
}
.footer .btn-primary.disabled {
  opacity: 0.6;
}
.foot-note {
  display: block;
  margin-top: 12rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
}
</style>
