<template>
  <view class="page buddy-page">
    <view v-if="loading" class="state"><text class="state-text">正在读取名片…</text></view>

    <view v-else-if="!buddy" class="state">
      <text class="state-text">这张名片当前不可查看</text>
      <view class="btn-secondary mt" @click="backDiscover">返回换名片</view>
    </view>

    <view v-else>
      <view class="demo-strip">
        <text>V0.4 · Mock 演示 · 不产生费用</text>
        <text class="demo-link" @click="showDemo">演示状态 ↗</text>
      </view>

      <view class="buddy-profile">
        <view class="buddy-avatar large" :style="{ background: buddy.avatar_color }">
          <text>{{ buddy.avatar_text }}</text>
        </view>
        <text class="tag">虚构成年人资料</text>
        <text class="profile-name">
          {{ buddy.nickname }}
          <text class="profile-type">{{ buddy.type_code }}</text>
        </text>
        <text class="profile-line">{{ buddy.tagline }}</text>
        <view class="tag-row">
          <text v-for="i in buddy.interests" :key="i" class="interest">{{ i }}</text>
        </view>
      </view>

      <view class="panel">
        <text class="panel-title">{{ buddy.compatibility_hint }}</text>
        <text class="panel-text">{{ hintText }}</text>
      </view>

      <view class="panel">
        <!-- 已互换名片 -->
        <view v-if="status === 'accepted'">
          <view class="notice green">✓ 已互换基础名片（模拟）</view>
          <view class="btn-primary mt" @click="goContactRequest">申请交换联系方式</view>
          <text class="textbtn block mt" @click="revokeCard">撤销名片交换</text>
        </view>

        <!-- 等待回应 -->
        <view v-else-if="status === 'pending'">
          <view class="notice">名片申请待回应，当前看不到任何联系方式。</view>
          <view class="demo-reply">
            <text class="demo-label">仅供演示：模拟对方操作</text>
            <view class="demo-actions">
              <view class="btn-secondary small" @click="respond('accept')">模拟对方同意</view>
              <view class="btn-ghost small" @click="respond('decline')">模拟对方拒绝</view>
            </view>
          </view>
          <text class="textbtn block" @click="revokeCard">取消申请</text>
        </view>

        <!-- 已拒绝 / 未申请 -->
        <view v-else>
          <text v-if="status === 'declined'" class="fine">
            对方已拒绝这次模拟申请，你可以再次发起。
          </text>
          <view class="btn-primary" :class="{ mt: status === 'declined' }" @click="requestCard">
            免费申请交换名片
          </view>
          <text class="fine centered mt">只交换公开名片，微信 / QQ / 电话另行授权。</text>
        </view>
      </view>

      <view class="btnrow mt">
        <text class="textbtn" @click="report">举报示例资料</text>
        <text class="textbtn" @click="block">屏蔽这位搭子</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import type { BuddyDetail, CardExchange } from '@/api/types-social'
import { blockBuddy, getBuddy } from '@/api/buddies'
import {
  createCardExchange,
  listCardExchanges,
  respondCardExchange,
  revokeCardExchange,
} from '@/api/card-exchanges'

const buddyId = ref('')
const buddy = ref<BuddyDetail | null>(null)
const exchange = ref<CardExchange | null>(null)
const loading = ref(true)
const busy = ref(false)

onLoad((q) => {
  buddyId.value = (q?.id as string) || ''
})

onShow(() => {
  load()
})

const status = computed(() => exchange.value?.status || buddy.value?.exchange_status || 'none')

const hintText = computed(() => {
  if (!buddy.value) return ''
  if (buddy.value.shared_interests.length) {
    return `你们都选了 ${buddy.value.shared_interests.join('、')}，可以作为认识彼此的起点。`
  }
  return '可以先交换名片，再决定是否愿意进一步联系。'
})

async function load() {
  if (!buddyId.value) {
    loading.value = false
    return
  }
  loading.value = !buddy.value
  try {
    const [detail, list] = await Promise.all([
      getBuddy(buddyId.value),
      listCardExchanges(),
    ])
    buddy.value = detail
    exchange.value = list.items.find((item) => item.buddy_id === buddyId.value) || null
  } catch {
    buddy.value = null
  } finally {
    loading.value = false
  }
}

async function requestCard() {
  if (busy.value || !buddy.value) return
  busy.value = true
  try {
    exchange.value = await createCardExchange({ buddy_id: buddy.value.id })
    await load()
    uni.showToast({ title: '名片申请已发出', icon: 'none' })
  } catch {
    uni.showToast({ title: '发送失败，请稍后再试', icon: 'none' })
  } finally {
    busy.value = false
  }
}

async function respond(action: 'accept' | 'decline') {
  if (busy.value || !exchange.value) return
  busy.value = true
  try {
    exchange.value = await respondCardExchange(exchange.value.id, action)
    await load()
  } catch {
    uni.showToast({ title: '操作失败，请稍后再试', icon: 'none' })
  } finally {
    busy.value = false
  }
}

