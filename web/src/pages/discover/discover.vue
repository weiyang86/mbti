<template>
  <view class="page social-page">
    <text class="heading">发现搭子</text>
    <text class="notice">按名片更新时间展示已公开的搭子。是否交换，由双方选择。</text>
    <text v-if="myCard && !myCard.type_code" class="notice">尚未选择名片类型，同型筛选暂不可用。</text>
    <text v-if="myCard && !myCard.discoverable" class="notice">你的名片尚未公开。可以浏览；发起交换前请先到我的名片开启公开与发现。</text>
    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <view class="row">
      <button :class="mode === 'recommend' ? 'btn-primary' : 'btn-secondary'" :disabled="loading" @click="switchMode('recommend')">推荐搭子</button>
      <button :class="mode === 'same' ? 'btn-primary' : 'btn-secondary'" :disabled="loading || !myCard?.type_code" @click="switchMode('same')">同型{{ myCard?.type_code ? ` ${myCard.type_code}` : '（未选择类型）' }}</button>
    </view>
    <button class="btn-secondary mt" :disabled="loading" @click="load">刷新搭子列表</button>
    <text v-if="loading" class="notice">正在读取搭子…</text>
    <text v-if="loaded && !items.length" class="notice">暂时没有符合条件的公开搭子。</text>
    <view v-for="buddy in items" :key="buddy.id" class="card">
      <text class="section">{{ buddy.nickname || '匿名搭子' }} · {{ buddy.type_code }}</text>
      <text class="line">{{ buddy.type_name }}</text>
      <text v-if="buddy.tagline" class="line">{{ buddy.tagline }}</text>
      <view><text v-for="interest in buddy.interests" :key="interest" class="tag">{{ interest }}</text></view>
      <text v-if="buddy.shared_interests.length" class="line">共同兴趣：{{ buddy.shared_interests.join('、') }}</text>
      <text class="notice">{{ exchangeStatusLabel(buddy.exchange_status) }}</text>
      <button class="btn-secondary" @click="openBuddy(buddy.id)">查看搭子详情</button>
    </view>
    <button class="btn-secondary mt" @click="go('/pages/card/card')">我的名片</button>
    <button class="btn-secondary mt" @click="go('/pages/exchanges/exchanges')">我的名片夹</button>
    <button class="btn-secondary mt" @click="go('/pages/buddies/blocked')">屏蔽管理</button>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { getMyCard } from '@/api/cards'
import { listBuddies } from '@/api/buddies'
import type { BuddySummary, MyCard } from '@/api/types-social'
import { exchangeStatusLabel, socialErrorMessage } from '@/utils/social-display'
const myCard = ref<MyCard | null>(null)
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
    const [card, list] = await Promise.all([getMyCard(), listBuddies({ mode: mode.value, limit: 20 })])
    myCard.value = card; items.value = list.items; loaded.value = true
  } catch (e) { error.value = socialErrorMessage(e, '搭子列表读取失败，请重试') }
  finally { loading.value = false }
}
function switchMode(next: 'recommend' | 'same') {
  if (loading.value || (next === 'same' && !myCard.value?.type_code)) return
  mode.value = next; load()
}
function openBuddy(id: string) { go(`/pages/buddies/detail?id=${encodeURIComponent(id)}`) }
function go(url: string) { uni.navigateTo({ url }) }
</script>
<style scoped lang="scss">@import '@/styles/social.scss';</style>
