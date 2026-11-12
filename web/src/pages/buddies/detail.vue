<template>
  <view class="page social-page buddy-page">
    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="actionError" class="error" role="alert">{{ actionError }}</text>
    <text v-if="loading" class="notice">正在读取名片与交换状态…</text>

    <template v-if="buddy">
      <view class="hero">
        <view class="hero-avatar" :style="{ background: avatarTint(buddy.id).bg }">
          <text class="hero-avatar-text" :style="{ color: avatarTint(buddy.id).fg }">{{ avatarText }}</text>
        </view>
        <text class="hero-name">
          {{ displayBuddyName(buddy.nickname, buddy.id) }}
          <text class="hero-type">{{ buddy.type_code }}</text>
        </text>
        <text class="hero-tagline">{{ buddy.tagline || buddy.type_name }}</text>
        <view v-if="buddy.interests.length" class="hero-tags">
          <text v-for="interest in buddy.interests" :key="interest" class="chip">{{ interest }}</text>
        </view>
      </view>

      <view class="card common-card">
        <text class="common-title">{{ commonTitle }}</text>
        <text class="common-text">{{ commonText }}</text>
        <text class="common-link" @click="goCompat">看看 {{ compatPair }} 的相处小抄 →</text>
      </view>

      <view class="card action-card">
        <text class="action-state">{{ exchangeStatusLabel(exchange?.status || buddy.exchange_status) }}</text>
        <template v-if="exchange">
          <text class="action-dir">{{ exchange.direction === 'incoming' ? '收到的申请' : '发出的申请' }}</text>
          <view v-if="canRespond(exchange)" class="row mt">
            <button class="btn-primary" :disabled="busy || !relationsLoaded" @click="respond('accept')">接受名片交换</button>
            <button class="btn-secondary" :disabled="busy || !relationsLoaded" @click="respond('decline')">拒绝名片交换</button>
          </view>
          <button v-if="canRevoke(exchange)" class="btn-secondary mt" :disabled="busy || !relationsLoaded" @click="revoke">{{ exchange.status === 'accepted' ? '撤回已接受的交换' : '撤回申请' }}</button>
          <text v-if="exchange.status === 'pending' && exchange.direction === 'outgoing'" class="notice">请等待对方本人回应。</text>
        </template>

        <text v-if="myCard && !myCard.discoverable" class="notice">请先公开自己的名片，再发起交换。</text>
        <button v-if="relationsLoaded && (!exchange || ['declined', 'revoked'].includes(exchange.status))" class="btn-primary big mt" :disabled="busy || !myCard?.discoverable" @click="create">免费申请交换名片</button>
        <button v-if="relationsLoaded && exchange?.status === 'accepted'" class="btn-secondary mt" :disabled="busy || loading" @click="go(`/pages/contact-request/contact-request?id=${encodeURIComponent(buddy.id)}`)">申请对方联系方式</button>

        <text class="action-note">只交换公开名片，微信 / QQ / 电话另行授权。接受交换不授予任何联系方式。</text>
      </view>

      <view class="minor-links">
        <text v-if="buddy" class="minor" @click="openPublic">查看公开名片</text>
        <text class="minor" @click="block">屏蔽这位搭子</text>
        <text class="minor" @click="load">刷新</text>
        <text class="minor" @click="go('/pages/exchanges/exchanges')">我的名片夹</text>
      </view>

      <text class="foot">MBTI 搭子 · 原创趣味版 · 非官方测评</text>
    </template>

    <button v-if="!buddy && !loading" class="btn-secondary mt" @click="goTab('/pages/discover/discover')">返回发现搭子</button>
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getBuddy, blockBuddy } from '@/api/buddies'
import { getMyCard } from '@/api/cards'
import { listCardExchanges, createCardExchange, respondCardExchange, revokeCardExchange } from '@/api/card-exchanges'
import type { BuddyDetail, CardExchange, MyCard } from '@/api/types-social'
import { avatarTint, canRespond, canRevoke, displayBuddyName, exchangeStatusLabel, socialErrorMessage } from '@/utils/social-display'
const id = ref('')
const buddy = ref<BuddyDetail | null>(null)
const myCard = ref<MyCard | null>(null)
const exchange = ref<CardExchange | null>(null)
const loading = ref(false)
const busy = ref(false)
const relationsLoaded = ref(false)
const error = ref('')
const actionError = ref('')

