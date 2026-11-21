<template>
  <view class="page">
    <proto-nav />
    <DemoStrip />

    <view class="page-intro">
      <view class="eyebrow">MY CONTACTS / 交换设置</view>
      <view class="h1">选好愿意交换的联系方式。</view>
      <view class="p">填写后也不会出现在公开名片、朋友圈图或附近雷达中。</view>
    </view>

    <view class="notice">
      为便于演示，建议填写虚构内容。保存为整份替换：留空即删除该渠道。
    </view>
    <text v-if="error" class="error" role="alert">{{ error }}</text>
    <text v-if="message" class="success" role="status">{{ message }}</text>
    <text v-if="loading" class="notice" role="status">正在读取本人渠道…</text>

    <view v-if="loaded" class="contact-form">
      <view class="field">
        <text class="label">微信 <text class="muted">选填</text></text>
        <input
          class="input"
          v-model="form.wechat"
          :disabled="busy"
          maxlength="20"
          placeholder="例如 demo_mbti_01"
          autocomplete="off"
        />
      </view>
      <view class="field">
        <text class="label">QQ <text class="muted">选填</text></text>
        <input
          class="input"
          v-model="form.qq"
          type="number"
          :disabled="busy"
          maxlength="12"
          placeholder="5–12 位数字"
          autocomplete="off"
        />
      </view>
      <view class="field">
        <text class="label">电话 <text class="muted">选填</text></text>
        <input
          class="input"
          v-model="form.phone"
          type="number"
          :disabled="busy"
          maxlength="11"
          placeholder="11 位手机号（仅本机演示）"
          autocomplete="off"
        />
      </view>
    </view>

    <button class="btn full" :disabled="busy || loading || !loaded" @click="save">
      {{ busy ? '正在保存…' : '保存本人联系方式' }}
    </button>
    <button class="btn ghost full mt" :disabled="busy || loading || !loaded" @click="clearAll">
      清除全部本人渠道
    </button>
    <text class="textbtn mt" @click="load">重新读取本人渠道</text>

    <view class="fine mt">
      每次申请还需选择渠道并单独确认。此页面不会发短信、拨号、加好友或向别人发送资料。
    </view>
  <proto-footer />
  </view>
</template>
<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import { reactive, ref } from 'vue'
import { onHide, onShow, onUnload } from '@dcloudio/uni-app'
import { clearContacts, getContacts, updateContacts } from '@/api/contacts'
import { HttpError } from '@/api/client'
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
  catch (e) {
    if (!scope.current(ticket)) return
    // 存储未开启属于服务端能力问题，保留本次输入方便重试；其他失败按原策略清空旧值。
    if (e instanceof HttpError && e.status === 503) {
      error.value = contactErrorMessage(e, '保存失败，请稍后重试。')
    } else {
      empty()
      error.value = contactErrorMessage(e, '保存失败，旧值已清空；请重新读取。')
    }
  }
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
function demoState() { uni.showToast({ title: '演示模式，未产生真实操作', icon: 'none' }) }
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
.contact-form .input {
  height: 54px;
}
.fine {
  margin-bottom: 10px;
}
.btn::after {
  border: 0;
}
</style>
