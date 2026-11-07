<template>
  <view class="page request-page">
    <view v-if="loading" class="state"><text class="state-text">正在读取交换状态…</text></view>

    <view v-else-if="loadError" class="state">
      <text class="state-text">交换状态读取失败</text>
      <text class="state-sub">请检查网络后重试。</text>
      <view class="btn-secondary mt" @click="load">重试</view>
    </view>

    <view v-else-if="!buddy || !cardAccepted" class="state">
      <text class="state-text">先互换名片，再决定联系方式</text>
      <text class="state-sub">双方同意交换基础名片后，才开放联系方式申请。</text>
      <view class="btn-primary mt" @click="goDiscover">去换名片</view>
    </view>

    <view v-else>
      <view class="demo-strip">
        <text>V0.4 · Mock 演示 · 不产生费用</text>
        <text class="demo-link" @click="showDemo">演示状态 ↗</text>
      </view>

      <text class="kicker">MUTUAL CONSENT / 双向确认</text>
      <text class="title">和 {{ buddy.nickname }}</text>
      <text class="title"><text class="hl">交换联系方式。</text></text>
      <text class="sub">公开名片不含联系方式；购买套装也不会自动获得他人联系方式。</text>

      <!-- 已授权 -->
      <view v-if="request?.status === 'accepted'">
        <view class="notice green mt">双方已确认（模拟） · 仅授权本次所选渠道</view>
        <view class="contact-granted">
          <view v-for="item in granted" :key="item.channel" class="granted-item">
            <text class="granted-label">{{ buddy.nickname }}的{{ channelName(item.channel) }}</text>
            <text class="granted-value">{{ item.value }}</text>
            <view class="btn-secondary small" @click="copy(item.value)">复制示例</view>
          </view>
        </view>
        <text class="fine">以上均为不可使用的虚构账号 / 号码，请勿添加或拨打。</text>
        <view class="btn-ghost mt" @click="revoke">撤销本次联系方式授权</view>
      </view>

      <!-- 等待回应 -->
      <view v-else-if="request?.status === 'pending'">
        <view class="notice mt">等待 {{ buddy.nickname }} 确认，双方目前都看不到对方的联系方式。</view>
        <text class="fine">本次愿意交换：{{ channelList(request.channels) }}</text>
        <view class="demo-reply">
          <text class="demo-label">仅供演示：模拟对方操作</text>
          <view class="demo-actions">
            <view class="btn-secondary small" @click="respond('accept')">模拟对方同意交换</view>
            <view class="btn-ghost small" @click="respond('decline')">模拟对方拒绝</view>
          </view>
        </view>
        <text class="textbtn block" @click="revoke">取消本次申请</text>
      </view>

      <!-- 未申请 / 已拒绝 -->
      <view v-else>
        <view v-if="request?.status === 'declined'" class="notice mt">
          对方已拒绝本次模拟申请，联系方式未展示。
        </view>

        <view v-if="available.length" class="contact-choices">
          <view
            v-for="ch in available"
            :key="ch"
            class="choice-item"
            :class="{ on: selected.includes(ch) }"
            @click="toggle(ch)"
          >
            <view class="check"><text v-if="selected.includes(ch)">✓</text></view>
            <view class="choice-body">
              <text class="choice-name">{{ channelName(ch) }}</text>
              <text class="choice-value">{{ mask(ch, contacts[ch]) }}</text>
            </view>
          </view>
        </view>

        <view v-if="available.length" class="tickline" @click="consent = !consent">
          <view class="check small" :class="{ on: consent }">
            <text v-if="consent">✓</text>
          </view>
          <text class="tick-text">
            我愿意仅向 {{ buddy.nickname }} 交换本次勾选的联系方式；对方也需确认后才展示。
          </text>
        </view>

        <view
          v-if="available.length"
          class="btn-primary mt"
          :class="{ disabled: busy }"
          @click="submit"
        >
          提交本次交换申请（模拟）
        </view>

        <view v-else class="notice mt">先填写至少一种愿意交换的联系方式。</view>
        <view v-if="!available.length" class="btn-primary mt" @click="goContacts">
          去填写交换资料
        </view>
      </view>

      <text class="fine">
        本次授权仅保存在本机 mock 会话；撤销后应用停止展示，无法撤回已经复制的内容。
      </text>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import type {
  BuddyDetail,
  CardExchange,
  ContactChannel,
  ContactRequest,
  GrantedChannel,
  MyContacts,
} from '@/api/types-social'
import { getBuddy } from '@/api/buddies'
import { listCardExchanges } from '@/api/card-exchanges'
import {
  createContactRequest,
  getContacts,
  getGrantedContacts,
  listContactRequests,
  respondContactRequest,
  revokeContactRequest,
} from '@/api/contacts'