const avatarText = computed(() => {
  const item = buddy.value
  if (!item) return ''
  return Array.from(displayBuddyName(item.nickname, item.id))[0] || '搭'
})

const commonTitle = computed(() =>
  buddy.value?.shared_interests.length ? '不同的偏好，也能找到共同点。' : '先看看彼此的类型，再决定要不要认识。',
)

const commonText = computed(() => {
  const item = buddy.value
  if (!item) return ''
  if (item.shared_interests.length) {
    return `你们都选了 ${item.shared_interests.join('、')}，可以作为认识彼此的起点。`
  }
  if (item.compatibility_hint) return item.compatibility_hint
  return `你还没有和 ${displayBuddyName(item.nickname, item.id)} 重合的兴趣标签，可以从类型和自我介绍开始聊。`
})

const compatPair = computed(() => {
  const mine = myCard.value?.type_code
  const other = buddy.value?.type_code
  return mine && other ? `${mine} × ${other}` : other || '彼此'
})

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
function openPublic() {
  if (buddy.value) go(`/pages/card/public?id=${encodeURIComponent(buddy.value.id)}`)
}
function goCompat() {
  const other = buddy.value?.type_code
  go(`/pages/compat/compat${other ? `?other=${encodeURIComponent(other)}` : ''}`)
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
function goTab(url: string) { uni.switchTab({ url, fail: () => uni.reLaunch({ url }) }) }
</script>
<style scoped lang="scss">
@import '@/styles/social.scss';

.buddy-page {
  padding-bottom: 56rpx;
}


.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20rpx 0 8rpx;
}
.hero-avatar {
  width: 148rpx;
  height: 148rpx;
  border-radius: 34rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hero-avatar-text {
  font-size: 64rpx;
  font-weight: 700;
  color: #6b5a4a;
}
.hero-chip {
  margin-top: 18rpx;
  font-size: 18rpx;
  color: #8b78b3;
  background: #f1ecfb;
  border-radius: 999rpx;
  padding: 6rpx 18rpx;
}
.hero-name {
  margin-top: 18rpx;
  font-size: 46rpx;
  font-weight: 800;
  color: #241f2e;
}
.hero-type {
  color: #7560df;
}
.hero-tagline {
  display: block;
  margin-top: 14rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.6;
  text-align: center;
}
.hero-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12rpx;
  margin-top: 20rpx;
}
.chip {
  font-size: 21rpx;
  color: #5b47a8;
  background: #f1ecfb;
  border-radius: 10rpx;
  padding: 8rpx 20rpx;
}

.common-card {
  margin-top: 36rpx;
  padding: 30rpx 26rpx;
}
.common-title {
  display: block;
  font-size: 32rpx;
  font-weight: 800;
  color: #241f2e;
  line-height: 1.5;
}
.common-text {
  display: block;
  margin-top: 14rpx;
  font-size: 23rpx;
  color: #77727e;
  line-height: 1.7;
}
.common-link {
  display: block;
  margin-top: 18rpx;
  font-size: 23rpx;
  color: #7560df;
}

.action-card {
  margin-top: 20rpx;
  padding: 30rpx 26rpx;
}
.action-state {
  display: block;
  font-size: 22rpx;
  color: #7560df;
  font-weight: 700;
}
.action-dir {
  display: block;
  margin-top: 8rpx;
  font-size: 21rpx;
  color: #a398af;
}
.action-note {
  display: block;
  margin-top: 20rpx;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.7;
  text-align: center;
}
.big {
  padding: 30rpx 40rpx;
  font-size: 32rpx;
  font-weight: 700;
}

.minor-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 28rpx;
  margin-top: 32rpx;
}
.minor {
  font-size: 22rpx;
  color: #7560df;
}

.foot {
  display: block;
  margin-top: 40rpx;
  text-align: center;
  font-size: 19rpx;
  color: #b9b3c4;
}
</style>
