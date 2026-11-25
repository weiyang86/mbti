<template>
  <view class="page">
    <proto-nav />
    <DemoStrip />

    <view class="page-intro">
      <view class="eyebrow">ACCOUNT / 登录</view>
      <view class="h1">把现在的我，<text class="line">留在我的身份里。</text></view>
      <view class="p">登录只会把当前游客数据绑定到登录身份，不会清除已有记录、订单或名片。</view>
    </view>

    <view class="panel">
      <view class="h3">微信登录</view>
      <view class="p">{{ loginHint }}</view>

      <view v-if="account.session" class="notice green">已登录：{{ providerLabel }}</view>
      <text v-if="error" class="error" role="alert">{{ error }}</text>

      <button class="btn full mt" :disabled="busy" @click="submit">
        {{ busy ? '正在登录…' : account.session ? '重新登录' : '登录' }}
      </button>
      <text class="textbtn mt" @click="goAccount">返回我的</text>
    </view>

    <view class="fine mt">
      登录身份与当前记录绑定；退出登录不会删除本机记录。
    </view>
  <proto-footer />
  </view>
</template>

<script setup lang="ts">
import DemoStrip from '@/components/demo-strip.vue'
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { account, login } from '@/store/account'
import { hasWechatMpCallback } from '@/api/auth'

const busy = ref(false)
const error = ref('')
/** 从支付页跳来时，登录成功后返回原页面继续下单 */
const fromCheckout = ref(false)
let loginHint = '将调用微信登录授权，再由服务端换取身份。'
// #ifdef H5
loginHint = '网页版会在微信内跳转授权，请在微信中打开本页面。'
// #endif
const providerLabel = computed(() =>
  account.session?.provider === 'wechat' ? '微信身份' : '本机身份',
)

onLoad((query) => {
  fromCheckout.value = query?.from === 'checkout'
  // 公众号 OAuth 回到本页后自动完成登录
  if (hasWechatMpCallback()) void submit()
})

onShow(() => {
  error.value = ''
})

async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await login(true)
    uni.showToast({ title: '登录成功', icon: 'none' })
    if (fromCheckout.value) {
      setTimeout(() => {
        uni.navigateBack({ fail: () => uni.redirectTo({ url: '/pages/pricing/pricing' }) })
      }, 300)
      return
    }
    setTimeout(() => uni.switchTab({ url: '/pages/account/account' }), 500)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登录失败，请稍后重试'
  } finally {
    busy.value = false
  }
}

function goAccount() {
  uni.switchTab({ url: '/pages/account/account' })
}
</script>

<style scoped lang="scss">
.error {
  display: block;
  margin: 10px 0;
  font-size: 12px;
  line-height: 1.7;
  color: #a43b3b;
}
</style>
