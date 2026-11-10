<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { configApi, pageCategories, type Category, type ConfigApi, type Projection, type VersionRecord } from './config-api'
import { OpsApiError } from './ops-api'
const props = defineProps<{ page: string; api?: ConfigApi }>()
const emit = defineEmits<{ dirty: [value: boolean] }>()
const api = props.api ?? configApi
const draft = ref<Projection | null>(null), published = ref<Projection | null>(null)
const selected = ref<Category>('content'), input = ref(''), baseline = ref(''), busy = ref(false), error = ref(''), notice = ref('')
const records = ref<VersionRecord[]>([]), drawer = ref(''), detail = ref<unknown>(null), dialog = ref<HTMLElement | null>(null)
let epoch = 0, opener: HTMLElement | null = null
const categories = computed(() => (pageCategories[props.page] ?? []).filter(key => draft.value && Object.hasOwn(draft.value.categories, key)))
const dirty = computed(() => input.value !== baseline.value)
const canPublish = computed(() => !!draft.value?.authorization.canPublish && !!published.value?.authorization.canPublish)
const json = (value: unknown) => JSON.stringify(value, null, 2)
watch(dirty, value => emit('dirty', value))
function select(key: Category) {
  if (dirty.value && !window.confirm('放弃尚未保存的类别输入？')) return
  selected.value = key; input.value = json(draft.value?.categories[key] ?? null); baseline.value = input.value
}
function clear() { draft.value = null; published.value = null; records.value = []; detail.value = null; drawer.value = '' }
function failure(reason: unknown) {
  const status = reason instanceof OpsApiError ? reason.status : 0
  error.value = `${status ? `HTTP ${status} · ` : ''}${reason instanceof Error ? reason.message : '读取失败。'}${status === 409 ? ' 请重新读取并核对差异后重试；不会自动覆盖。' : ''}`
  clear() // Never retain an authorized/stale projection after revocation, disable, missing installation or outage.
}
async function load(discard = true) {
  if (busy.value || discard && dirty.value && !window.confirm('重新读取会放弃尚未保存的输入，继续吗？')) return
  busy.value = true; error.value = ''; const token = ++epoch; clear()
  try {
    const [d, p] = await Promise.all([api.read('draft'), api.read('published')])
    if (token !== epoch) return
    if (d.expectedVersion !== p.expectedVersion || d.source.projectId !== p.source.projectId || d.source.environment !== p.source.environment) throw new OpsApiError(409, '读取期间发布版本已变化。')
    draft.value = d; published.value = p
    if (!categories.value.includes(selected.value)) selected.value = categories.value[0] ?? 'content'
    input.value = json(d.categories[selected.value] ?? null); baseline.value = input.value
  } catch (reason) { if (token === epoch) failure(reason) }
  finally { if (token === epoch) busy.value = false }
}
async function save() {
  if (!draft.value?.authorization.canSaveDraft || busy.value || !categories.value.includes(selected.value)) return
  let value: unknown
  try { value = JSON.parse(input.value) } catch { error.value = 'JSON 格式无效，尚未发送。'; return }
  busy.value = true; error.value = ''; notice.value = ''; const token = epoch
  try {
    const saved = await api.save(selected.value, value, draft.value.expectedDraftVersion)
    if (token !== epoch) return
    input.value = json(saved.categories[selected.value]); baseline.value = input.value
    clear(); notice.value = `草稿已保存 · 修订 ${saved.expectedDraftVersion}；尚未发布。`
    busy.value = false; await load(false) // Recheck live version and current authorization; discard the previous published projection.
  } catch (reason) { if (token === epoch) failure(reason) }
  finally { if (token === epoch) busy.value = false }
}
async function open(title: string) {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  drawer.value = title; await nextTick(); dialog.value?.focus()
}
function close() { drawer.value = ''; opener?.focus() }
async function history(kind: 'versions' | 'audit') {
  if (!canPublish.value || busy.value) return
  busy.value = true; error.value = ''; const token = epoch
  try { const rows = await api[kind](); if (token !== epoch) return; records.value = rows; detail.value = null; await open(kind === 'versions' ? '发布版本' : '操作日志') }
  catch (reason) { if (token === epoch) failure(reason) }
  finally { if (token === epoch) busy.value = false }
}
async function version(target: number) {
  if (!canPublish.value || busy.value) return
  busy.value = true; const token = epoch
  try { const result = await api.version(target); if (token === epoch) detail.value = result }
  catch (reason) { if (token === epoch) failure(reason) }
  finally { if (token === epoch) busy.value = false }
}
async function commit(target?: number) {
  if (!canPublish.value || busy.value || dirty.value || !draft.value || !published.value) return
  if (!window.confirm(target ? `将版本 ${target} 的内容发布为新版本？未发布草稿会保留。` : `发布草稿修订 ${draft.value.expectedDraftVersion}？`)) return
  busy.value = true; error.value = ''; notice.value = ''; const token = epoch
  try {
    const result = target ? await api.rollback(target, published.value.expectedVersion) : await api.publish(published.value.expectedVersion, draft.value.expectedDraftVersion)
    if (token !== epoch) return
    clear(); notice.value = `已${target ? '回滚并创建' : '发布'}版本 ${result.version} · 审计 ${result.auditLogId}`
    busy.value = false; await load(false) // Explicitly discard every old projection; no client cache survives publication/rollback.
  } catch (reason) { if (token === epoch) failure(reason) }
  finally { if (token === epoch) busy.value = false }
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); close() }
  if (event.key !== 'Tab') return
  const nodes = dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')
  if (!nodes?.length) { event.preventDefault(); return }
  const first = nodes[0]!, last = nodes[nodes.length - 1]!
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) { event.preventDefault(); first.focus() }
}
watch(() => props.page, () => { epoch++; busy.value = false; input.value = ''; baseline.value = ''; notice.value = ''; void load(false) }, { immediate: true })
onUnmounted(() => { epoch++; clear(); emit('dirty', false) })
</script>