function revokeCard() {
  if (!exchange.value) return
  uni.showModal({
    title: '撤销这次名片交换？',
    content: '撤销后应用内不再展示这张名片，但无法收回对方已保存的内容。',
    confirmText: '撤销',
    success: async (res) => {
      if (!res.confirm || !exchange.value) return
      try {
        await revokeCardExchange(exchange.value.id)
        exchange.value = null
        await load()
        uni.showToast({ title: '已撤销', icon: 'none' })
      } catch {
        uni.showToast({ title: '撤销失败，请稍后再试', icon: 'none' })
      }
    },
  })
}

function goContactRequest() {
  uni.navigateTo({ url: `/pages/contact-request/contact-request?id=${buddyId.value}` })
}

function report() {
  uni.showModal({
    title: '已记录（演示）',
    content: '这是虚构示例资料，举报不会发送到真实平台。',
    showCancel: false,
    confirmText: '知道了',
  })
}

function block() {
  uni.showModal({
    title: '屏蔽这位搭子？',
    content: '屏蔽后不再出现在推荐与名片夹中，可在“我的”里解除。',
    confirmText: '屏蔽',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await blockBuddy(buddyId.value)
        uni.showToast({ title: '已屏蔽', icon: 'none' })
        setTimeout(backDiscover, 500)
      } catch {
        uni.showToast({ title: '操作失败，请稍后再试', icon: 'none' })
      }
    },
  })
}

function backDiscover() {
  uni.switchTab({ url: '/pages/discover/discover' })
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：搭子资料、名片交换状态均为本地虚构数据。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.buddy-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
}

.demo-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 20rpx;
  color: #a398af;
  margin-bottom: 16rpx;
}
.demo-link {
  color: #7560df;
}

.state {
  padding-top: 220rpx;
  text-align: center;
}
.state-text {
  display: block;
  font-size: 26rpx;
  color: #77727e;
}

.buddy-profile {
  text-align: center;
  padding: 24rpx 0 30rpx;
}
.buddy-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #746380;
}
.buddy-avatar.large {
  width: 170rpx;
  height: 170rpx;
  margin: 0 auto 26rpx;
  border-radius: 52rpx;
  font-size: 68rpx;
}
.tag {
  display: inline-block;
  font-size: 18rpx;
  padding: 10rpx 20rpx;
  border-radius: 16rpx;
  background: #eee9ff;
  color: #6d58b2;
}
.profile-name {
  display: block;
  font-size: 52rpx;
  font-weight: 800;
  margin: 24rpx 0 14rpx;
  color: #292630;
}
.profile-type {
  font-size: 34rpx;
  color: #9470b3;
  font-weight: 600;
  margin-left: 10rpx;
}
.profile-line {
  display: block;
  font-size: 24rpx;
  color: #77727e;
}
.tag-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14rpx;
  margin-top: 20rpx;
}
.interest {
  font-size: 20rpx;
  padding: 8rpx 18rpx;
  border-radius: 14rpx;
  background: #eee9ff;
  color: #6d58b2;
}

.panel {
  background: #fff;
  border: 2rpx solid #ece7f1;
  border-radius: 38rpx;
  padding: 36rpx 32rpx;
  margin-top: 28rpx;
}
.panel-title {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
  color: #292630;
}
.panel-text {
  display: block;
  margin-top: 14rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.7;
}

.notice {
  display: block;
  background: #f5f3fa;
  border: 2rpx solid #e9e3f3;
  padding: 26rpx 30rpx;
  border-radius: 24rpx;
  color: #7c728b;
  font-size: 24rpx;
  line-height: 1.7;
}
.notice.green {
  background: #edf6f0;
  border-color: #dceade;
  color: #537c65;
}

.demo-reply {
  margin-top: 24rpx;
  padding: 28rpx;
  background: #f5f1fa;
  border: 2rpx dashed #d8c9e8;
  border-radius: 24rpx;
}
.demo-label {
  display: block;
  font-size: 20rpx;
  color: #aa95bc;
  margin-bottom: 18rpx;
}
.demo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}
.demo-actions view {
  flex: 1;
}

.btn-primary,
.btn-secondary,
.btn-ghost {
  display: block;
  text-align: center;
  border-radius: 24rpx;
  padding: 22rpx 24rpx;
  font-size: 26rpx;
  font-weight: 600;
}
.btn-primary {
  background: #6c4cf3;
  color: #fff;
}
.btn-secondary {
  background: #fff;
  color: #292630;
  border: 2rpx solid #ece7f1;
}
.btn-ghost {
  background: transparent;
  color: #77727e;
  border: 2rpx solid #ece7f1;
}
.btn-secondary.small,
.btn-ghost.small {
  font-size: 22rpx;
  padding: 16rpx 20rpx;
  border-radius: 18rpx;
}

.textbtn {
  display: inline-block;
  color: #7560df;
  font-size: 24rpx;
  padding: 8rpx;
}
.textbtn.block {
  display: block;
  text-align: center;
}
.btnrow {
  display: flex;
  justify-content: space-around;
  align-items: center;
}

.fine {
  display: block;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.7;
}
.centered {
  text-align: center;
}
.mt {
  margin-top: 24rpx;
}
.mb {
  margin-bottom: 24rpx;
}
</style>
