<template>
  <view class="page status-page">
    <view class="status-card" :class="stateClass">
      <text class="status-icon">{{ icon }}</text>
      <text class="status-title">{{ title }}</text>
      <text class="status-desc">{{ desc }}</text>

      <view v-if="status === 'pending'" class="spinner" />

      <view v-if="status === 'paid'" class="btn-primary mt" @click="finish">完成</view>

      <template v-if="status === 'failed'">
        <view class="btn-primary mt" @click="retry">重试支付</view>
        <view class="btn-ghost mt" @click="finish">稍后再说</view>
      </template>

      <template v-if="status === 'timeout'">
        <view class="btn-secondary mt" @click="recheck">重新查询</view>
        <view class="btn-ghost mt" @click="finish">稍后再说</view>
      </template>
    </view>

    <text class="fine centered">当前为模拟支付，不会真实扣款。</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { pollOrderStatus } from '@/api/payment'

type PageStatus = 'pending' | 'paid' | 'failed' | 'timeout'

const orderId = ref('')
const productCode = ref('')
const resultId = ref('')
const status = ref<PageStatus>('pending')
let cancelled = false

const title = computed(() => {
  if (status.value === 'paid') return '解锁成功'
  if (status.value === 'failed') return '支付失败'
  if (status.value === 'timeout') return '支付结果确认超时'
  return '正在确认支付结果…'
})

const desc = computed(() => {
  if (status.value === 'paid') return '套装已解锁'
  if (status.value === 'failed') return '本次没有扣款，可以重试支付。'
  if (status.value === 'timeout') return '暂未确认到支付结果，可重新查询订单状态。'
  return '支付完成后会自动确认，请稍候。'
})

const icon = computed(() => {
  if (status.value === 'paid') return '✓'
  if (status.value === 'failed') return '✕'
  if (status.value === 'timeout') return '!'
  return '…'
})

const stateClass = computed(() => `is-${status.value}`)

onLoad((q) => {
  orderId.value = (q?.order_id as string) || ''
  productCode.value = (q?.product_code as string) || ''
  resultId.value = (q?.result_id as string) || ''
  start()
})

onUnload(() => {
  cancelled = true
})

async function start() {
  if (!orderId.value) {
    status.value = 'failed'
    return
  }
  try {
    const res = await pollOrderStatus(orderId.value, { intervalMs: 2000, timeoutMs: 60000 })
    if (cancelled) return
    status.value = res.status === 'paid' ? 'paid' : res.status === 'failed' ? 'failed' : 'timeout'
  } catch {
    if (!cancelled) status.value = 'failed'
  }
}

async function recheck() {
  status.value = 'pending'
  await start()
}

function retry() {
  const suffix = resultId.value ? `&result_id=${encodeURIComponent(resultId.value)}` : ''
  uni.redirectTo({ url: `/pages/unlock/unlock?product_code=${productCode.value}${suffix}` })
}

function finish() {
  uni.navigateBack({
    delta: 1,
    fail: () => uni.reLaunch({ url: '/pages/index/index' }),
  })
}
</script>

<style scoped lang="scss">
.status-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
}

.status-card {
  margin-top: 120rpx;
  padding: 56rpx 40rpx;
  border-radius: 32rpx;
  background: #fff;
  border: 2rpx solid #e9e3f1;
  text-align: center;
}
.status-icon {
  display: block;
  font-size: 88rpx;
  font-weight: 800;
  line-height: 1;
}
.is-pending .status-icon {
  color: #6c4cf3;
}
.is-paid .status-icon {
  color: #3f9a6e;
}
.is-failed .status-icon {
  color: #d05353;
}
.is-timeout .status-icon {
  color: #d08a35;
}

.status-title {
  display: block;
  margin-top: 24rpx;
  font-size: 38rpx;
  font-weight: 800;
  color: #292630;
}
.status-desc {
  display: block;
  margin-top: 14rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.7;
}

.spinner {
  width: 56rpx;
  height: 56rpx;
  margin: 32rpx auto 0;
  border-radius: 50%;
  border: 6rpx solid #ece7fb;
  border-top-color: #6c4cf3;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.btn-primary,
.btn-secondary,
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
.btn-secondary {
  background: #fff;
  color: #6c4cf3;
  border: 2rpx solid #d9c9f5;
}
.btn-ghost {
  background: transparent;
  color: #77727e;
  border: 2rpx solid #ece7f1;
}
.mt {
  margin-top: 24rpx;
}

.fine {
  display: block;
  margin-top: 24rpx;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.7;
}
.fine.centered {
  text-align: center;
}
</style>