<template>
  <section class="panel config-server" aria-label="服务端配置" :aria-busy="busy">
    <div class="config-card-head"><div><p class="eyebrow">配置管理 · 候选版</p><h2>草稿与已发布配置</h2><p>仅服务端保存成功后成为草稿。H5 公开读取待人工批准，当前关闭。</p></div><button class="outline-button" :disabled="busy" @click="load()">{{ busy ? '正在读取…' : '重新读取配置' }}</button></div>
    <p v-if="error" role="alert" class="error-text">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="draft && published">
      <p>项目 {{ draft.source.projectId }} · {{ draft.source.environment }} · 已发布 {{ published.expectedVersion }} · 草稿修订 {{ draft.expectedDraftVersion }}</p>
      <p>服务端差异：{{ draft.diff.length ? draft.diff.join('、') : '无差异' }} · {{ draft.status }}</p>
      <label>配置类别<select :value="selected" :disabled="busy" aria-label="服务端配置类别" @change="select(($event.target as HTMLSelectElement).value as Category)"><option v-for="key in categories" :key="key" :value="key">{{ key }}</option></select></label>
      <p v-if="!categories.length">此账号无权读取本页类别。</p>
      <div v-else class="server-columns">
        <label>草稿完整对象<textarea v-model="input" rows="16" aria-label="服务端类别草稿" :disabled="busy || !draft.authorization.canSaveDraft" spellcheck="false"></textarea><small>按候选 shape 保存一个完整类别；服务端严格校验，不支持凭据、提示词或额外字段。</small></label>
        <div><b>已发布（只读）</b><pre>{{ json(published.categories[selected] ?? null) }}</pre></div>
      </div>
      <div class="config-actions"><button class="primary" :disabled="busy || !categories.length || !dirty || !draft.authorization.canSaveDraft" @click="save">保存此类别草稿</button><button v-if="canPublish" class="primary" :disabled="busy || dirty || !draft.diff.length" @click="commit()">发布已核对草稿</button><button v-if="canPublish" class="outline-button" :disabled="busy" @click="history('versions')">发布版本与回滚</button><button v-if="canPublish" class="outline-button" :disabled="busy" @click="history('audit')">操作日志</button></div>
      <p v-if="!canPublish">发布、回滚及历史抽屉需要服务端核验平台超管和 secret 权限。</p>
      <details><summary>待人审问题</summary><pre>{{ json(draft.unknowns) }}</pre></details>
    </template>
    <p v-else-if="!busy">配置当前不可用；没有本机持久化或模拟成功。</p>
    <div v-if="drawer" class="config-overlay" @click.self="close"><section ref="dialog" class="config-sheet" role="dialog" aria-modal="true" :aria-label="drawer" tabindex="-1" @keydown="keydown"><header><h2>{{ drawer }}</h2><button class="outline-button" @click="close">关闭</button></header><div class="config-sheet-body"><p v-if="!records.length">服务端返回空列表。</p><article v-for="row in records" :key="`${row.event}-${row.id ?? row.version}`"><p>{{ row.event }} · v{{ row.version }} · {{ row.createdAt }} · {{ row.categories.join('、') }} · 审计 {{ row.auditLogId }}</p><template v-if="drawer === '发布版本'"><button class="outline-button" :disabled="busy" @click="version(row.version)">查看版本 {{ row.version }}</button><button v-if="published && row.version < published.expectedVersion" class="outline-button" :disabled="busy || dirty" @click="commit(row.version)">回滚版本 {{ row.version }} 为新版本</button></template></article><pre v-if="detail">{{ json(detail) }}</pre></div></section></div>
  </section>
</template>

<style scoped>
.config-server { padding: 24px; margin-bottom: 24px; }
.config-server label { display: grid; gap: 10px; }
.server-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 20px 0; }
.config-server textarea { width: 100%; box-sizing: border-box; font: 13px/1.6 monospace; }
.config-server pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 500px; overflow: auto; font-size: 13px; }
.config-server article { padding: 12px 0; border-bottom: 1px solid #ddd; }
@media(max-width: 760px) { .server-columns { grid-template-columns: 1fr; } .config-server { padding: 16px; } }
</style>
