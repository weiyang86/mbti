<template>
  <view class="page contacts-page">
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="demo-link" @click="showDemo">演示状态 ↗</text>
    </view>

    <text class="kicker">MY CONTACTS / 交换设置</text>
    <text class="title">选好愿意交换的</text>
    <text class="title"><text class="hl">联系方式。</text></text>
    <text class="sub">填写后也不会出现在公开名片、朋友圈图或附近雷达中。</text>

    <view class="notice mt">
      为便于演示，建议填写虚构内容。这些资料只保存在本机 mock 存储中。
    </view>

    <view v-if="loadError" class="notice mt">
      读取已保存的联系方式失败，当前显示空白表单。请重试后再保存，避免覆盖已有资料。
    </view>
    <view v-if="loadError" class="btn-secondary mt" @click="load">重新读取</view>

    <view class="contact-form">
      <view class="field">
        <text class="label">微信号 <text class="muted">选填</text></text>
        <input
          v-model="form.wechat"
          class="input"
          maxlength="20"
          placeholder="例如 demo_mbti_01"
        />
      </view>
      <view class="field">
        <text class="label">QQ <text class="muted">选填</text></text>
        <input
          v-model="form.qq"
          class="input"
          type="number"
          maxlength="12"
          placeholder="5–12 位数字"
        />
      </view>
      <view class="field">
        <text class="label">手机号 <text class="muted">选填</text></text>
        <input
          v-model="form.phone"
          class="input"
          type="number"
          maxlength="11"
          placeholder="11 位手机号（仅本机演示）"
        />
      </view>
    </view>

    <view class="btn-primary" :class="{ disabled: saving }" @click="save">
      {{ returnId ? '保存并返回交换申请' : '保存本次页面的联系方式' }}
    </view>
    <view class="btn-ghost mt" @click="clearAll">清除本次联系方式与授权</view>

    <text class="fine">
      每次交换还需选择渠道并单独确认。这里不会发短信、拨号、加好友或向别人发送资料。
    </text>
  </view>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import type { MyContacts } from '@/api/types-social'
import { clearContacts, getContacts, updateContacts } from '@/api/contacts'

const returnId = ref('')
const saving = ref(false)
const loadError = ref(false)
const form = reactive<MyContacts>({ wechat: '', qq: '', phone: '' })

onLoad((q) => {
  returnId.value = (q?.id as string) || ''
})

onShow(load)

async function load() {
  loadError.value = false
  try {
    const data = await getContacts()
    form.wechat = data.wechat || ''
    form.qq = data.qq || ''
    form.phone = data.phone || ''
  } catch {
    loadError.value = true
  }
}

async function save() {
  if (saving.value) return
  if (loadError.value) {
    uni.showToast({ title: '请先重新读取已有资料', icon: 'none' })
    return
  }
  saving.value = true
  try {
    await updateContacts({ wechat: form.wechat, qq: form.qq, phone: form.phone })
    uni.showToast({ title: '已保存', icon: 'success' })
    if (returnId.value) {
      setTimeout(() => uni.navigateBack(), 500)
    }
  } catch {
    uni.showToast({ title: '保存失败，请稍后再试', icon: 'none' })
  } finally {
    saving.value = false
  }
}

function clearAll() {
  uni.showModal({
    title: '清除联系方式？',
    content: '清除后本次填写的内容与已有授权都会失效。',
    confirmText: '清除',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await clearContacts()
        form.wechat = ''
        form.qq = ''
        form.phone = ''
        uni.showToast({ title: '已清除', icon: 'none' })
      } catch {
        uni.showToast({ title: '清除失败，请稍后再试', icon: 'none' })
      }
    },
  })
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：联系方式只保存在本机，不会发送给真实用户。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.contacts-page {
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
  font-size: 58rpx;
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

.contact-form {
  margin: 40rpx 0 32rpx;
}
.field {
  margin-bottom: 32rpx;
}
.label {
  display: block;
  font-size: 24rpx;
  font-weight: 600;
  margin-bottom: 16rpx;
  color: #292630;
}
.muted {
  color: #a398af;
  font-weight: 400;
  margin-left: 8rpx;
}
.input {
  width: 100%;
  box-sizing: border-box;
  border: 2rpx solid #ece7f1;
  border-radius: 24rpx;
  background: #fff;
  padding: 24rpx 28rpx;
  min-height: 90rpx;
  font-size: 30rpx;
  color: #292630;
}

.btn-primary,
.btn-ghost {
  display: block;
  text-align: center;
  border-radius: 24rpx;
  padding: 24rpx;
  font-size: 28rpx;
  font-weight: 600;
}
.btn-primary {
  background: #6c4cf3;
  color: #fff;
}
.btn-primary.disabled {
  opacity: 0.6;
}
.btn-ghost {
  background: transparent;
  color: #77727e;
  border: 2rpx solid #ece7f1;
}

.fine {
  display: block;
  margin-top: 28rpx;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.7;
}
.mt {
  margin-top: 24rpx;
}
</style>
