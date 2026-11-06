<template>
  <view class="page account-page">
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="demo-link" @click="showDemo">演示状态 ↗</text>
    </view>

    <view class="profile-head">
      <view class="profile-avatar"><text>{{ avatarText }}</text></view>
      <view class="profile-body">
        <text class="profile-name">{{ card?.nickname || '小禾' }}</text>
        <text class="profile-meta">
          {{ card?.type_code ? card.type_code + ' · ' + card.type_name : '还没有类型' }}
        </text>
        <text class="profile-badge">免费基础用户 · Mock 演示</text>
      </view>
    </view>

    <view class="account-links">
      <view v-for="link in links" :key="link.key" class="account-link" @click="onLink(link.key)">
        <text class="link-title">{{ link.title }}</text>
        <text class="link-desc">{{ link.desc }}</text>
      </view>
    </view>

    <view class="panel">
      <view class="panel-head">
        <text class="panel-title">模拟订单</text>
        <text class="panel-note">模拟支付 · 不扣款</text>
      </view>
      <template v-if="studio.orders.length">
        <view class="order-row" v-for="o in studio.orders" :key="o.id">
          <view class="order-main">
            <text class="order-name">{{ PLAN_NAMES[o.tier] }}</text>
            <text class="order-meta">{{ o.id }} · {{ o.created_at.slice(0, 10) }}</text>
          </view>
          <text class="order-amount">{{ o.amount ? '¥' + o.amount : '体验码' }}</text>
        </view>
      </template>
      <text v-else class="panel-text">
        还没有订单。基础结果免费；晒图套装当前为模拟支付，仅保存在本机。
      </text>
      <text class="textbtn" @click="goPricing">
        {{ studio.tier ? '查看我的形象套装 →' : '去看晒图套装 →' }}
      </text>
    </view>

    <view class="panel">
      <text class="panel-title">资料与工具</text>
      <view class="tool-row" @click="goTest">
        <text class="tool-name">免费复测</text>
        <text class="tool-desc">再记录一个阶段</text>
      </view>
      <view class="tool-row" @click="goPricing">
        <text class="tool-name">兑换体验码</text>
        <text class="tool-desc">{{ tierName ? '已解锁 ' + tierName : '支持演示体验码' }}</text>
      </view>
      <view class="tool-row" @click="manageBlocked">
        <text class="tool-name">管理屏蔽列表</text>
        <text class="tool-desc">{{ blockedCount ? blockedCount + ' 位搭子' : '暂无屏蔽' }}</text>
      </view>
      <view class="tool-row" @click="goContacts">
        <text class="tool-name">交换设置</text>
        <text class="tool-desc">{{ contactDesc }}</text>
      </view>
      <view class="tool-row" @click="resetDemo">
        <text class="tool-name">清除本机演示数据</text>
        <text class="tool-desc">名片交换与联系方式</text>
      </view>
    </view>

    <view class="notice mt">
      没有聊天、评论、自由发布动态或附近头像地图。附近雷达若后续开放，只提供匿名人数。
    </view>

    <text class="version">MBTI 搭子 · V0.4 Mock · 虚构成年人资料</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import type { MyCard } from '@/api/types-social'
import { getMyCard } from '@/api/cards'
import { listCardExchanges } from '@/api/card-exchanges'
import { getContacts } from '@/api/contacts'
import { listBlockedBuddies, unblockBuddy } from '@/api/buddies'
import { resetDemoData } from '@/api/demo'
import { PLAN_NAMES, studio } from '@/store/studio'

type LinkKey = 'trail' | 'result' | 'card' | 'exchanges' | 'contacts' | 'privacy'

interface LinkItem {
  key: LinkKey
  title: string
  desc: string
}

const card = ref<MyCard | null>(null)
const latestResultId = ref('')
const exchangeCount = ref(0)
const contactCount = ref(0)
const blockedCount = ref(0)

const avatarText = computed(() => (card.value?.nickname || '小禾').slice(0, 1))

const contactDesc = computed(() =>
  contactCount.value ? `已填写 ${contactCount.value} 项` : '未填写',
)

const links = computed<LinkItem[]>(() => [
  { key: 'trail', title: '我的轨迹', desc: '历史阶段与前后对比' },
  { key: 'result', title: '类型结果', desc: latestResultId.value ? '查看最近一次结果' : '还没有结果' },
  { key: 'card', title: '我的名片', desc: card.value?.type_code || '待生成' },
  { key: 'exchanges', title: '名片夹', desc: exchangeCount.value ? `${exchangeCount.value} 张名片` : '还没有记录' },
  { key: 'contacts', title: '交换设置', desc: contactDesc.value },
  { key: 'privacy', title: '管理公开范围', desc: '公开名片可见字段' },
])

onShow(() => {
  load()
})

async function load() {
  try {
    const [myCard, exchanges, contacts, blocked] = await Promise.all([
      getMyCard(),
      listCardExchanges(),
      getContacts(),
      listBlockedBuddies(),
    ])
    card.value = myCard
    latestResultId.value = myCard.latest_result_id || ''
    exchangeCount.value = exchanges.items.length
    contactCount.value = (['wechat', 'qq', 'phone'] as const).filter((key) => contacts[key]).length
    blockedCount.value = blocked.items.length
  } catch {
    card.value = null
  }
}

