<template>
  <view class="page unlock-page">
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="demo-link" @click="showDemo">演示状态 ↗</text>
    </view>

    <text class="kicker">UNLOCK / 付费解锁</text>
    <text class="title">{{ product ? product.name : '商品不存在' }}</text>
    <text class="sub" v-if="product">{{ product.description }}</text>

    <view class="product-card" v-if="product">
      <view class="price-row">
        <text class="price">¥{{ priceYuan }}</text>
        <text class="price-note">{{ isUpgrade ? '已有晒图套装 · 本次补差 ¥10' : '一次购买 · 无自动续费' }}</text>
      </view>
      <view class="highlight" v-for="h in product.highlights" :key="h">
        <text class="dot">✓</text>
        <text class="hl-text">{{ h }}</text>
      </view>
    </view>

    <view v-if="error" class="notice err">{{ error }}</view>

    <view
      class="btn-primary pay-btn"
      :class="{ disabled: paying || !product }"
      @click="pay"
    >
      {{ paying ? '正在发起支付…' : `微信支付 ¥${priceYuan} 解锁` }}
    </view>
    <text class="fine centered">当前为模拟支付，不会真实扣款；发起后自动进入订单确认。</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { PAYMENT_PRODUCTS } from '@/constants/payment'
import { createOrder } from '@/api/payment'
import { studio } from '@/store/studio'

const resultId = ref('')
const productCode = ref('studio_tier_1')
const paying = ref(false)
const error = ref('')

const product = computed(
  () =>
    PAYMENT_PRODUCTS[productCode.value] ||
    PAYMENT_PRODUCTS[productCode.value.replace(/_fail$/, '')],
)
/** 已有晒图套装再买本人形象套装时只补差价（与原型一致：¥10） */
const isUpgrade = computed(() => product.value?.tier === 2 && studio.tier === 1)
const priceYuan = computed(() =>
  product.value ? ((isUpgrade.value ? 1000 : product.value.amount) / 100).toFixed(1) : '0',
)

onLoad((q) => {
  resultId.value = (q?.result_id as string) || ''
  productCode.value = (q?.product_code as string) || 'studio_tier_1'
})

async function pay() {
  if (paying.value || !product.value) return
  paying.value = true
  error.value = ''
  try {
    // 升级补差由服务端按已购权益计价，前端只传商品编码，不额外发明字段
    const order = await createOrder({ result_id: resultId.value, product_code: productCode.value })
    // 真实模式：此处应调用 uni.requestPayment(order.pay_params)；mock 跳过
    const suffix = resultId.value ? `&result_id=${encodeURIComponent(resultId.value)}` : ''
    uni.redirectTo({
      url: `/pages/order-status/order-status?order_id=${order.id}&product_code=${productCode.value}${suffix}`,
    })
  } catch {
    error.value = '发起支付失败，请稍后重试'
  } finally {
    paying.value = false
  }
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：支付流程仅在本机模拟，不会拉起真实微信支付，也不会扣款。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.unlock-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
}

.demo-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 20rpx;
  color: #a398af;
  margin-bottom: 28rpx;
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
  font-size: 56rpx;
  font-weight: 800;
  line-height: 1.28;
  letter-spacing: -1rpx;
}
.sub {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.6;
}

.product-card {
  margin-top: 36rpx;
  padding: 34rpx 30rpx;
  border-radius: 30rpx;
  background: linear-gradient(150deg, #f6f1ff, #efe8ff 60%, #f2f7ec);
  border: 2rpx solid #e3d9f6;
}
.price-row {
  display: flex;
  align-items: baseline;
  gap: 16rpx;
  padding-bottom: 22rpx;
  border-bottom: 2rpx solid rgba(120, 96, 180, 0.14);
}
.price {
  font-size: 64rpx;
  font-weight: 800;
  color: #6c4cf3;
  line-height: 1;
}
.price-note {
  font-size: 20rpx;
  color: #8b8099;
}
.highlight {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 20rpx;
}
.dot {
  color: #3f9a6e;
  font-size: 24rpx;
  font-weight: 700;
}
.hl-text {
  font-size: 25rpx;
  color: #3f3552;
}

.notice {
  margin-top: 24rpx;
  padding: 22rpx 24rpx;
  border-radius: 18rpx;
  background: #f3f0f8;
  font-size: 22rpx;
  color: #77727e;
  line-height: 1.7;
}
.notice.err {
  background: #fdecec;
  color: #b34747;
}

.btn-primary {
  margin-top: 40rpx;
  text-align: center;
  background: #6c4cf3;
  color: #fff;
  border-radius: 24rpx;
  padding: 26rpx;
  font-size: 28rpx;
  font-weight: 700;
}
.btn-primary.disabled {
  opacity: 0.6;
}

.fine {
  display: block;
  margin-top: 20rpx;
  font-size: 20rpx;
  color: #a398af;
  line-height: 1.7;
}
.fine.centered {
  text-align: center;
}
</style>