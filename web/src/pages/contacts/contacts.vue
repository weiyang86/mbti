<template>
  <view class="page social-page">
    <text class="heading">我的联系方式</text>
    <text class="notice">仅维护本人的私密渠道，不出现在公开名片。实际改值或清除会使旧申请和授权失效，重新填写不会恢复旧授权。</text>
    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="message" class="success" role="status">{{ message }}</text>
    <button class="btn-secondary" :disabled="loading || busy" @click="load">重新读取本人渠道</button>
    <text v-if="loading" class="notice">正在读取本人渠道…</text>
    <view v-if="loaded" class="card">
      <label class="field" for="wechat">微信号（选填）</label>
      <input id="wechat" v-model="form.wechat" :disabled="busy" maxlength="20" placeholder="以字母开头，6–20 位" :auto-focus="false" />
      <label class="field" for="qq">QQ（选填）</label>
      <input id="qq" v-model="form.qq" :disabled="busy" maxlength="12" placeholder="5–12 位数字，首位不为 0" />
      <label class="field" for="phone">手机号（选填）</label>
      <input id="phone" v-model="form.phone" :disabled="busy" maxlength="11" placeholder="11 位手机号" />
      <text class="notice">保存为整份替换：留空即删除该渠道。输入仅留在当前页面，离页后重新向服务端读取。</text>
      <button class="btn-primary mt" :disabled="busy || loading" @click="save">保存本人联系方式</button>
      <button class="btn-secondary mt" :disabled="busy || loading" @click="clearAll">清除全部本人渠道</button>
    </view>
    <button class="btn-secondary mt" @click="go('/pages/contact-request/contact-request')">联系方式请求</button>
    <button class="btn-secondary mt" @click="go('/pages/index/index')">返回首页</button>
  </view>
</template>
<script setup lang="ts">
import { reactive, ref } from 'vue'
import { onHide, onShow, onUnload } from '@dcloudio/uni-app'
import { clearContacts, getContacts, updateContacts } from '@/api/contacts'
import type { MyContacts } from '@/api/types-social'
import { contactErrorMessage, validateContacts } from '@/utils/contact-display'
import { createPrivateScope } from '@/utils/private-page'
const form = reactive({ wechat: '', qq: '', phone: '' })
const loading = ref(false)
const busy = ref(false)
const loaded = ref(false)
const error = ref('')
const message = ref('')
function empty() { form.wechat = ''; form.qq = ''; form.phone = ''; loaded.value = false }
const scope = createPrivateScope(empty)
function fill(data: MyContacts) { form.wechat = data.wechat || ''; form.qq = data.qq || ''; form.phone = data.phone || ''; loaded.value = true }
onShow(() => { scope.enter(); busy.value = false; loading.value = false; message.value = ''; load() })
function leave() { scope.leave(); loading.value = false; busy.value = false; message.value = '' }
onHide(leave)
onUnload(leave)
async function load() {
  if (loading.value || busy.value) return
  const ticket = scope.begin()
  loading.value = true; error.value = ''; message.value = ''
  try { const data = await getContacts(); if (scope.current(ticket)) fill(data) }
  catch (e) { if (scope.current(ticket)) { empty(); error.value = contactErrorMessage(e, '本人渠道读取失败，旧值已清空；请重试后再保存。') } }
  finally { if (scope.current(ticket)) loading.value = false }
}
async function save() {
  if (busy.value || loading.value || !loaded.value) return
  error.value = validateContacts(form)
  if (error.value) return
  // Keep the request body only in this pending operation, never storage or URL.
  const body = { wechat: form.wechat.trim(), qq: form.qq.trim(), phone: form.phone.trim() }
  const ticket = scope.begin()
  busy.value = true; message.value = ''
  try { const data = await updateContacts(body); if (scope.current(ticket)) { fill(data); message.value = '本人渠道已保存到服务端。' } }
  catch (e) { if (scope.current(ticket)) { empty(); error.value = contactErrorMessage(e, '保存失败，旧值已清空；请重新读取。') } }
  finally { if (scope.current(ticket)) busy.value = false }
}
function clearAll() {
  if (busy.value || loading.value || !loaded.value) return
  uni.showModal({ title: '清除全部本人渠道？', content: '已有申请和授权将失效，重新填写也不会恢复；无法收回他人已经复制或截图的内容。', confirmText: '清除', success: async (result) => {
    if (!result.confirm || busy.value || loading.value) return
    const ticket = scope.begin(); busy.value = true; error.value = ''; message.value = ''
    try { await clearContacts(); if (scope.current(ticket)) { empty(); loaded.value = true; message.value = '本人渠道已清除，旧授权不可再读取。' } }
    catch (e) { if (scope.current(ticket)) { empty(); error.value = contactErrorMessage(e, '清除失败，页面旧值已清空；请重新读取。') } }
    finally { if (scope.current(ticket)) busy.value = false }
  } })
}
function go(url: string) { uni.navigateTo({ url }) }
</script>
<style scoped lang="scss">@import '@/styles/social.scss';</style>
