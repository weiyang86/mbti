<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { exportOrders, listOrders, OpsApiError, saveOrdersCsv } from './ops-api'
import { orderStatus, orderTime } from './ops-order'
import type { OrderFilters, OrderPage } from './ops-orders-collection'
const props = defineProps<{ permissions: string[] }>()
const emit = defineEmits<{ detail: [id: string]; reauthenticate: [] }>()
const q = ref(''), status = ref(''), product = ref(''), from = ref(''), to = ref(''), limit = ref('20')
const state = ref('loading'), error = ref(''), exportState = ref(''), exportError = ref('')
const data = ref<OrderPage | null>(null), cursors = ref<(string | undefined)[]>([undefined]), page = ref(0)
const canExport = computed(() => ['mbti:ops:access', 'mbti:ops:export'].every(code => props.permissions.includes(code)))
const filters = (): OrderFilters => ({ q: q.value.trim(), status: status.value, product_code: product.value.trim(), from: from.value, to: to.value, limit: limit.value })
const applied = ref<OrderFilters>({ limit: '20' })
let version = 0, exportVersion = 0
function message(e: unknown) {
  const status = e instanceof OpsApiError ? e.status : 0
  return status === 401 ? '登录已失效，请重新核验登录。' : status === 403 ? '服务端拒绝操作，请核对订单读取或导出权限。' : status === 404 ? '订单服务未找到。' : status === 422 ? '筛选或游标无效，或导出超过5000笔；请检查日期、缩小范围后重新查询。' : status >= 500 ? '订单服务暂不可用，请重试。' : e instanceof OpsApiError ? e.message : '订单请求失败，请重试。'
}
async function load() {
  const current = ++version
  data.value = null; state.value = 'loading'; error.value = ''; exportState.value = ''; exportError.value = ''; exportVersion++
  try {
    const result = await listOrders({ ...applied.value, cursor: cursors.value[page.value] })
    if (current !== version) return
    data.value = result; state.value = 'success'
  } catch (e) { if (current !== version) return; state.value = e instanceof OpsApiError && e.status === 401 ? 'unauthenticated' : 'error'; error.value = message(e) }
}
async function search() {
  applied.value = filters(); page.value = 0; cursors.value = [undefined]; await load()
}
async function next() {
  if (!data.value?.next_cursor) return
  cursors.value[page.value + 1] = data.value.next_cursor; page.value++; await load()
}
async function previous() { if (page.value > 0) { page.value--; await load() } }
async function download() {
  if (!canExport.value || !data.value || exportState.value === 'loading') return
  const current = ++exportVersion
  exportState.value = 'loading'; exportError.value = ''
  try {
    // Export the complete applied filter, from its beginning, independent of the viewed page.
    const csv = await exportOrders(applied.value)
    if (current !== exportVersion || !canExport.value) return
    saveOrdersCsv(csv); exportState.value = 'success'
  } catch (e) { if (current !== exportVersion) return; exportState.value = 'error'; exportError.value = message(e) }
}
watch(canExport, () => { exportVersion++; exportState.value = ''; exportError.value = '' })
onMounted(load)
onBeforeUnmount(() => { version++; exportVersion++ })
</script>
<template>
  <section class="panel order-list-contract" aria-label="订单列表" :aria-busy="state === 'loading'">
    <div class="order-section-heading"><div><h2>订单列表</h2><p class="muted">持久化订单快照 · 创建时间、订单号降序。详情读取可修复支付状态；刷新列表查看更新。</p></div><button class="outline-button" :disabled="!canExport || !data || exportState === 'loading'" :title="canExport ? '最多5000笔，同一已应用筛选的全部订单' : '当前会话缺少 mbti:ops:access 或 mbti:ops:export'" @click="download">{{ exportState === 'loading' ? '导出中…' : '导出当前筛选 CSV' }}</button></div>
    <form class="order-list-filters" @submit.prevent="search">
      <label>订单号 / 结果编号<input v-model="q" type="search" maxlength="128" autocomplete="off" placeholder="精确编号；不搜索游客资料"></label>
      <label>状态<select v-model="status" aria-label="订单状态筛选"><option value="">全部状态</option><option value="pending">待支付 pending</option><option value="paid">已支付 paid</option><option value="failed">支付失败 failed</option></select></label>
      <label>商品编码<input v-model="product" maxlength="64" placeholder="精确商品编码"></label>
      <label>从（UTC）<input v-model="from" type="date" :max="new Date().toISOString().slice(0, 10)"></label><label>至（UTC，含）<input v-model="to" type="date" :max="new Date().toISOString().slice(0, 10)"></label>
      <label>每页<select v-model="limit" aria-label="订单每页条数"><option value="10">10 条</option><option value="20">20 条</option><option value="50">50 条</option><option value="100">100 条</option></select></label>
      <button class="primary" :disabled="state === 'loading'">应用筛选</button>
    </form>
    <p class="muted">日期同时填写，最多366天；按 UTC 自然日筛选，时间显示为北京时间。编辑筛选后需点击应用；CSV 使用已应用筛选，最多5000笔，超限不下载部分数据。列表没有渠道归因字段。</p>
    <p v-if="exportError" role="alert">{{ exportError }}</p><p v-else-if="exportState === 'success'" role="status">CSV 已交给浏览器下载。</p>
    <div v-if="state === 'loading'" class="order-state" role="status"><span class="spinner" aria-hidden="true"></span><h3>正在读取订单列表</h3></div>
    <div v-else-if="error" class="order-state order-state-error" role="alert"><h3>{{ error }}</h3><button v-if="state === 'unauthenticated'" class="primary" @click="emit('reauthenticate')">重新核验登录</button><button v-else class="outline-button" @click="search">重新查询</button></div>
    <template v-else-if="data">
      <div v-if="data.items.length" class="order-table-scroll"><table class="order-table"><caption class="sr-only">已应用筛选的订单</caption><thead><tr><th scope="col">订单 / 结果编号</th><th scope="col">商品</th><th scope="col">金额（分 + 币种）</th><th scope="col">状态 / 权益</th><th scope="col">创建时间（北京时间）</th><th scope="col">详情</th></tr></thead><tbody><tr v-for="row in data.items" :key="row.id"><td class="order-mono">{{ row.id }}<br>{{ row.result_id }}</td><td>{{ row.product_code }}</td><td>{{ row.amount }} 分 · {{ row.currency }}</td><td>{{ orderStatus(row.status) }} · {{ row.status }}<br>{{ row.unlocked ? '已解锁' : '未解锁' }}</td><td>{{ orderTime(row.created_at) }}</td><td><button class="text-button" :aria-label="`查看订单 ${row.id}`" @click="emit('detail', row.id)">详情</button></td></tr></tbody></table></div>
      <div v-else class="order-state" role="status"><h3>当前筛选没有订单</h3><p>可调整精确编号、状态或日期后重新查询。</p></div>
      <div class="pager"><span>第 {{ page + 1 }} 页 · 本页 {{ data.items.length }} 笔</span><div><button class="outline-button" :disabled="page === 0" @click="previous">上一页</button><button class="outline-button" :disabled="!data.next_cursor" @click="next">下一页</button></div></div>
    </template>
  </section>
</template>
