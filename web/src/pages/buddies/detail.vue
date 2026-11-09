<template>
  <view class="page social-page">
    <text class="heading">搭子详情</text>
    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="actionError" class="error" role="alert">{{ actionError }}</text>
    <button class="btn-secondary" :disabled="loading || busy" @click="load">刷新搭子与关系</button>
    <text v-if="loading" class="notice">正在读取名片与交换状态…</text>
    <template v-if="buddy">
      <view class="card">
        <text class="type-code">{{ buddy.type_code }}</text>
        <text class="section">{{ buddy.nickname || '匿名搭子' }} · {{ buddy.type_name }}</text>
        <text v-if="buddy.tagline" class="line">{{ buddy.tagline }}</text>
        <view><text v-for="interest in buddy.interests" :key="interest" class="tag">{{ interest }}</text></view>
        <text v-if="buddy.shared_interests.length" class="line">共同兴趣：{{ buddy.shared_interests.join('、') }}</text>
        <text v-if="buddy.compatibility_hint" class="notice">{{ buddy.compatibility_hint }}</text>
        <button class="btn-secondary mt" @click="go(`/pages/card/public?id=${encodeURIComponent(buddy.id)}`)">查看公开名片</button>
      </view>
      <view class="card">
        <text class="section">{{ exchangeStatusLabel(exchange?.status || buddy.exchange_status) }}</text>
        <template v-if="exchange">
          <text class="line">{{ exchange.direction === 'incoming' ? '收到的申请' : '发出的申请' }}</text>
          <view v-if="canRespond(exchange)" class="row mt">
            <button class="btn-primary" :disabled="busy || !relationsLoaded" @click="respond('accept')">接受名片交换</button>
            <button class="btn-secondary" :disabled="busy || !relationsLoaded" @click="respond('decline')">拒绝名片交换</button>
          </view>
          <button v-if="canRevoke(exchange)" class="btn-secondary mt" :disabled="busy || !relationsLoaded" @click="revoke">{{ exchange.status === 'accepted' ? '撤回已接受的交换' : '撤回申请' }}</button>
          <text v-if="exchange.status === 'pending' && exchange.direction === 'outgoing'" class="notice">请等待对方本人回应。</text>
        </template>
        <text v-if="myCard && !myCard.discoverable" class="notice">请先公开自己的名片，再发起交换。</text>
        <button v-if="relationsLoaded && (!exchange || ['declined', 'revoked'].includes(exchange.status))" class="btn-primary mt" :disabled="busy || !myCard?.discoverable" @click="create">申请交换名片</button>
        <text class="notice">接受交换只确认名片关系，不授予任何联系方式。联系方式功能尚未开放。</text>
      </view>
      <button class="btn-secondary mt" :disabled="busy" @click="block">屏蔽这位搭子</button>
    </template>
    <button class="btn-secondary mt" @click="go('/pages/discover/discover')">返回发现搭子</button>
    <button class="btn-secondary mt" @click="go('/pages/exchanges/exchanges')">我的名片夹</button>
    <button class="btn-secondary mt" @click="go('/pages/buddies/blocked')">屏蔽管理</button>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getBuddy, blockBuddy } from '@/api/buddies'
import { getMyCard } from '@/api/cards'
import { listCardExchanges, createCardExchange, respondCardExchange, revokeCardExchange } from '@/api/card-exchanges'
import type { BuddyDetail, CardExchange, MyCard } from '@/api/types-social'
import { canRespond, canRevoke, exchangeStatusLabel, socialErrorMessage } from '@/utils/social-display'
const id = ref('')
const buddy = ref<BuddyDetail | null>(null)
const myCard = ref<MyCard | null>(null)
const exchange = ref<CardExchange | null>(null)
const loading = ref(false)
const busy = ref(false)
const relationsLoaded = ref(false)
const error = ref('')
const actionError = ref('')
onLoad((query) => { id.value = typeof query?.id === 'string' ? query.id : '' })
onShow(() => { actionError.value = ''; load() })
async function load() {
  if (loading.value) return
  loading.value = true; buddy.value = null; exchange.value = null; myCard.value = null; relationsLoaded.value = false; error.value = ''
  if (!id.value) { error.value = '缺少搭子编号，请从发现或名片夹进入'; loading.value = false; return }
  try {
    const [detail, list, card] = await Promise.all([getBuddy(id.value), listCardExchanges(), getMyCard()])
    buddy.value = detail; myCard.value = card
    exchange.value = list.items.find((item) => item.buddy_id === id.value) || null
    relationsLoaded.value = true
  } catch (e) { error.value = socialErrorMessage(e, '搭子或关系读取失败，请重试') }
  finally { loading.value = false }
}
async function act(operation: () => Promise<unknown>) {
  if (busy.value || loading.value) return
  busy.value = true; actionError.value = ''
  try { await operation(); await load() }
  catch (e) { actionError.value = socialErrorMessage(e, '操作失败，请重试'); await load() }
  finally { busy.value = false }
}
function create() { if (buddy.value && relationsLoaded.value && myCard.value?.discoverable) act(() => createCardExchange({ buddy_id: id.value })) }
function respond(action: 'accept' | 'decline') {
  const item = exchange.value
  if (item && canRespond(item) && relationsLoaded.value) act(() => respondCardExchange(item.id, action))
}
function revoke() {
  const item = exchange.value
  if (item && canRevoke(item) && relationsLoaded.value) act(() => revokeCardExchange(item.id))
}
function block() {
  if (busy.value || !buddy.value) return
  uni.showModal({ title: '屏蔽这位搭子？', content: '双方将无法查看彼此的公开名片；待回应或已接受的交换会撤回，解除屏蔽不会恢复旧关系。', confirmText: '屏蔽', success: async (response) => {
    if (!response.confirm || busy.value) return
    busy.value = true; actionError.value = ''
    try { await blockBuddy(id.value); buddy.value = null; exchange.value = null; uni.redirectTo({ url: '/pages/buddies/blocked' }) }
    catch (e) { actionError.value = socialErrorMessage(e, '屏蔽失败，请重试'); await load() }
    finally { busy.value = false }
  } })
}
function go(url: string) { uni.navigateTo({ url }) }
</script>
<style scoped lang="scss">@import '@/styles/social.scss';</style>
