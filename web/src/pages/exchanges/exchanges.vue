<template>
  <view class="page social-page">
    <text class="heading">我的名片夹</text>
    <text class="notice">显示当前身份的收发记录。名片关系不会授予联系方式，请另行申请并由对方本人批准。</text>
    <button class="btn-secondary mt" @click="go('/pages/contact-request/contact-request')">联系方式请求</button>
    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="actionError" class="error" role="alert">{{ actionError }}</text>
    <button class="btn-secondary" :disabled="loading || busy" @click="load">刷新名片夹</button>
    <text v-if="loading" class="notice">正在读取收发记录…</text>
    <text v-if="loaded && !items.length" class="notice">暂无可见的名片交换记录。</text>
    <view v-for="item in items" :key="item.id" class="card">
      <text class="section">{{ item.buddy.nickname || '匿名搭子' }} · {{ item.buddy.type_code }}</text>
      <text class="line">{{ item.direction === 'incoming' ? '收到的申请' : '发出的申请' }} · {{ exchangeStatusLabel(item.status) }}</text>
      <text v-if="item.buddy.tagline" class="line">{{ item.buddy.tagline }}</text>
      <view><text v-for="interest in item.buddy.interests" :key="interest" class="tag">{{ interest }}</text></view>
      <text class="notice">创建时间：{{ item.created_at }}</text>
      <view v-if="canRespond(item)" class="row mt">
        <button class="btn-primary" :disabled="busy || loading" @click="respond(item, 'accept')">接受名片交换</button>
        <button class="btn-secondary" :disabled="busy || loading" @click="respond(item, 'decline')">拒绝名片交换</button>
      </view>
      <button v-if="canRevoke(item)" class="btn-secondary mt" :disabled="busy || loading" @click="revoke(item)">{{ item.status === 'accepted' ? '撤回已接受的交换' : '撤回申请' }}</button>
      <button class="btn-secondary mt" @click="go(`/pages/buddies/detail?id=${encodeURIComponent(item.buddy_id)}`)">查看搭子详情</button>
      <button v-if="item.status === 'accepted'" class="btn-secondary mt" :disabled="busy || loading" @click="go(`/pages/contact-request/contact-request?id=${encodeURIComponent(item.buddy_id)}`)">申请对方联系方式</button>
    </view>
    <button class="btn-secondary mt" @click="go('/pages/discover/discover')">发现搭子</button>
    <button class="btn-secondary mt" @click="go('/pages/card/card')">我的名片</button>
    <button class="btn-secondary mt" @click="go('/pages/buddies/blocked')">屏蔽管理</button>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { listCardExchanges, respondCardExchange, revokeCardExchange } from '@/api/card-exchanges'
import type { CardExchange } from '@/api/types-social'
import { canRespond, canRevoke, exchangeStatusLabel, socialErrorMessage } from '@/utils/social-display'
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
<style scoped lang="scss">@import '@/styles/social.scss';</style>
