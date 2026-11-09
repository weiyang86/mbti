<template>
  <view class="page commerce-page">
    <text class="heading">确认测试订单</text>
    <text class="notice">当前为受控测试；支付通道未配置时，订单保持待支付，不能发起支付。</text>
    <text v-if="loading" class="muted">正在核对商品和本人结果…</text>
    <text v-if="error" class="error">{{ error }}</text>
    <view v-if="product && result" class="card mt">
      <text class="section">{{ product.name }}</text>
      <text class="muted line">{{ product.description }}</text>
      <text class="price">{{ formatMoney(product.amount, product.currency) }}</text>
      <text class="notice">受控测试价格，以服务端订单快照为准。</text>
      <text class="identifier">商品：{{ product.code }}</text>
      <text class="line">结果类型：{{ result.type_code }}</text>
      <text class="identifier">结果编号：{{ result.id }}</text>
      <text v-if="!product.saleable" class="notice">暂不可售{{ product.unavailable_reason ? `（${product.unavailable_reason}）` : '' }}</text>
      <button class="btn-primary mt" :disabled="creating || loading || !product.saleable || !intentReady" @click="create">{{ creating ? '正在创建订单…' : '创建待支付测试订单' }}</button>
      <text class="notice">网络失败后可点击重试或刷新；同一购买意图会复用订单号。</text>
    </view>
    <button v-if="error && !creating" class="btn-secondary mt" @click="load">重新核对</button>
    <button class="btn-secondary mt" :disabled="creating" @click="goOrders">查询我的订单与权益</button>
    <button class="btn-secondary mt" :disabled="creating" @click="goCatalog">返回商品目录</button>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { createOrder, listProducts, preparePurchaseIntent, type PaymentProduct } from '@/api/payment'
import { getResult } from '@/api/results'
import type { ResultSnapshot } from '@/api/types'
import { requestErrorMessage } from '@/api/client'
import { formatMoney } from '@/utils/payment-display'

const resultId = ref('')
const productCode = ref('')
const product = ref<PaymentProduct | null>(null)
const result = ref<ResultSnapshot | null>(null)
const loading = ref(false)
const creating = ref(false)
const intentReady = ref(false)
const error = ref('')

onLoad((q) => {
  resultId.value = (q?.result_id as string) || ''
  productCode.value = (q?.product_code as string) || ''
  load()
})

async function load() {
  if (loading.value || creating.value) return
  loading.value = true
  intentReady.value = false
  product.value = null
  result.value = null
  error.value = ''
  try {
    if (!resultId.value || !productCode.value) throw new Error('请从商品目录选择本人的结果和商品')
    const [catalog, owned] = await Promise.all([listProducts(), getResult(resultId.value)])
    product.value = catalog.items.find((item) => item.code === productCode.value) || null
    result.value = owned
    if (!product.value) throw new Error('商品不存在，请返回目录')
    await preparePurchaseIntent({ result_id: resultId.value, product_code: productCode.value })
    intentReady.value = true
  } catch (e) {
    error.value = requestErrorMessage(e, e instanceof Error ? e.message : '核对失败，请稍后重试')
  } finally { loading.value = false }
}

async function create() {
  if (creating.value || loading.value || !product.value?.saleable || !result.value || !intentReady.value) return
  creating.value = true
  error.value = ''
  try {
    const order = await createOrder({ result_id: resultId.value, product_code: productCode.value })
    // Never infer payment success or write local unlocked state from order creation.
    uni.redirectTo({ url: `/pages/order-status/order-status?order_id=${encodeURIComponent(order.id)}` })
  } catch (e) {
    error.value = requestErrorMessage(e, '创建结果尚未确认，请查询本人订单或重试；重试会保留同一购买意图')
  } finally { creating.value = false }
}

function goOrders() { uni.navigateTo({ url: '/pages/orders/orders' }) }
function goCatalog() { uni.redirectTo({ url: `/pages/pricing/pricing?result_id=${encodeURIComponent(resultId.value)}` }) }
</script>

<style scoped lang="scss">
@import '@/styles/payment.scss';
</style>
