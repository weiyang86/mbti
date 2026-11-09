<template>
  <view class="page commerce-page">
    <text class="heading">商品目录</text>
    <text class="notice">当前为受控测试商品与测试价格，可创建待支付订单。基础测评结果仍可免费查看。</text>
    <button class="btn-secondary" @click="goOrders">我的订单与权益</button>

    <text class="section">选择本人的结果</text>
    <text v-if="resultsLoading" class="muted">正在读取结果…</text>
    <text v-else-if="resultsError" class="error">{{ resultsError }}</text>
    <template v-else>
      <picker v-if="results.length" :range="results" range-key="label" :value="selectedIndex" @change="selectResult">
        <view class="btn-secondary">{{ selectedResult?.label || '请选择结果' }} ▾</view>
      </picker>
      <text v-else class="notice">还没有结果，请先测评或选择类型。</text>
      <text v-if="selectedResult" class="identifier">结果编号：{{ selectedResult.id }}</text>
      <text v-if="results.length === 50" class="notice">当前可选最近 50 条；更早结果可从对应结果页进入商品。</text>
    </template>
    <button v-if="!results.length && !resultsLoading" class="btn-secondary mt" @click="goHome">返回首页</button>

    <text v-if="loading" class="notice">正在读取商品…</text>
    <text v-else-if="error" class="error">{{ error }}</text>
    <text v-else-if="!products.length" class="notice">当前没有商品。</text>
    <view v-for="product in products" :key="product.code" class="card mt">
      <text class="section">{{ product.name }}</text>
      <text class="muted line">{{ product.description }}</text>
      <text class="price">{{ formatMoney(product.amount, product.currency) }}</text>
      <text class="notice">受控测试价格</text>
      <text v-for="highlight in product.highlights" :key="highlight" class="line">{{ highlight }}</text>
      <text v-if="!product.saleable" class="notice">暂不可售{{ product.unavailable_reason ? `（${product.unavailable_reason}）` : '' }}</text>
      <button class="btn-primary mt" :disabled="!product.saleable || !selectedResult || !!resultsError" @click="checkout(product)">{{ product.saleable ? '查看并创建测试订单' : '暂不可售' }}</button>
    </view>
    <button class="btn-secondary mt" :disabled="loading || resultsLoading" @click="load">刷新商品与结果</button>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { listProducts, type PaymentProduct } from '@/api/payment'
import { getResult, listResults } from '@/api/results'
import { requestErrorMessage } from '@/api/client'
import { formatMoney } from '@/utils/payment-display'

const products = ref<PaymentProduct[]>([])
const results = ref<{ id: string; label: string }[]>([])
const selectedId = ref('')
const loading = ref(false)
const resultsLoading = ref(false)
const error = ref('')
const resultsError = ref('')
const selectedIndex = computed(() => results.value.findIndex((item) => item.id === selectedId.value))
const selectedResult = computed(() => results.value.find((item) => item.id === selectedId.value))

onLoad((q) => { selectedId.value = (q?.result_id as string) || '' })
onShow(load)

async function load() {
  await Promise.all([loadProducts(), loadResults()])
}

async function loadProducts() {
  if (loading.value) return
  loading.value = true
  products.value = []
  error.value = ''
  try { products.value = (await listProducts()).items }
  catch (e) { error.value = requestErrorMessage(e, '读取商品失败，请确认在线服务后重试') }
  finally { loading.value = false }
}

async function loadResults() {
  if (resultsLoading.value) return
  resultsLoading.value = true
  resultsError.value = ''
  results.value = []
  try {
    const response = await listResults({ limit: 50 })
    results.value = response.items.map((item) => ({ id: item.id, label: `${item.type_code} · ${item.submitted_at.slice(0, 10)}` }))
    // A direct result-page entry may refer to a result older than this list window.
    if (selectedId.value && !results.value.some((item) => item.id === selectedId.value)) {
      const owned = await getResult(selectedId.value)
      results.value.unshift({ id: owned.id, label: `${owned.type_code} · ${owned.submitted_at.slice(0, 10)}` })
    }
    if (!selectedId.value) selectedId.value = results.value[0]?.id || ''
  } catch (e) { resultsError.value = requestErrorMessage(e, '读取本人结果失败，请重试') }
  finally { resultsLoading.value = false }
}

function selectResult(e: { detail: { value: string | number } }) {
  selectedId.value = results.value[Number(e.detail.value)]?.id || ''
}

function checkout(product: PaymentProduct) {
  if (!product.saleable || !selectedResult.value || resultsError.value) return
  uni.navigateTo({ url: `/pages/unlock/unlock?result_id=${encodeURIComponent(selectedId.value)}&product_code=${encodeURIComponent(product.code)}` })
}
function goOrders() { uni.navigateTo({ url: '/pages/orders/orders' }) }
function goHome() { uni.reLaunch({ url: '/pages/index/index' }) }
</script>

<style scoped lang="scss">
@import '@/styles/payment.scss';
</style>
