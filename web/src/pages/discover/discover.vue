<template>
  <view class="page social-page discover-page">
    <text class="kicker">MEET YOUR TYPE / MBTI 搭子</text>
    <text class="title">先换张名片，</text>
    <text class="title hl">看看合不合拍。</text>
    <text class="sub">推荐依据是自选类型和兴趣。是否交换，由你们双方决定。</text>

    <view class="entry-row">
      <view class="entry" @click="go('/pages/radar/radar')">
        <text class="entry-icon">◎</text>
        <view class="entry-body">
          <text class="entry-title">同型雷达</text>
          <text class="entry-desc">周边人数 · 匿名统计</text>
        </view>
      </view>
      <view class="entry" @click="go('/pages/compat/compat')">
        <text class="entry-icon">✦</text>
        <view class="entry-body">
          <text class="entry-title">相处小抄</text>
          <text class="entry-desc">看看彼此的偏好</text>
        </view>
      </view>
    </view>

    <view class="list-head">
      <view class="tabs">
        <view class="tab" :class="{ on: mode === 'recommend' }" @click="switchMode('recommend')">推荐搭子</view>
        <view class="tab" :class="{ on: mode === 'same', off: !myCard?.type_code }" @click="switchMode('same')">
          同型{{ myType ? ` ${myType}` : '' }}
        </view>
      </view>
      <view class="list-links">
        <text class="link" @click="load">刷新</text>
        <text class="link" @click="go('/pages/exchanges/exchanges')">名片夹</text>
      </view>
    </view>

    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="loading" class="notice">正在读取搭子…</text>
    <text v-if="loaded && !items.length" class="notice">暂时没有符合条件的公开搭子。</text>

    <view v-if="!myType" class="hint" @click="goTab('/pages/card/card')">
      <text>还没有测试类型，同型筛选暂不可用 →</text>
    </view>
    <view v-else-if="myCard && !myCard.discoverable" class="hint" @click="goTab('/pages/card/card')">
      <text>你的名片还未公开，先开启公开与发现 →</text>
    </view>

    <view class="buddy-list">
      <view v-for="buddy in items" :key="buddy.id" class="buddy" @click="openBuddy(buddy.id)">
        <view class="avatar" :style="{ background: avatarTint(buddy.id).bg }">
          <text class="avatar-text" :style="{ color: avatarTint(buddy.id).fg }">{{ avatarText(buddy) }}</text>
        </view>
        <view class="buddy-body">
          <view class="buddy-line">
            <text class="buddy-name">{{ displayBuddyName(buddy.nickname, buddy.id) }}</text>
            <text class="buddy-type">{{ buddy.type_code }}</text>
          </view>
          <text class="buddy-tagline">{{ buddy.tagline || buddy.type_name }}</text>
          <text class="buddy-shared">{{ sharedText(buddy) }}</text>
        </view>
        <text class="buddy-arrow">↗</text>
      </view>
    </view>

    <text class="foot">搭子资料由平台生成，没有聊天、评论或自由发布动态的入口。</text>
    <view class="foot-links">
      <text class="foot-link" @click="goTab('/pages/card/card')">我的名片</text>
      <text class="foot-dot">·</text>
      <text class="foot-link" @click="go('/pages/buddies/blocked')">屏蔽管理</text>
    </view>
    <text class="foot-fine">MBTI 搭子 · 原创趣味版 · 非官方测评</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getMyCard } from '@/api/cards'
import { listResults } from '@/api/results'
import { listBuddies } from '@/api/buddies'
import type { BuddySummary, MyCard } from '@/api/types-social'
import { avatarTint, displayBuddyName, socialErrorMessage } from '@/utils/social-display'
const myCard = ref<MyCard | null>(null)
const myType = ref('')
const items = ref<BuddySummary[]>([])
const mode = ref<'recommend' | 'same'>('recommend')
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
onShow(load)
async function load() {
  if (loading.value) return
  loading.value = true; loaded.value = false; items.value = []; myCard.value = null; error.value = ''
  try {
    const card = await getMyCard()
    myCard.value = card
    let latestType = ''
    try { latestType = (await listResults({ limit: 1 })).items[0]?.type_code || '' } catch { latestType = '' }
    // 同型筛选以最近一次测试结果为准，名片里保存的类型只作兜底
    myType.value = latestType || card.type_code || ''
    const list = mode.value === 'same' && myType.value
      ? await listBuddies({ mode: 'recommend', type_code: myType.value, limit: 20 })
      : await listBuddies({ mode: 'recommend', limit: 20 })
    items.value = list.items; loaded.value = true
  } catch (e) { error.value = socialErrorMessage(e, '搭子列表读取失败，请重试') }
  finally { loading.value = false }
}
function switchMode(next: 'recommend' | 'same') {
  if (loading.value || (next === 'same' && !myType.value)) return
  mode.value = next; load()
}
function avatarText(buddy: BuddySummary) {
  return Array.from(displayBuddyName(buddy.nickname, buddy.id))[0] || '搭'
}
function sharedText(buddy: BuddySummary) {
  if (buddy.shared_interests.length) return `共同兴趣：${buddy.shared_interests.join('、')}`
  return buddy.type_code === myType.value ? '同型搭子' : '不同类型，也可以认识'
}
function openBuddy(id: string) { go(`/pages/buddies/detail?id=${encodeURIComponent(id)}`) }
function go(url: string) { uni.navigateTo({ url }) }
function goTab(url: string) { uni.switchTab({ url, fail: () => uni.reLaunch({ url }) }) }
</script>
<style scoped lang="scss">
@import '@/styles/social.scss';

