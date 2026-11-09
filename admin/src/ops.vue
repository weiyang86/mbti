<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { login, logout, session, type OpsSession } from './ops-api'
import OrdersPage from './orders.vue'
import WorkspacePage from './workspace.vue'
import ConfigPage from './config.vue'
import B4Page from './b4.vue'
import type { B4Page as B4Scope } from './b4-model'
import type { ConfigScope } from './config-contract-v1'

type Page = { id: string; name: string; group: string; code: string; description: string; access: 'access' | 'draft' | 'orders' | 'moderation' | 'systemRead' | 'systemWrite' | 'release' }
const pages: Page[] = [
  { id: 'overview', name: '经营总览', group: '工作空间', code: 'OVERVIEW', description: '查看成交、交付与用户回流，处理今天的运营待办。', access: 'access' },
  { id: 'growth', name: '渠道与传播', group: '工作空间', code: 'ACQUISITION', description: '查看四个入口的访问、测试、付费与分享回流。', access: 'access' },
  { id: 'orders', name: '订单与交付', group: '工作空间', code: 'FULFILLMENT', description: '查询订单、生成任务与体验兑换码。', access: 'orders' },
  { id: 'moderation', name: '名片治理', group: '工作空间', code: 'MODERATION', description: '处理公开内容举报，查看名片与联系方式授权统计。', access: 'moderation' },
  { id: 'ai', name: 'AI 图像工作室', group: '前台配置', code: 'IMAGE STUDIO', description: '试跑人物与风格融合、维护风格配方，查看每次生成的结果。', access: 'draft' },
  { id: 'content', name: '首页与渠道', group: '前台配置', code: 'EXPERIENCE', description: '设置用户第一眼看到的文案、分享场景和各渠道入口。', access: 'draft' },
  { id: 'catalog', name: '商品与模板', group: '前台配置', code: 'CREATIVE CATALOG', description: '管理付费套装、商品权益说明和可选视觉风格。', access: 'draft' },
  { id: 'assessment', name: '测评与人格', group: '前台配置', code: 'ASSESSMENTS', description: '维护题库、计分方向和 16 型人格说明书。', access: 'draft' },
  { id: 'retention', name: '阶段复测', group: '前台配置', code: 'RETENTION', description: '按成熟观察窗回看复测表现，管理生活阶段和回访计划。', access: 'draft' },
  { id: 'social', name: '交换与雷达', group: '前台配置', code: 'DISCOVERY', description: '设置推荐顺序、申请上限和附近人数的展示条件。', access: 'draft' },
  { id: 'ai-settings', name: 'AI 参数配置', group: '系统管理', code: 'AI CONFIGURATION', description: '管理图像模型、运行模式、网关与生成参数。', access: 'systemRead' },
  { id: 'payment-settings', name: '支付参数配置', group: '系统管理', code: 'PAYMENT SETTINGS', description: '为四个渠道分别管理收款与凭据引用。', access: 'systemRead' },
  { id: 'trade-settings', name: '交易与售后规则', group: '系统管理', code: 'TRADE POLICY', description: '设置付款期限、兑换入口与售后方式。', access: 'systemRead' },
  { id: 'release', name: '发布与日志', group: '系统管理', code: 'RELEASES', description: '核对配置差异、版本和操作记录。', access: 'systemRead' },
]
const configPage = ref<InstanceType<typeof ConfigPage> | null>(null)
const b4Page = ref<InstanceType<typeof B4Page> | null>(null)
const b4Scope = computed(() => ['ai', 'retention', 'social'].includes(pageId.value) ? pageId.value as B4Scope : null)
const configScope = computed(() => ['content', 'catalog', 'assessment'].includes(pageId.value) ? pageId.value as ConfigScope : null)
const sessionState = ref<OpsSession | null>(null)
const loading = ref(true)
const loginError = ref('')
const apiError = ref('')
const username = ref('')
const password = ref('')
const loggingIn = ref(false)
const pageId = ref(location.hash.replace(/^#\/?/, '') || 'overview')
const navOpen = ref(false)
const searchOpen = ref(false)
const query = ref('')
const drawer = ref('')
const unsaved = ref(false)
const listPage = ref(1)
const pageSize = ref(10)
const draftText = ref('')
const page = computed(() => pages.find(item => item.id === pageId.value) || pages[0]!)
const visiblePages = computed(() => pages.filter(item => sessionState.value?.capabilities[item.access]))
const groups = computed(() => [...new Set(visiblePages.value.map(item => item.group))])
const filteredPages = computed(() => visiblePages.value.filter(item => `${item.name} ${item.code}`.toLowerCase().includes(query.value.toLowerCase())))
const visiblePage = computed(() => visiblePages.value.some(item => item.id === pageId.value))

async function loadSession() {
  loading.value = true
  try { sessionState.value = await session(); apiError.value = '' }
  catch (error) { sessionState.value = null; apiError.value = error instanceof Error ? error.message : '登录状态不可用。' }
  finally { loading.value = false }
}
async function submitLogin() {
  loggingIn.value = true; loginError.value = ''
  try { sessionState.value = await login(username.value, password.value); password.value = ''; apiError.value = ''; go('overview') }
  catch (error) { loginError.value = error instanceof Error ? error.message : '登录失败。' }
  finally { loggingIn.value = false }
}
async function signOut() {
  try { await logout() } catch (error) { apiError.value = error instanceof Error ? error.message : '注销请求失败。' }
  sessionState.value = null; location.hash = ''; pageId.value = 'overview'
}
function go(id: string) {
  if (unsaved.value && !window.confirm('有尚未保存的更改，确定离开此页面吗？')) return
  pageId.value = id; location.hash = `/${id}`; navOpen.value = false; drawer.value = ''; unsaved.value = false
}
function openDrawer(title: string) { drawer.value = title }
function discardDraft() { draftText.value = ''; unsaved.value = false; drawer.value = '' }
function goBack() { window.history.back() }
function closeDraft() { if (window.confirm('放弃尚未保存的更改？')) discardDraft() }
function onPopState() {
  const next = location.hash.replace(/^#\/?/, '') || 'overview'
  if (next === pageId.value) return
  if (unsaved.value && !window.confirm('有尚未保存的更改，确定离开此页面吗？')) { history.replaceState(null, '', `#/${pageId.value}`); return }
  pageId.value = next; unsaved.value = false
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { drawer.value = ''; searchOpen.value = false; navOpen.value = false }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchOpen.value = !searchOpen.value }
}
onMounted(() => { void loadSession(); window.addEventListener('hashchange', onPopState); window.addEventListener('keydown', onKey) })
onUnmounted(() => { window.removeEventListener('hashchange', onPopState); window.removeEventListener('keydown', onKey) })
watch(visiblePage, valid => { if (!valid && sessionState.value) go(visiblePages.value[0]?.id || 'overview') })
</script>

<template>
  <div v-if="loading" class="loading-screen"><span class="spinner"></span><p>正在核验管理员会话</p></div>
  <main v-else-if="!sessionState" class="login-screen">
    <section class="login-card"><div class="brand-mark">M</div><p class="eyebrow">OPERATIONS STUDIO</p><h1>运营工作台</h1><p class="login-copy">使用 AIJ 管理员账号登录。权限由服务端会话核验。</p>
      <form @submit.prevent="submitLogin"><label>管理员账号<input v-model="username" autocomplete="username" required maxlength="120"></label><label>密码<input v-model="password" type="password" autocomplete="current-password" required maxlength="72"></label><p v-if="loginError" class="error-text" role="alert">{{ loginError }}</p><button class="primary wide-button" :disabled="loggingIn">{{ loggingIn ? '正在登录…' : '使用管理员账号登录' }}</button></form>
      <p class="quiet">AIJ 平台超级管理员与 MBTI 项目运营角色分别授权。</p>
    </section>
  </main>
  <div v-else class="app-shell" :class="{ 'nav-open': navOpen }">
    <button v-if="navOpen" class="nav-scrim" aria-label="关闭导航" @click="navOpen = false"></button>
    <aside class="sidebar"><div class="brand"><div class="brand-mark">M</div><div><b>MBTI搭子</b><small>OPERATIONS STUDIO</small></div></div><nav aria-label="主导航" class="nav-list"><template v-for="group in groups" :key="group"><p class="nav-heading">{{ group }}</p><button v-for="item in filteredPages.filter(row => row.group === group)" :key="item.id" class="nav-item" :class="{ active: pageId === item.id }" :aria-current="pageId === item.id ? 'page' : undefined" @click="go(item.id)"><span class="nav-icon">{{ item.id === 'orders' ? '▤' : item.id === 'release' ? '◷' : '◇' }}</span>{{ item.name }}</button></template></nav><div class="side-account"><div class="avatar">{{ sessionState.user.realName.slice(0, 1) || '运' }}</div><div class="account-label"><b>{{ sessionState.user.realName }}</b><small>{{ { owner: '项目运营管理员', editor: '运营编辑', support: '客服专员', reader: '只读观察员' }[sessionState.role] }}</small></div><button class="icon-button" aria-label="退出登录" title="退出登录" @click="signOut">↪</button></div></aside>
    <section class="workspace"><header class="topbar"><div class="breadcrumb"><button class="mobile-menu icon-button" aria-label="打开导航" @click="navOpen = true">☰</button><span>运营工作台</span><i>/</i><b>{{ page.name }}</b></div><div class="top-actions"><span class="environment"><i></i>服务端会话</span><button class="icon-button search-shortcut" aria-label="查找功能" @click="searchOpen = true">⌕</button><button class="outline-button" @click="configScope ? configPage?.openPreview() : b4Scope ? b4Page?.openPreview() : openDrawer('前台预览')">前台预览</button><button v-if="sessionState.capabilities.release" class="primary" disabled title="发布接口尚未接通">发布中心 · 未接通</button><button class="icon-button logout-top" aria-label="退出登录" @click="signOut">↪</button></div></header>
      <main class="content"><div v-if="apiError" class="alert error-banner" role="alert">{{ apiError }} <button class="text-button" @click="loadSession">重新连接</button></div><div class="page-heading"><div><p class="eyebrow">OPERATIONS / {{ page.code }}</p><h1>{{ page.name }}</h1><p class="description">{{ page.description }}</p></div><div class="heading-actions"><button class="outline-button" @click="goBack">返回</button><button v-if="page.id === 'ai' || page.id === 'ai-settings'" class="outline-button" disabled>图像服务未接通</button></div></div>
        <WorkspacePage v-if="(page.id === 'overview' || page.id === 'growth' || page.id === 'moderation') && visiblePage" :page="page.id" :can-export="sessionState.capabilities.export" :can-moderate="sessionState.capabilities.moderation" @navigate="go" />
        <ConfigPage v-if="configScope && visiblePage" ref="configPage" :page="configScope" @dirty="unsaved = $event" />
        <B4Page v-if="b4Scope && visiblePage" :key="b4Scope" ref="b4Page" :page="b4Scope" :can-edit="sessionState.capabilities.draft" @dirty="unsaved = $event" />
        <OrdersPage v-if="page.id === 'orders' && visiblePage" @reauthenticate="loadSession" />
        <section v-if="!['overview', 'growth', 'moderation', 'orders', 'content', 'catalog', 'assessment', 'ai', 'retention', 'social'].includes(page.id)" class="panel list-shell"><div class="list-toolbar"><label>搜索当前页面<input placeholder="搜索当前页面" aria-label="搜索当前页面"></label><select aria-label="状态筛选"><option>全部状态</option><option>待处理</option><option>已完成</option></select><span>服务未连接 · 0 条记录</span></div><div class="empty-panel"><div class="empty-icon">{{ page.id === 'release' ? '◷' : '◇' }}</div><p class="eyebrow">{{ page.code }}</p><h2>{{ page.id === 'overview' || page.id === 'growth' ? '暂无线上数据' : '此模块尚未接通业务服务' }}</h2><p>{{ page.id === 'payment-settings' ? '支付渠道未配置。不会展示商户号、回调凭据或密钥引用。' : page.id === 'moderation' ? '服务连接后仅返回匿名举报信息，不读取私人联系方式、精确位置或私有作答。' : '当前页面保留原型路由与交互位置，数据和写入操作由后续业务卡接入。' }}</p><div class="status-line"><span class="status-dot"></span> {{ page.id === 'overview' || page.id === 'growth' ? '数据接口未连接' : 'UI_CONTRACT · 等待对应业务接口' }}</div></div><div class="pager"><span>第 {{ listPage }} 页 · 0 条记录</span><div><button class="outline-button" :disabled="listPage === 1" @click="listPage = Math.max(1, listPage - 1)">上一页</button> <select v-model.number="pageSize" aria-label="每页条数"><option :value="10">10 条/页</option><option :value="20">20 条/页</option><option :value="50">50 条/页</option></select> <button class="outline-button" disabled @click="listPage++">下一页</button></div></div></section>
        <section v-if="!['overview', 'growth', 'moderation', 'orders', 'content', 'catalog', 'assessment', 'ai', 'retention', 'social'].includes(page.id)" class="panel control-panel"><div><p class="eyebrow">工作队列</p><h2>待处理事项</h2></div><div class="queue-empty"><span>✓</span><p>工作队列服务尚未接通</p></div></section>
        <p v-if="page.id === 'payment-settings'" class="security-note">支付商户和凭据引用仅对项目运营管理员授权显示；原始密钥永远不会返回浏览器。</p>
      </main><footer class="footer"><span>MBTI搭子 · 运营工作台</span><span>{{ sessionState.user.username }} · {{ sessionState.platformSuperAdmin ? 'AIJ 平台超级管理员' : '项目角色' }}</span></footer>
    </section>
    <div v-if="searchOpen" class="overlay" @click.self="searchOpen = false"><section class="dialog search-dialog" role="dialog" aria-modal="true" aria-label="查找功能"><div class="dialog-header"><div><p class="eyebrow">QUICK NAVIGATION</p><h2>查找功能</h2></div><button class="icon-button" aria-label="关闭" @click="searchOpen = false">×</button></div><input v-model="query" autofocus placeholder="输入页面名称…" aria-label="搜索页面"><div class="search-results"><button v-for="item in filteredPages" :key="item.id" @click="go(item.id); searchOpen = false"><span>{{ item.group }}</span><b>{{ item.name }}</b><small>打开 →</small></button><p v-if="filteredPages.length === 0" class="muted">没有匹配的可访问页面</p></div></section></div>
    <div v-if="drawer" class="overlay" @click.self="unsaved ? undefined : drawer = ''"><section class="dialog drawer" role="dialog" aria-modal="true" :aria-label="drawer"><div class="dialog-header"><div><p class="eyebrow">MBTI OPERATIONS</p><h2>{{ drawer }}</h2></div><button class="icon-button" aria-label="关闭" @click="unsaved ? closeDraft() : drawer = ''">×</button></div><div v-if="drawer === '编辑运营草稿'" class="drawer-body form-body"><label>草稿备注<textarea v-model="draftText" rows="5" maxlength="300" @input="unsaved = draftText.length > 0"></textarea></label><p>当前页面的业务保存接口尚未接通；内容不会提交或持久化。</p></div><div v-else class="drawer-body"><div class="preview-placeholder"><span>MBTI</span><b>前台预览服务尚未接通</b><p>预览不会创建用户历史、订单或收费记录。</p></div></div><div class="dialog-footer"><button class="outline-button" @click="drawer === '编辑运营草稿' ? discardDraft() : drawer = ''">{{ unsaved ? '放弃更改' : '返回工作台' }}</button><button v-if="drawer === '编辑运营草稿'" class="primary" disabled>保存草稿 · 接口未接通</button></div></section></div>
  </div>
</template>
