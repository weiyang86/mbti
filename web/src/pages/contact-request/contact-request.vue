<template>
  <view class="page">
    <proto-nav />
    <view v-if="!emptyState" class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="textbtn" @click="demoState">演示状态 ↗</text>
    </view>

    <view v-if="!emptyState" class="page-intro">
      <view class="eyebrow">MUTUAL CONSENT / 双向确认</view>
      <view class="h1">{{ pageTitle }}</view>
      <view class="p">公开名片不含联系方式；购买套装也不会自动获得他人联系方式。</view>
    </view>

    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="actionError" class="error" role="alert">{{ actionError }}</text>
    <text v-if="message" class="success" role="status">{{ message }}</text>
    <text v-if="loading" class="notice" role="status">正在读取当前身份的请求…</text>

    <template v-if="emptyState">
      <view class="page-intro">
        <view class="eyebrow">MBTI BUDDY</view>
        <view class="h1">先互换名片，再决定联系方式</view>
        <view class="p">双方同意交换基础名片后，才开放联系方式申请。</view>
      </view>
      <button class="btn full" @click="goDiscover">去换名片</button>
    </template>

    <template v-else-if="buddyId && loaded">
      <template v-if="currentRequest && currentRequest.status === 'accepted'">
        <view class="notice green">双方已确认（模拟） · 仅授权本次所选渠道</view>
        <view class="contact-granted">
          <view v-for="channel in activeChannels" :key="channel">
            <text class="span">对方的{{ channelLabel(channel) }}</text>
            <text class="b">已获授权 · 读取时实时验证</text>
            <button class="btn secondary small" @click="readGranted(currentRequest)">读取当前授权</button>
          </view>
        </view>
        <view class="fine">联系方式不会留在本页；读取入口每次打开都会重新验证授权是否仍有效。</view>
        <button class="btn ghost full" @click="revoke(currentRequest)">撤销本次联系方式授权</button>
      </template>

      <template v-else-if="currentRequest && currentRequest.status === 'pending'">
        <view class="notice">
          <text v-if="currentRequest.direction === 'incoming'">
            对方申请你的 {{ channelList(currentRequest.channels) }}，请确认是否授权。
          </text>
          <text v-else>等待 {{ buddyName }} 确认，双方目前都看不到对方的联系方式。</text>
        </view>
        <view class="fine mt">本次愿意交换：{{ channelList(currentRequest.channels) }}</view>
        <view v-if="currentRequest.direction === 'incoming'" class="demo-reply">
          <view class="span">仅供演示：模拟本人操作</view>
          <view>
            <button class="btn secondary" @click="respond(currentRequest, 'accept')">同意交换</button>
            <button class="btn ghost" @click="respond(currentRequest, 'decline')">拒绝</button>
          </view>
        </view>
        <button class="textbtn full" @click="revoke(currentRequest)">
          {{ currentRequest.direction === 'incoming' ? '撤销本次渠道授权或申请' : '取消本次申请' }}
        </button>
      </template>

      <template v-else>
        <view v-if="currentRequest && currentRequest.status === 'declined'" class="notice">
          对方已拒绝本次模拟申请，联系方式未展示。
        </view>
        <view v-if="currentRequest && currentRequest.status === 'revoked'" class="notice">
          本次申请已撤回或失效，可重新选择渠道发起申请。
        </view>

        <view class="contact-choices">
          <view
            v-for="channel in contactChannels"
            :key="channel"
            class="label"
            @click="toggle(channel)"
          >
            <checkbox class="contact-check" :checked="selected.includes(channel)" color="#6c4cf3" />
            <view class="choice-text">
              <text class="b">{{ channelLabel(channel) }}</text>
              <text class="small">{{ selected.includes(channel) ? '已选入本次申请' : '点此选择该渠道' }}</text>
            </view>
          </view>
        </view>

        <view class="tickline mt" @click="consent = !consent">
          <checkbox class="contact-check" :checked="consent" color="#6c4cf3" />
          <text>我愿意仅向 {{ buddyName }} 申请本次勾选的联系方式；对方也需确认后才展示。</text>
        </view>

        <button class="btn full mt" :disabled="busy || loading || !selected.length" @click="create">
          {{ busy ? '正在提交…' : '提交本次交换申请（模拟）' }}
        </button>
      </template>
    </template>

    <template v-if="!emptyState && !buddyId">
      <view v-if="loaded && !items.length" class="notice">暂无联系方式请求。交换名片后，可以在这里申请或批准特定渠道。</view>

      <view v-for="item in otherItems" :key="item.id" class="panel">
      <view class="request-head">
        <text class="b">{{ item.direction === 'incoming' ? '收到：对方申请我的渠道' : '发出：申请对方的渠道' }}</text>
        <text class="tag">{{ contactStatusLabel(item.status) }}</text>
      </view>
      <view class="p">请求渠道：{{ channelList(item.channels) }}</view>
      <view class="p">对方名片：{{ item.buddy_id }} · {{ item.created_at }}</view>
      <view v-if="canRespondContact(item)" class="btnrow mt">
        <button class="btn secondary small" :disabled="busy || loading" @click="respond(item, 'accept')">批准全部所选渠道</button>
        <button class="btn ghost small" :disabled="busy || loading" @click="respond(item, 'decline')">拒绝本次渠道申请</button>
      </view>
      <view v-if="canRespondContact(item)" class="fine">批准仅包含上述渠道；如需更小范围，请拒绝并让对方重新申请。</view>
      <view v-if="item.direction === 'outgoing' && item.status !== 'accepted'" class="fine">
        尚无可读授权；读取入口会实时检查并明确拒绝。
      </view>
      <button
        v-if="item.direction === 'outgoing'"
        class="btn secondary small mt"
        :disabled="busy || loading"
        @click="readGranted(item)"
      >读取当前授权</button>
      <view v-else class="fine">这是本人的渠道，不可通过对方的授权读取入口查看，请进入本人联系方式。</view>
      <button
        v-if="canRevokeContact(item)"
        class="btn ghost small mt"
        :disabled="busy || loading"
        @click="revoke(item)"
      >{{ item.direction === 'incoming' ? '撤销本次渠道授权或申请' : '撤回本次渠道申请' }}</button>
      <button
        class="btn ghost small mt"
        @click="go(`/pages/buddies/detail?id=${encodeURIComponent(item.buddy_id)}`)"
      >查看对方搭子详情</button>
    </view>
    </template>

    <view v-if="!emptyState" class="fine mt">
      本次授权仅存在当前页面会话；刷新后需重新填写与确认。撤销后应用停止展示，无法撤回已经复制的内容。
    </view>
  <proto-footer />
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
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
const consent = ref(false)
const loading = ref(false)
const loaded = ref(false)
const busy = ref(false)
const error = ref('')
const actionError = ref('')
const message = ref('')
const scope = createPrivateScope(() => { items.value = []; buddy.value = null; eligible.value = false; loaded.value = false })
onLoad((query) => { buddyId.value = typeof query?.id === 'string' ? query.id : '' })
onShow(() => { scope.enter(); loading.value = false; busy.value = false; actionError.value = ''; message.value = ''; load() })
function leave() { scope.leave(); selected.value = []; consent.value = false; loading.value = false; busy.value = false }
onHide(leave)
onUnload(leave)
const buddyName = computed(() => (buddy.value ? displayBuddyName(buddy.value.nickname, buddy.value.id) : '对方'))
const pageTitle = computed(() => (buddyId.value && buddy.value ? `和 ${buddyName.value} 交换联系方式` : '先同意，再给联系方式。'))
/** 指定搭子但尚未互换名片（或列表为空）时，与原型一致只展示空态引导 */
const emptyState = computed(() => {
  if (!loaded.value || eligible.value) return false
  return buddyId.value ? true : !items.value.length
})
const currentRequest = computed(() => (buddyId.value ? items.value.find((item) => item.buddy_id === buddyId.value) || null : null))
const activeChannels = computed(() => (currentRequest.value ? currentRequest.value.channels : []))
/** 当前搭子的请求已在页面上方按原型流程展示时，避免在列表里重复出现 */
const otherItems = computed(() => {
  const flow = buddyId.value && eligible.value && currentRequest.value
  return flow ? items.value.filter((item) => item.buddy_id !== buddyId.value) : items.value
})
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
  act(async () => { await createContactRequest({ buddy_id: buddyId.value, channels }); consent.value = false; selected.value = [] }, '申请已发送，请等待对方本人回应。')
}
function respond(item: ContactRequest, action: 'accept' | 'decline') {
  if (!canRespondContact(item)) return
  uni.showModal({ title: action === 'accept' ? '批准这些渠道？' : '拒绝本次申请？', content: action === 'accept' ? `仅向本次请求人授权：${channelList(item.channels)}。不会自动获得对方渠道。` : '不会展示任何渠道；对方可重新申请更小范围。', confirmText: action === 'accept' ? '批准' : '拒绝', success: (result) => { if (result.confirm) act(() => respondContactRequest(item.id, action), action === 'accept' ? '已批准本次所选渠道。' : '已拒绝本次申请。') } })
}
function revoke(item: ContactRequest) {
  if (canRevokeContact(item)) act(() => revokeContactRequest(item.id), '本次请求或授权已撤回，不可再读取；无法收回已经复制或截图的内容。')
}
function readGranted(item: ContactRequest) { go(`/pages/contact-request/granted?id=${encodeURIComponent(item.id)}`) }
function demoState() { uni.showToast({ title: '演示模式，未产生真实操作', icon: 'none' }) }
function goDiscover() { uni.switchTab({ url: '/pages/discover/discover', fail: () => uni.reLaunch({ url: '/pages/discover/discover' }) }) }
function go(url: string) { uni.navigateTo({ url }) }
</script>
<style scoped lang="scss">
.error {
  display: block;
  margin: 12px 0;
  font-size: 12px;
  line-height: 1.7;
  color: #a43b3b;
}
.success {
  display: block;
  margin: 12px 0;
  font-size: 12px;
  line-height: 1.7;
  color: #286747;
}
.contact-check {
  transform: none;
  margin: 0 3px 0 4px;
}
.contact-check :deep(.uni-checkbox-input) {
  width: 20px;
  height: 20px;
  margin-right: 0;
}
.tickline .contact-check {
  margin-top: 4px;
}
.tickline .contact-check :deep(.uni-checkbox-input) {
  width: 15px;
  height: 15px;
}
.contact-granted > view {
  border: 1px solid #ddd4e6;
  background: white;
  border-radius: 14px;
  padding: 18px;
}
.fine {
  margin-bottom: 10px;
}
.choice-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.textbtn.full {
  display: block;
  width: 100%;
  margin-top: 0;
}
.demo-reply > view {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.demo-reply .btn {
  width: auto;
}
.request-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.btn::after,
.textbtn::after {
  border: 0;
}
</style>
