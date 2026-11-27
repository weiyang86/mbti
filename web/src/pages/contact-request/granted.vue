<template>
  <view class="page">
    <proto-nav />
    <DemoStrip />

    <view class="page-intro">
      <view class="eyebrow">MUTUAL CONSENT / 双向确认</view>
      <view class="h1">只读，<text class="line">且只到撤回为止。</text></view>
      <view class="p">只允许原请求人实时读取确切批准的渠道；离页或重读时清空旧值。</view>
    </view>

    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="message" class="success" role="status">{{ message }}</text>
    <StateView v-if="loading" state="loading" title="正在验证当前授权…" />

    <template v-if="loaded">
      <view class="notice green">双方已确认 · 仅授权本次所选渠道</view>

      <view class="contact-granted">
        <view v-for="item in granted" :key="item.channel">
          <text class="span">对方的{{ channelLabel(item.channel) }}</text>
          <text class="b">{{ item.value }}</text>
          <button class="btn secondary small" @click="copy(item.value)">复制</button>
        </view>
      </view>

      <view class="fine">以上为本次批准的渠道，仅在本页显示；请勿添加或拨打来路不明的账号 / 号码。</view>
      <button class="btn ghost full" :disabled="loading || busy" @click="revoke">撤销本次联系方式授权</button>
    </template>

    <text class="textbtn mt" @click="load">重新验证并读取</text>

    <view class="fine mt">本次授权仅存在当前页面会话；刷新后需重新验证。撤销后应用停止展示，无法撤回已经复制的内容。</view>
  <proto-footer />
  </view>
</template>
<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import StateView from '@/components/state-view.vue'
import { ref } from 'vue'
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import { getGrantedContacts, revokeContactRequest } from '@/api/contacts'
import type { GrantedChannel } from '@/api/types-social'
import { channelLabel, contactErrorMessage } from '@/utils/contact-display'
import { createPrivateScope } from '@/utils/private-page'
const id = ref('')
const granted = ref<GrantedChannel[]>([])
const loaded = ref(false)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
const scope = createPrivateScope(() => { granted.value = []; loaded.value = false })
onLoad((query) => { id.value = typeof query?.id === 'string' ? query.id : '' })
onShow(() => { scope.enter(); loading.value = false; busy.value = false; message.value = ''; load() })
function leave() { scope.leave(); loading.value = false; busy.value = false; message.value = '' }
onHide(leave)
onUnload(leave)
async function load() {
  if (loading.value || busy.value) return
  const ticket = scope.begin(); error.value = ''; message.value = ''
  if (!id.value) { error.value = '缺少申请编号，当前不可读取。'; return }
  loading.value = true
  try { const data = await getGrantedContacts(id.value); if (scope.current(ticket)) { granted.value = data.channels; loaded.value = true } }
  catch (e) { if (scope.current(ticket)) { granted.value = []; loaded.value = false; error.value = contactErrorMessage(e, '授权读取失败，旧值已清空，请重新验证。') } }
  finally { if (scope.current(ticket)) loading.value = false }
}
async function revoke() {
  if (busy.value || loading.value || !loaded.value) return
  const ticket = scope.begin(); busy.value = true; error.value = ''
  try { await revokeContactRequest(id.value); if (scope.current(ticket)) { granted.value = []; loaded.value = false; message.value = '本次授权已撤回，页面已清空；无法收回已经复制或截图的内容。' } }
  catch (e) { if (scope.current(ticket)) error.value = contactErrorMessage(e, '撤回失败，页面已清空，请重新验证当前状态。') }
  finally { if (scope.current(ticket)) busy.value = false }
}
function copy(value: string) {
  uni.setClipboardData({ data: value, success: () => uni.showToast({ title: '已复制', icon: 'none' }) })
}
</script>
<style scoped lang="scss">
.line {
  display: block;
  border-top: 0;
}
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
.textbtn {
  display: inline-block;
  margin-top: 14px;
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
.btn::after,
.textbtn::after {
  border: 0;
}
</style>
