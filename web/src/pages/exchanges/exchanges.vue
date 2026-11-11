<template>
  <view class="page social-page wallet-page">
    <text class="kicker">CARD WALLET / 名片夹</text>
    <text class="page-title">每次交换，<text class="hl">都由双方选择。</text></text>
    <text class="page-sub">名片交换与联系方式交换是两次独立授权。</text>

    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="actionError" class="error" role="alert">{{ actionError }}</text>
    <text v-if="loading" class="notice">正在读取收发记录…</text>

    <view v-if="loaded && !items.length" class="empty">
      <text class="kicker plain">MBTI BUDDY</text>
      <text class="empty-title">名片夹还空着</text>
      <text class="empty-desc">先向喜欢的示例搭子发出一张名片。</text>
      <view class="btn-primary mt" @click="go('/pages/discover/discover')">去发现搭子</view>
    </view>

    <view v-for="item in items" :key="item.id" class="panel swap">
      <view class="swap-head">
        <text class="swap-name">{{ displayBuddyName(item.buddy.nickname, item.buddy.id) }}</text>
        <text class="swap-type">{{ item.buddy.type_code }}</text>
      </view>
      <text class="swap-state">{{ item.direction === 'incoming' ? '收到的申请' : '发出的申请' }} · {{ exchangeStatusLabel(item.status) }}</text>
      <text v-if="item.buddy.tagline" class="swap-tag">{{ item.buddy.tagline }}</text>
      <view v-if="item.buddy.interests.length" class="swap-tags">
        <text v-for="interest in item.buddy.interests" :key="interest" class="tag">{{ interest }}</text>
      </view>
      <text class="swap-time">创建时间：{{ item.created_at }}</text>
      <view v-if="canRespond(item)" class="row mt">
        <button class="btn-primary" :disabled="busy || loading" @click="respond(item, 'accept')">接受名片交换</button>
        <button class="btn-secondary" :disabled="busy || loading" @click="respond(item, 'decline')">拒绝名片交换</button>
      </view>
      <button v-if="canRevoke(item)" class="btn-secondary mt" :disabled="busy || loading" @click="revoke(item)">{{ item.status === 'accepted' ? '撤回已接受的交换' : '撤回申请' }}</button>
      <button class="btn-secondary mt" @click="go(`/pages/buddies/detail?id=${encodeURIComponent(item.buddy_id)}`)">查看搭子详情</button>
      <button v-if="item.status === 'accepted'" class="btn-secondary mt" :disabled="busy || loading" @click="go(`/pages/contact-request/contact-request?id=${encodeURIComponent(item.buddy_id)}`)">申请对方联系方式</button>
    </view>

    <view class="sk-foot-links">
      <text class="sk-foot-link" @click="load">刷新名片夹</text>
      <text class="sk-foot-link" @click="go('/pages/contact-request/contact-request')">联系方式请求</text>
    </view>
    <text class="sk-foot">MBTI 搭子 · 原创趣味版 · 非官方测评</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { listCardExchanges, respondCardExchange, revokeCardExchange } from '@/api/card-exchanges'
import type { CardExchange } from '@/api/types-social'
import { canRespond, canRevoke, displayBuddyName, exchangeStatusLabel, socialErrorMessage } from '@/utils/social-display'
const items = ref<CardExchange[]>([])
const loading = ref(false)
const loaded = ref(false)
const busy = ref(false)
const error = ref('')
const actionError = ref('')
onShow(() => { actionError.value = ''; load() })
async function load() {
  if (loading.value) return
  loading.value = true; loaded.value = false; items.value = []; error.value = ''
  try { items.value = (await listCardExchanges()).items; loaded.value = true }
  catch (e) { error.value = socialErrorMessage(e, '名片夹读取失败，请重试') }
  finally { loading.value = false }
}
async function act(operation: () => Promise<unknown>) {
  if (busy.value || loading.value) return
  busy.value = true; actionError.value = ''
  try { await operation(); await load() }
  catch (e) { actionError.value = socialErrorMessage(e, '操作失败，请重试'); await load() }
  finally { busy.value = false }
}
function respond(item: CardExchange, action: 'accept' | 'decline') { if (canRespond(item)) act(() => respondCardExchange(item.id, action)) }
function revoke(item: CardExchange) { if (canRevoke(item)) act(() => revokeCardExchange(item.id)) }
function go(url: string) { uni.navigateTo({ url }) }
</script>
<style scoped lang="scss">
@import '@/styles/social.scss';
@import '@/styles/page-frame.scss';

.wallet-page {
  padding-bottom: 48rpx;
}

.empty {
  margin-top: 40rpx;
}
.empty-title {
  display: block;
  margin-top: 18rpx;
  font-size: 48rpx;
  font-weight: 800;
  color: #241f2e;
}
.empty-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 23rpx;
  color: #77727e;
  line-height: 1.7;
}

.swap-head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.swap-name {
  font-size: 30rpx;
  font-weight: 800;
  color: #241f2e;
}
.swap-type {
  font-size: 18rpx;
  font-weight: 700;
  color: #6c4cf3;
  background: #f1ecfb;
  border-radius: 8rpx;
  padding: 4rpx 10rpx;
}
.swap-state {
  display: block;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #8b78b3;
}
.swap-tag {
  display: block;
  margin-top: 10rpx;
  font-size: 23rpx;
  color: #3f3552;
  line-height: 1.6;
}
.swap-tags {
  margin-top: 4rpx;
}
.swap-time {
  display: block;
  margin-top: 14rpx;
  font-size: 19rpx;
  color: #a398af;
}
</style>