function onLink(key: LinkKey) {
  if (key === 'trail') {
    uni.switchTab({ url: '/pages/history/list' })
    return
  }
  if (key === 'result') {
    if (!latestResultId.value) {
      uni.showToast({ title: '还没有测试结果', icon: 'none' })
      return
    }
    uni.navigateTo({ url: `/pages/result/result?id=${latestResultId.value}` })
    return
  }
  if (key === 'card') {
    uni.switchTab({ url: '/pages/card/card' })
    return
  }
  if (key === 'exchanges') {
    uni.navigateTo({ url: '/pages/exchanges/exchanges' })
    return
  }
  if (key === 'contacts') {
    uni.navigateTo({ url: '/pages/contacts/contacts' })
    return
  }
  uni.switchTab({ url: '/pages/card/card' })
}

function goTest() {
  uni.switchTab({ url: '/pages/index/index' })
}

function goContacts() {
  uni.navigateTo({ url: '/pages/contacts/contacts' })
}

const tierName = computed(() => (studio.tier ? PLAN_NAMES[studio.tier] : ''))

function goPricing() {
  uni.navigateTo({ url: '/pages/pricing/pricing' })
}

async function manageBlocked() {
  try {
    const res = await listBlockedBuddies()
    if (!res.items.length) {
      uni.showToast({ title: '暂无屏蔽的搭子', icon: 'none' })
      return
    }
    uni.showActionSheet({
      itemList: res.items.map((item) => `解除屏蔽 ${item.nickname}`),
      success: async ({ tapIndex }) => {
        const target = res.items[tapIndex]
        if (!target) return
        await unblockBuddy(target.id)
        await load()
        uni.showToast({ title: '已解除屏蔽', icon: 'none' })
      },
    })
  } catch {
    uni.showToast({ title: '读取失败，请稍后再试', icon: 'none' })
  }
}

function resetDemo() {
  uni.showModal({
    title: '清除本机演示数据？',
    content: '会清除名片交换、联系方式与公开范围设置，测试结果仍然保留。',
    confirmText: '清除',
    success: async (res) => {
      if (!res.confirm) return
      resetDemoData()
      await load()
      uni.showToast({ title: '已清除', icon: 'none' })
    },
  })
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：所有社交数据保存在本机，不会与真实用户交换，也不产生费用。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.account-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
}

.demo-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 20rpx;
  color: #a398af;
  margin-bottom: 24rpx;
}
.demo-link {
  color: #7560df;
}

.profile-head {
  display: flex;
  align-items: center;
  gap: 26rpx;
  background: #fff;
  border: 2rpx solid #e9e3f1;
  border-radius: 34rpx;
  padding: 34rpx 32rpx;
}
.profile-avatar {
  width: 112rpx;
  height: 112rpx;
  border-radius: 36rpx;
  background: linear-gradient(135deg, #d9cdff, #b9e9d1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 42rpx;
  font-weight: 700;
  color: #4b3b7a;
  flex-shrink: 0;
}
.profile-body {
  flex: 1;
}
.profile-name {
  display: block;
  font-size: 34rpx;
  font-weight: 800;
  color: #292630;
}
.profile-meta {
  display: block;
  font-size: 22rpx;
  color: #8b7a99;
  margin-top: 8rpx;
}
.profile-badge {
  display: inline-block;
  font-size: 18rpx;
  color: #6d58b2;
  background: #f0ebff;
  padding: 8rpx 16rpx;
  border-radius: 12rpx;
  margin-top: 14rpx;
}

.account-links {
  display: flex;
  flex-wrap: wrap;
  gap: 18rpx;
  margin-top: 24rpx;
}
.account-link {
  width: calc(50% - 9rpx);
  box-sizing: border-box;
  background: #fff;
  border: 2rpx solid #ebe5f1;
  border-radius: 28rpx;
  padding: 28rpx;
}
.link-title {
  display: block;
  font-size: 26rpx;
  font-weight: 700;
  color: #292630;
}
.link-desc {
  display: block;
  font-size: 20rpx;
  color: #a398af;
  margin-top: 8rpx;
}

.panel {
  margin-top: 28rpx;
  background: #fff;
  border: 2rpx solid #e9e3f1;
  border-radius: 30rpx;
  padding: 32rpx;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: #292630;
}
.panel-note {
  font-size: 18rpx;
  color: #b06a6a;
  background: #fbeaea;
  padding: 6rpx 14rpx;
  border-radius: 10rpx;
}
.panel-text {
  display: block;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.7;
  margin: 16rpx 0 8rpx;
}
.textbtn {
  display: inline-block;
  font-size: 24rpx;
  color: #7560df;
  padding: 8rpx 0;
}

.order-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 18rpx 0;
  border-bottom: 2rpx solid #f3eef7;
}
.order-main {
  flex: 1;
}
.order-name {
  display: block;
  font-size: 24rpx;
  font-weight: 700;
}
.order-meta {
  display: block;
  margin-top: 4rpx;
  font-size: 19rpx;
  color: #a398af;
}
.order-amount {
  font-size: 26rpx;
  font-weight: 700;
  color: #7560df;
}

.tool-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22rpx 0;
  border-bottom: 2rpx solid #f3eef7;
}
.tool-row:last-child {
  border-bottom: none;
}
.tool-name {
  font-size: 24rpx;
  color: #292630;
}
.tool-desc {
  font-size: 20rpx;
  color: #a398af;
}

.notice {
  display: block;
  background: #f5f3fa;
  border: 2rpx solid #e9e3f3;
  padding: 26rpx 30rpx;
  border-radius: 24rpx;
  color: #7c728b;
  font-size: 22rpx;
  line-height: 1.7;
}
.mt {
  margin-top: 28rpx;
}

.version {
  display: block;
  text-align: center;
  font-size: 18rpx;
  color: #b6abbd;
  margin-top: 40rpx;
}
</style>