const CHANNELS: { key: ContactChannel; label: string }[] = [
  { key: 'wechat', label: '微信' },
  { key: 'qq', label: 'QQ' },
  { key: 'phone', label: '电话' },
]

const buddyId = ref('')
const buddy = ref<BuddyDetail | null>(null)
const exchange = ref<CardExchange | null>(null)
const request = ref<ContactRequest | null>(null)
const contacts = ref<MyContacts>({})
const granted = ref<GrantedChannel[]>([])
const selected = ref<ContactChannel[]>([])
const consent = ref(false)
const loading = ref(true)
const loadError = ref(false)
const busy = ref(false)

onLoad((q) => {
  buddyId.value = (q?.id as string) || ''
})

onShow(() => {
  load()
})

const cardAccepted = computed(() => exchange.value?.status === 'accepted')

const available = computed(() =>
  CHANNELS.map((c) => c.key).filter((key) => Boolean(contacts.value[key])),
)

async function load() {
  if (!buddyId.value) {
    loading.value = false
    return
  }
  loading.value = !buddy.value
  loadError.value = false
  try {
    const [detail, exchanges, requests, myContacts] = await Promise.all([
      getBuddy(buddyId.value),
      listCardExchanges(),
      listContactRequests(buddyId.value),
      getContacts(),
    ])
    buddy.value = detail
    exchange.value = exchanges.items.find((item) => item.buddy_id === buddyId.value) || null
    contacts.value = myContacts
    request.value = requests.items[0] || null
    if (request.value?.status === 'accepted') {
      const res = await getGrantedContacts(request.value.id)
      granted.value = res.channels
    } else {
      granted.value = []
    }
  } catch {
    buddy.value = null
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function channelName(key: ContactChannel) {
  return CHANNELS.find((c) => c.key === key)?.label || key
}

function channelList(list: ContactChannel[]) {
  return list.map(channelName).join('、')
}

function mask(key: ContactChannel, value?: string) {
  if (!value) return '未填写'
  if (key === 'phone') return `${value.slice(0, 3)}****${value.slice(-4)}`
  if (value.length < 5) return '***'
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

function toggle(key: ContactChannel) {
  const idx = selected.value.indexOf(key)
  if (idx >= 0) {
    selected.value.splice(idx, 1)
  } else {
    selected.value.push(key)
  }
}

async function submit() {
  if (busy.value) return
  if (!selected.value.length) {
    uni.showToast({ title: '先选择愿意交换的渠道', icon: 'none' })
    return
  }
  if (!consent.value) {
    uni.showToast({ title: '请先确认双方授权', icon: 'none' })
    return
  }
  busy.value = true
  try {
    await createContactRequest({
      buddy_id: buddyId.value,
      channels: selected.value.slice(),
    })
    selected.value = []
    consent.value = false
    await load()
    uni.showToast({ title: '申请已发出', icon: 'none' })
  } catch {
    uni.showToast({ title: '提交失败，请稍后再试', icon: 'none' })
  } finally {
    busy.value = false
  }
}

async function respond(action: 'accept' | 'decline') {
  if (busy.value || !request.value) return
  busy.value = true
  try {
    await respondContactRequest(request.value.id, action)
    await load()
  } catch {
    uni.showToast({ title: '操作失败，请稍后再试', icon: 'none' })
  } finally {
    busy.value = false
  }
}

function revoke() {
  if (!request.value) return
  uni.showModal({
    title: '撤销本次授权？',
    content: '撤销后应用内停止展示，但无法收回已经复制的内容。',
    confirmText: '撤销',
    success: async (res) => {
      if (!res.confirm || !request.value) return
      try {
        await revokeContactRequest(request.value.id)
        request.value = null
        granted.value = []
        await load()
        uni.showToast({ title: '已撤销', icon: 'none' })
      } catch {
        uni.showToast({ title: '撤销失败，请稍后再试', icon: 'none' })
      }
    },
  })
}

function copy(value: string) {
  uni.setClipboardData({
    data: value,
    success: () => uni.showToast({ title: '已复制示例', icon: 'none' }),
  })
}

function goContacts() {
  uni.navigateTo({ url: `/pages/contacts/contacts?id=${buddyId.value}` })
}

function goDiscover() {
  uni.switchTab({ url: '/pages/discover/discover' })
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：联系方式与双方确认均为本地虚构数据。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.request-page {
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

.state {
  padding-top: 200rpx;
  text-align: center;
}
.state-text {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
}
.state-sub {
  display: block;
  margin-top: 14rpx;
  font-size: 24rpx;
  color: #77727e;
}

.kicker {
  display: block;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: #a398af;
  font-weight: 600;
}
.title {
  display: block;
  margin-top: 12rpx;
  font-size: 54rpx;
  font-weight: 800;
  line-height: 1.28;
  letter-spacing: -1rpx;
}
.hl {
  color: #7560df;
  border-bottom: 10rpx solid #dfff8b;
}
.sub {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.6;
}

.notice {
  display: block;
  background: #f5f3fa;
  border: 2rpx solid #e9e3f3;
  padding: 26rpx 30rpx;
  border-radius: 24rpx;
  color: #7c728b;
  font-size: 24rpx;
  line-height: 1.7;
}
.notice.green {
  background: #edf6f0;
  border-color: #dceade;
  color: #537c65;
}
.mt {
  margin-top: 28rpx;
}

.contact-granted {
  margin: 28rpx 0;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}
.granted-item {
  border: 2rpx solid #ddd4e6;
  background: #fff;
  border-radius: 24rpx;
  padding: 28rpx;
}
.granted-label {
  display: block;
  font-size: 22rpx;
  color: #9c88ac;
}
.granted-value {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
  margin: 14rpx 0 20rpx;
  word-break: break-all;
}

.contact-choices {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  margin: 32rpx 0 24rpx;
}
.choice-item {
  display: flex;
  align-items: center;
  gap: 22rpx;
  border: 2rpx solid #e0d5eb;
  border-radius: 24rpx;
  padding: 28rpx;
  background: #fff;
}
.choice-item.on {
  border-color: #6c4cf3;
  background: #f7f4ff;
}
.choice-body {
  flex: 1;
}
.choice-name {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: #292630;
}
.choice-value {
  display: block;
  font-size: 22rpx;
  color: #9f8aac;
  margin-top: 6rpx;
}
.check {
  width: 40rpx;
  height: 40rpx;
  border-radius: 12rpx;
  border: 2rpx solid #d9cfe9;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 24rpx;
  flex-shrink: 0;
}
.check.on {
  background: #6c4cf3;
  border-color: #6c4cf3;
}
.check.small {
  width: 32rpx;
  height: 32rpx;
  border-radius: 8rpx;
  font-size: 20rpx;
  margin-top: 4rpx;
}

.tickline {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  margin: 24rpx 0;
}
.tick-text {
  flex: 1;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.7;
}

.btn-primary,
.btn-secondary,
.btn-ghost {
  display: block;
  text-align: center;
  border-radius: 24rpx;
  padding: 22rpx 24rpx;
  font-size: 26rpx;
  font-weight: 600;
}
.btn-primary {
  background: #6c4cf3;
  color: #fff;
}
.btn-primary.disabled {
  opacity: 0.6;
}
.btn-secondary {
  background: #fff;
  color: #292630;
  border: 2rpx solid #ece7f1;
}
.btn-ghost {
  background: transparent;
  color: #77727e;
  border: 2rpx solid #ece7f1;
}
.btn-secondary.small,
.btn-ghost.small {
  font-size: 22rpx;
  padding: 16rpx 20rpx;
  border-radius: 18rpx;
}

.demo-reply {
  margin: 24rpx 0;
  padding: 28rpx;
  background: #f5f1fa;
  border: 2rpx dashed #d8c9e8;
  border-radius: 24rpx;
}
.demo-label {
  display: block;
  font-size: 20rpx;
  color: #aa95bc;
  margin-bottom: 18rpx;
}
.demo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}
.demo-actions view {
  flex: 1;
}

.textbtn {
  display: inline-block;
  color: #7560df;
  font-size: 24rpx;
  padding: 8rpx;
}
.textbtn.block {
  display: block;
  text-align: center;
}

.fine {
  display: block;
  margin-top: 24rpx;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.7;
}
</style>