.discover-page {
  padding-bottom: 56rpx;
}


.kicker {
  display: block;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: #7560df;
  font-weight: 600;
}
.title {
  display: block;
  margin-top: 16rpx;
  font-size: 56rpx;
  font-weight: 800;
  line-height: 1.3;
  color: #241f2e;
}
.hl {
  color: #7560df;
  margin-top: 0;
}
.sub {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.7;
}

.entry-row {
  display: flex;
  gap: 16rpx;
  margin-top: 30rpx;
}
.entry {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 24rpx 20rpx;
  border-radius: 24rpx;
  background: #f1ecfb;
}
.entry-icon {
  font-size: 30rpx;
  color: #7560df;
}
.entry-title {
  display: block;
  font-size: 24rpx;
  font-weight: 700;
  color: #2c2550;
}
.entry-desc {
  display: block;
  margin-top: 4rpx;
  font-size: 19rpx;
  color: #8b8099;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  margin-top: 36rpx;
}
.tabs {
  display: flex;
  gap: 12rpx;
}
.tab {
  padding: 14rpx 26rpx;
  border-radius: 999rpx;
  background: #ece8f3;
  color: #6f6880;
  font-size: 22rpx;
}
.tab.on {
  background: #6c4cf3;
  color: #fff;
  font-weight: 700;
}
.tab.off {
  opacity: 0.5;
}
.list-links {
  display: flex;
  gap: 18rpx;
}
.link {
  font-size: 22rpx;
  color: #7560df;
}

.hint {
  margin-top: 20rpx;
  padding: 18rpx 22rpx;
  border-radius: 18rpx;
  background: #f1ecfb;
  font-size: 21rpx;
  color: #5b47a8;
}

.buddy-list {
  margin-top: 24rpx;
}
.buddy {
  display: flex;
  align-items: flex-start;
  gap: 20rpx;
  margin-top: 16rpx;
  padding: 26rpx 24rpx;
  border-radius: 26rpx;
  background: #fff;
  box-shadow: 0 12rpx 32rpx rgba(49, 33, 77, 0.05);
}
.avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 22rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.avatar-text {
  font-size: 36rpx;
  font-weight: 700;
  color: #6b5a4a;
}
.buddy-body {
  flex: 1;
  min-width: 0;
}
.buddy-line {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.buddy-name {
  font-size: 28rpx;
  font-weight: 800;
  color: #241f2e;
}
.buddy-type {
  font-size: 18rpx;
  font-weight: 700;
  color: #7560df;
  background: #f1ecfb;
  border-radius: 8rpx;
  padding: 4rpx 10rpx;
}
.buddy-tagline {
  display: block;
  margin-top: 10rpx;
  font-size: 23rpx;
  color: #3f3552;
  line-height: 1.6;
}
.buddy-shared {
  display: block;
  margin-top: 8rpx;
  font-size: 19rpx;
  color: #a398af;
}
.buddy-arrow {
  font-size: 26rpx;
  color: #b9a4da;
}

.foot {
  display: block;
  margin-top: 40rpx;
  text-align: center;
  font-size: 19rpx;
  color: #a398af;
  line-height: 1.7;
}
.foot-links {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12rpx;
  margin-top: 16rpx;
}
.foot-link {
  font-size: 21rpx;
  color: #7560df;
}
.foot-dot {
  font-size: 21rpx;
  color: #c9c3d4;
}
.foot-fine {
  display: block;
  margin-top: 12rpx;
  text-align: center;
  font-size: 19rpx;
  color: #b9b3c4;
}
</style>
