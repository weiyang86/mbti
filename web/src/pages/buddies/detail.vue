<template>
  <view class="page">
    <proto-nav />
    <DemoStrip />

    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="actionError" class="error" role="alert">{{ actionError }}</text>
    <view v-if="loading" class="notice">正在读取名片与交换状态…</view>

    <template v-if="buddy">
      <view class="buddy-profile">
        <view class="buddy-avatar large" :style="{ background: avatarTint(buddy.id).bg }">
          <text>{{ avatarText }}</text>
        </view>
        <text class="tag">虚构成年人资料</text>
        <view class="h1">
          {{ displayBuddyName(buddy.nickname, buddy.id) }}
          <text class="em">{{ buddy.type_code }}</text>
        </view>
        <view class="p">{{ buddy.tagline || buddy.type_name }}</view>
        <view v-if="buddy.interests.length" class="profile-tags">
          <text v-for="interest in buddy.interests" :key="interest" class="tag">{{ interest }}</text>
        </view>
      </view>

      <view class="panel">
        <view class="h3">{{ commonTitle }}</view>
        <view class="p">{{ commonText }}</view>
        <button class="textbtn" @click="goCompat">看看 {{ compatPair }} 的相处小抄</button>
      </view>

      <view class="panel">
        <template v-if="status === 'accepted'">
          <view class="notice green">✓ 已互换基础名片（模拟）</view>
          <button class="btn full mt" @click="openContactRequest">申请交换联系方式</button>
          <button
            v-if="canRevokeCurrent"
            class="textbtn full mt"
            :disabled="busy || !relationsLoaded"
            @click="revoke"
          >撤销名片交换</button>
        </template>

        <template v-else-if="status === 'pending'">
          <view class="notice">名片申请待回应，当前看不到任何联系方式。</view>
          <view v-if="canRespondCurrent" class="demo-reply">
            <text class="span">仅供演示：模拟对方操作</text>
            <view>
              <button class="btn secondary small" :disabled="busy || !relationsLoaded" @click="respond('accept')">模拟对方同意</button>
              <button class="btn ghost small" :disabled="busy || !relationsLoaded" @click="respond('decline')">模拟对方拒绝</button>
            </view>
          </view>
          <view v-else class="notice mt">请等待对方本人回应。</view>
          <button
            v-if="canRevokeCurrent"
            class="textbtn full"
            :disabled="busy || !relationsLoaded"
            @click="revoke"
          >取消申请</button>
        </template>

        <template v-else>
          <view v-if="status === 'declined'" class="fine">对方已拒绝这次模拟申请，暂不重复发送。</view>
          <view v-if="myCard && !myCard.discoverable" class="notice">请先公开自己的名片，再发起交换。</view>
          <button
            v-if="relationsLoaded && (!exchange || ['declined', 'revoked'].includes(exchange.status))"
            class="btn full mt"
            :disabled="busy || !myCard?.discoverable"
            @click="create"
          >免费申请交换名片</button>
          <view class="fine centered mt">只交换公开名片，微信 / QQ / 电话另行授权。</view>
        </template>
      </view>

      <view class="btnrow mt">
        <button class="textbtn" @click="reportDemo">举报示例资料</button>
        <button class="textbtn" :disabled="busy" @click="block">屏蔽这位搭子</button>
        <button class="textbtn" @click="openPublic">查看公开名片</button>
      </view>
    </template>

    <view v-if="!buddy && !loading" class="page-intro">
      <view class="eyebrow">MBTI BUDDY</view>
      <view class="h1">这张名片当前不可查看</view>
      <view class="p">返回推荐页看看其他示例搭子。</view>
    </view>
    <button v-if="!buddy && !loading" class="btn full mt" @click="goTab('/pages/discover/discover')">返回换名片</button>
  <proto-footer />
  </view>
</template>
<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getBuddy, blockBuddy } from '@/api/buddies'
import { getMyCard } from '@/api/cards'
import { listCardExchanges, createCardExchange, respondCardExchange, revokeCardExchange } from '@/api/card-exchanges'
import type { BuddyDetail, CardExchange, MyCard } from '@/api/types-social'
import { avatarTint, canRespond, canRevoke, displayBuddyName, socialErrorMessage } from '@/utils/social-display'
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

const status = computed(() => exchange.value?.status || buddy.value?.exchange_status || 'none')
const canRespondCurrent = computed(() => !!exchange.value && canRespond(exchange.value))
const canRevokeCurrent = computed(() => !!exchange.value && canRevoke(exchange.value))

const commonTitle = computed(() => {
  const item = buddy.value
  if (!item) return ''
  return item.type_code === myCard.value?.type_code ? '同型，也有不同的相处方式。' : '不同的偏好，也能找到共同点。'
})

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
function openContactRequest() {
  if (!buddy.value) return
  go(`/pages/contact-request/contact-request?id=${encodeURIComponent(buddy.value.id)}`)
}
function openPublic() {
  if (buddy.value) go(`/pages/card/public?id=${encodeURIComponent(buddy.value.id)}`)
}
function goCompat() {
  const other = buddy.value?.type_code
  go(`/pages/compat/compat${other ? `?other=${encodeURIComponent(other)}` : ''}`)
}
function reportDemo() { uni.showToast({ title: '演示模式，举报入口仅作展示', icon: 'none' }) }
function toastDemo() { uni.showToast({ title: '演示模式，未产生真实操作', icon: 'none' }) }
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
.error {
  display: block;
  margin: 12px 0;
  font-size: 12px;
  line-height: 1.7;
  color: #a43b3b;
}
.profile-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  margin-top: 14px;
}
.buddy-profile .h1 .em {
  font-size: 20px;
  color: #9470b3;
  font-style: normal;
}
.panel .h3 {
  font-weight: 700;
}
.fine {
  margin-bottom: 10px;
}
.demo-reply > .span {
  display: block;
  margin-bottom: 9px;
  font-size: 10px;
  color: #aa95bc;
}
.demo-reply > view {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.btn::after,
.textbtn::after {
  border: 0;
}
.demo-strip .textbtn {
  font-size: 9px;
  color: #a197ad;
}
.btnrow > .textbtn {
  margin: 0;
}
.panel > .textbtn:not(.full) {
  display: inline-flex;
  width: auto;
  margin: 0;
  text-align: left;
}
.demo-reply .btn {
  margin: 0;
}
</style>
