<template>
  <view class="page social-page request-page">
    <text class="kicker">CONTACT REQUEST / 联系方式</text>
    <text class="page-title">先同意，<text class="hl">再给联系方式。</text></text>
    <text class="page-sub">请求是单向授权。名片交换成功不代表联系授权；对方接受才批准本次完整渠道集合。</text>

    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="actionError" class="error" role="alert">{{ actionError }}</text>
    <text v-if="message" class="success" role="status">{{ message }}</text>
    <text v-if="loading" class="notice">正在读取当前身份的请求…</text>

    <view v-if="buddyId && loaded" class="panel">
      <text class="panel-title">向 {{ displayBuddyName(buddy?.nickname, buddy?.id) }} 申请渠道</text>
      <text v-if="!eligible" class="panel-desc">请先公开自己的合法名片，并由对方本人接受基础名片交换。</text>
      <template v-else>
        <text class="panel-desc">明确选择要读取的对方渠道。对方未提供或当前不可用时，服务端会拒绝申请。</text>
        <view class="channel-row">
          <view
            v-for="channel in contactChannels"
            :key="channel"
            class="channel-chip"
            :class="{ on: selected.includes(channel) }"
            @click="toggle(channel)"
          >{{ selected.includes(channel) ? '已选 ' : '选择 ' }}{{ channelLabel(channel) }}</view>
        </view>
        <text class="panel-desc">本次请求：{{ selected.length ? channelList(selected) : '尚未选择' }}</text>
        <button class="btn-primary mt" :disabled="busy || loading || !selected.length" @click="create">提交所选渠道申请</button>
      </template>
    </view>

    <view v-if="loaded && !items.length" class="panel">
      <text class="panel-title">暂无联系方式请求</text>
      <text class="panel-desc">交换名片后，可以在这里申请或批准特定渠道。</text>
    </view>

    <view v-for="item in items" :key="item.id" class="panel">
      <text class="panel-title">{{ item.direction === 'incoming' ? '收到：对方申请我的渠道' : '发出：申请对方的渠道' }}</text>
      <text class="panel-desc">{{ contactStatusLabel(item.status) }} · 请求渠道：{{ channelList(item.channels) }}</text>
      <text class="panel-desc">对方名片：{{ item.buddy_id }} · {{ item.created_at }}</text>
      <view v-if="canRespondContact(item)" class="row mt">
        <button class="btn-primary" :disabled="busy || loading" @click="respond(item, 'accept')">批准全部所选渠道</button>
        <button class="btn-secondary" :disabled="busy || loading" @click="respond(item, 'decline')">拒绝本次渠道申请</button>
      </view>
      <text v-if="canRespondContact(item)" class="panel-desc">批准仅包含上述渠道；如需更小范围，请拒绝并让对方重新申请。</text>
      <text v-if="item.direction === 'outgoing' && item.status !== 'accepted'" class="panel-desc">尚无可读授权；读取入口会实时检查并明确拒绝。</text>
      <button v-if="item.direction === 'outgoing'" class="btn-secondary mt" :disabled="busy || loading" @click="go(`/pages/contact-request/granted?id=${encodeURIComponent(item.id)}`)">读取当前授权</button>
      <text v-else class="panel-desc">这是本人的渠道，不可通过对方的授权读取入口查看，请进入本人联系方式。</text>
      <button v-if="canRevokeContact(item)" class="btn-secondary mt" :disabled="busy || loading" @click="revoke(item)">{{ item.direction === 'incoming' ? '撤销本次渠道授权或申请' : '撤回本次渠道申请' }}</button>
      <button class="btn-secondary mt" @click="go(`/pages/buddies/detail?id=${encodeURIComponent(item.buddy_id)}`)">查看对方搭子详情</button>
    </view>

    <view class="sk-foot-links">
      <text class="sk-foot-link" @click="load">刷新请求</text>
      <text class="sk-foot-link" @click="go('/pages/contacts/contacts')">本人联系方式</text>
      <text class="sk-foot-link" @click="go('/pages/exchanges/exchanges')">我的名片夹</text>
    </view>
    <text class="sk-foot">MBTI 搭子 · 原创趣味版 · 非官方测评</text>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import { getBuddy } from '@/api/buddies'
