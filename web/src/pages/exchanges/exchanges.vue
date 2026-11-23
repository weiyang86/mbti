<template>
  <view class="page">
    <proto-nav />
    <DemoStrip />

    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="actionError" class="error" role="alert">{{ actionError }}</text>
    <StateView v-if="loading" state="loading" title="正在读取收发记录…" />

    <view class="page-intro">
      <view class="eyebrow">CARD WALLET / 名片夹</view>
      <view class="h1">每次交换，都由双方选择。</view>
      <view class="p">名片交换与联系方式交换是两次独立授权。</view>
    </view>

    <template v-if="loaded && !items.length">
      <view class="empty-block">
        <view class="page-intro">
          <view class="eyebrow">MBTI BUDDY</view>
          <view class="h1">名片夹还空着</view>
          <view class="p">先向喜欢的示例搭子发出一张名片。</view>
        </view>
        <button class="btn full" @click="goTab('/pages/discover/discover')">去发现搭子</button>
      </view>
    </template>

    <template v-else>
      <view v-for="item in items" :key="item.id" class="wallet-item">
        <view class="wallet-head">
          <text class="b">{{ displayBuddyName(item.buddy.nickname, item.buddy.id) }} · {{ item.buddy.type_code }}</text>
          <text class="tag">{{ exchangeStatusLabel(item.status) }}</text>
        </view>
        <view class="p">{{ item.direction === 'incoming' ? '收到的申请' : '发出的申请' }} · 联系方式仍未公开</view>
        <view v-if="canRespond(item)" class="btnrow">
          <button class="btn secondary small" :disabled="busy || loading" @click="respond(item, 'accept')">接受名片交换</button>
          <button class="btn ghost small" :disabled="busy || loading" @click="respond(item, 'decline')">拒绝名片交换</button>
        </view>
        <button
          v-if="canRevoke(item)"
          class="btn ghost small mt"
          :disabled="busy || loading"
          @click="revoke(item)"
        >{{ item.status === 'accepted' ? '撤销名片交换' : '撤回申请' }}</button>
        <view class="wallet-links">
          <text class="textbtn" @click="go(`/pages/buddies/detail?id=${encodeURIComponent(item.buddy_id)}`)">查看详情与交换设置 →</text>
          <text
            v-if="item.status === 'accepted'"
            class="textbtn"
            @click="go(`/pages/contact-request/contact-request?id=${encodeURIComponent(item.buddy_id)}`)"
          >申请对方联系方式</text>
        </view>
      </view>
    </template>

    <view class="notice mt">撤销会停止应用内展示；正式服务无法收回对方已经保存或复制的内容。</view>
  <proto-footer />
  </view>
</template>
<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import StateView from '@/components/state-view.vue'
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
function toastDemo() { uni.showToast({ title: '演示模式，未产生真实操作', icon: 'none' }) }
function go(url: string) { uni.navigateTo({ url }) }
function goTab(url: string) { uni.switchTab({ url, fail: () => uni.reLaunch({ url }) }) }
</script>
<style scoped lang="scss">
.line {
  display: block;
}
.error {
  display: block;
  margin: 12px 0;
  font-size: 12px;
  line-height: 1.7;
  color: #a43b3b;
}
.empty-block {
  padding: 12px 0 18px;
}
.wallet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.wallet-item .btnrow {
  margin-top: 10px;
}
.wallet-item > .btn {
  margin-top: 10px;
}
.wallet-links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
}
.wallet-links .textbtn {
  padding: 4px;
  font-size: 12px;
}
.btn::after,
.textbtn::after {
  border: 0;
}
.demo-strip .textbtn {
  font-size: 9px;
  color: #a197ad;
}
.btnrow > .btn {
  margin: 0;
}
</style>
