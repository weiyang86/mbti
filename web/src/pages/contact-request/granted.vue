<template>
  <view class="page social-page">
    <text class="heading">当前授权读取</text>
    <text class="notice">只允许原请求人实时读取确切批准的渠道。列表状态不能保证当前仍有授权；离页或重读时清空旧值。</text>
    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="message" class="success" role="status">{{ message }}</text>
    <button class="btn-secondary" :disabled="loading || busy" @click="load">重新验证并读取授权</button>
    <text v-if="loading" class="notice">正在验证当前授权…</text>
    <template v-if="loaded">
      <text class="success">本次服务端读取成功，仅显示当前批准渠道。</text>
      <view v-for="item in granted" :key="item.channel" class="card">
        <text class="section">{{ channelLabel(item.channel) }}</text>
        <text class="line private-contact-value">{{ item.value }}</text>
      </view>
      <button class="btn-secondary mt" :disabled="loading || busy" @click="revoke">撤回本次渠道申请并清空</button>
    </template>
    <button class="btn-secondary mt" @click="go('/pages/contact-request/contact-request')">返回联系方式请求</button>
  </view>
</template>
<script setup lang="ts">
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
  try { await revokeContactRequest(id.value); if (scope.current(ticket)) message.value = '本次授权已撤回，页面已清空；无法收回已经复制或截图的内容。' }
  catch (e) { if (scope.current(ticket)) error.value = contactErrorMessage(e, '撤回失败，页面已清空，请重新验证当前状态。') }
  finally { if (scope.current(ticket)) busy.value = false }
}
function go(url: string) { uni.navigateTo({ url }) }
</script>
<style scoped lang="scss">@import '@/styles/social.scss';</style>