import { getMyCard } from '@/api/cards'
import { listCardExchanges } from '@/api/card-exchanges'
import { createContactRequest, listContactRequests, respondContactRequest, revokeContactRequest } from '@/api/contacts'
import type { BuddyDetail, ContactChannel, ContactRequest } from '@/api/types-social'
import { canRespondContact, canRevokeContact, channelLabel, channelList, contactChannels, contactErrorMessage, contactStatusLabel } from '@/utils/contact-display'
import { displayBuddyName } from '@/utils/social-display'
import { createPrivateScope } from '@/utils/private-page'
const buddyId = ref('')
const buddy = ref<BuddyDetail | null>(null)
const eligible = ref(false)
const items = ref<ContactRequest[]>([])
const selected = ref<ContactChannel[]>([])
const loading = ref(false)
const loaded = ref(false)
const busy = ref(false)
const error = ref('')
const actionError = ref('')
const message = ref('')
const scope = createPrivateScope(() => { items.value = []; buddy.value = null; eligible.value = false; loaded.value = false })
onLoad((query) => { buddyId.value = typeof query?.id === 'string' ? query.id : '' })
onShow(() => { scope.enter(); loading.value = false; busy.value = false; actionError.value = ''; message.value = ''; load() })
function leave() { scope.leave(); selected.value = []; loading.value = false; busy.value = false }
onHide(leave)
onUnload(leave)
async function load() {
  if (loading.value) return
  const ticket = scope.begin(); loading.value = true; error.value = ''
  try {
    const list = await listContactRequests(buddyId.value || undefined)
    const context = buddyId.value ? await Promise.all([getBuddy(buddyId.value), listCardExchanges(), getMyCard()]) : null
    if (!scope.current(ticket)) return
    items.value = list.items
    if (context) { buddy.value = context[0]; eligible.value = context[2].discoverable && !!context[2].type_code && context[1].items.some((item) => item.buddy_id === buddyId.value && item.status === 'accepted') }
    loaded.value = true
  } catch (e) { if (scope.current(ticket)) error.value = contactErrorMessage(e, '请求列表读取失败，请重新读取。') }
  finally { if (scope.current(ticket)) loading.value = false }
}
function toggle(channel: ContactChannel) { selected.value = contactChannels.filter((key) => key === channel ? !selected.value.includes(key) : selected.value.includes(key)) }
async function act(operation: () => Promise<unknown>, success: string) {
  if (busy.value || loading.value || !loaded.value) return
  busy.value = true; actionError.value = ''; message.value = ''
  try { await operation(); message.value = success }
  catch (e) { actionError.value = contactErrorMessage(e, '操作失败，请重新读取当前状态。') }
  finally { busy.value = false; await load() }
}
function create() {
  if (!eligible.value || !selected.value.length) return
  const channels = selected.value.slice()
  act(() => createContactRequest({ buddy_id: buddyId.value, channels }), '申请已发送，请等待对方本人回应。')
}
function respond(item: ContactRequest, action: 'accept' | 'decline') {
  if (!canRespondContact(item)) return
  uni.showModal({ title: action === 'accept' ? '批准这些渠道？' : '拒绝本次申请？', content: action === 'accept' ? `仅向本次请求人授权：${channelList(item.channels)}。不会自动获得对方渠道。` : '不会展示任何渠道；对方可重新申请更小范围。', confirmText: action === 'accept' ? '批准' : '拒绝', success: (result) => { if (result.confirm) act(() => respondContactRequest(item.id, action), action === 'accept' ? '已批准本次所选渠道。' : '已拒绝本次申请。') } })
}
function revoke(item: ContactRequest) {
  if (canRevokeContact(item)) act(() => revokeContactRequest(item.id), '本次请求或授权已撤回，不可再读取；无法收回已经复制或截图的内容。')
}
function go(url: string) { uni.navigateTo({ url }) }
</script>
<style scoped lang="scss">
@import '@/styles/social.scss';
@import '@/styles/page-frame.scss';

.request-page {
  padding-bottom: 48rpx;
}

.channel-row {
  display: flex;
  gap: 12rpx;
  margin: 18rpx 0;
}
.channel-chip {
  flex: 1;
  text-align: center;
  padding: 20rpx 6rpx;
  border-radius: 16rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  font-size: 22rpx;
  color: #5c5368;
}
.channel-chip.on {
  background: #efecfd;
  border-color: #6c4cf3;
  color: #5b47a8;
  font-weight: 700;
}
</style>
