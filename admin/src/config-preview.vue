<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { channels, previewPages, type Art, type Channel, type PreviewPage, type UiConfiguration } from './config-model'
import editorial from './config-assets/editorial.webp'
import illustration from './config-assets/illustration.webp'
import game from './config-assets/game.webp'
const props = defineProps<{ draft: UiConfiguration; reference: UiConfiguration; published: UiConfiguration | null; initialPage: PreviewPage; initialChannel: Channel; initialType: string; initialStyle: Art; initialPlan: string }>()
const mode = ref('draft'), route = ref(props.initialPage), channel = ref(props.initialChannel), type = ref(props.initialType), style = ref(props.initialStyle), plan = ref(props.initialPlan)
const c = computed(() => mode.value === 'draft' ? props.draft : mode.value === 'reference' ? props.reference : props.published)
const persona = computed(() => c.value?.personas[type.value])
const activeStyles = computed(() => c.value?.styles.filter(s => s.on).sort((a, b) => a.order - b.order) ?? [])
const activeShop = computed(() => c.value?.shop.filter(s => s.on) ?? [])
const assets = { editorial, illustration, game }
const selectedStyle = computed(() => activeStyles.value.find(s => s.id === style.value) ?? activeStyles.value[0])
watch(activeShop, items => { if (!items.some(p => p.id === plan.value)) plan.value = items[0]?.id ?? '' }, { immediate: true })
watch(activeStyles, items => { if (!items.some(s => s.id === style.value)) style.value = items[0]?.id ?? 'illustration' }, { immediate: true })
</script>

<template>
  <div class="config-preview-controls">
    <label>预览配置版本<select v-model="mode" aria-label="预览配置版本"><option value="draft">内存草稿效果</option><option value="reference">原稿参考效果 · 非线上</option><option value="published">已发布 / 线上 · 未接通</option></select></label>
    <label>预览页面<select v-model="route" aria-label="预览页面"><option v-for="(label, key) in previewPages" :key="key" :value="key">{{ label }}</option></select></label>
    <label>预览渠道<select v-model="channel" aria-label="预览渠道"><option v-for="ch in channels" :key="ch.id" :value="ch.id">{{ ch.label }}</option></select></label>
    <label>预览人格类型<select v-model="type" aria-label="预览人格类型"><option v-for="(_, code) in reference.personas" :key="code" :value="code">{{ code }}</option></select></label>
  </div>
  <p class="config-notice">{{ mode === 'draft' ? '内存草稿预览 · 刷新即丢失 · 持久化不可用' : mode === 'reference' ? '静态原稿参考 · 不代表当前已发布版本' : '已发布配置服务未接通 · 无法核验线上效果' }}。预览不创建个人历史、订单或权益。</p>
  <div v-if="!c" class="config-unavailable">线上配置不可得，等待 C2 的已发布读取与版本证据。</div>
  <div v-else class="config-phone" aria-label="手机前台布局预览">
    <header><b>M / MBTI搭子</b><small>{{ c.channels[channel].name }}</small></header>
    <div class="config-phone-body">
      <template v-if="route === 'home'">
        <small class="config-kicker">{{ c.channels[channel].badge }}</small><h2>{{ c.content.headline }}<em>{{ c.content.accent }}</em></h2><p>{{ c.content.sub }}</p>
        <div v-if="selectedStyle" class="config-mobile-art"><img :src="assets[selectedStyle.art]" alt="原稿视觉素材"><b>{{ type }}</b></div><button class="primary" disabled>{{ c.content.cta }} · 预览</button>
      </template>
      <template v-else-if="route === 'pricing'">
        <small class="config-kicker">为我的 MBTI 留一张主角卡</small><h2>{{ c.content.moments }}</h2><p>{{ c.content.avatar }}</p><p>{{ c.content.meet }}</p>
        <label v-for="p in activeShop" :key="p.id" class="config-price-option"><input v-model="plan" type="radio" :value="p.id" name="preview-package"><b>{{ p.title }} · ¥{{ (p.cents / 100).toFixed(2) }}</b><small>{{ p.desc }}</small></label>
        <button class="primary" disabled>购买 · 预览中不可下单</button><p class="muted">下单价与可售条件由服务端决定，服务端校验 NOT_RUN。</p>
      </template>
      <template v-else-if="route === 'result'">
        <small class="config-kicker">最近四周的你 · 趣味倾向参考</small><strong class="config-type-code">{{ type }}</strong><h2>{{ persona?.title }}</h2><p>{{ persona?.quote }}</p>
        <section v-for="(label, key) in { recharge: '如何给我充电', communication: '怎样和我沟通', care: '我在意的相处细节' }" :key="key" class="config-manual"><h3>{{ label }}</h3><p>{{ persona?.[key] }}</p></section>
      </template>
      <template v-else-if="route === 'create'">
        <h2>形象工作台</h2><label>选择视觉风格<select v-model="style" aria-label="预览视觉风格"><option v-for="s in activeStyles" :key="s.id" :value="s.id">{{ s.title }}</option></select></label>
        <div v-if="selectedStyle" class="config-mobile-art"><img :src="assets[selectedStyle.art]" :alt="selectedStyle.title"><b>{{ type }}</b></div><p>原稿素材示例 · 海报与同款头像</p><button class="primary" disabled>生成服务未接通</button>
      </template>
      <template v-else-if="route === 'share'"><h2>分享配文</h2><strong class="config-type-code">{{ type }}</strong><p>{{ c.content.caption.replaceAll('{type}', type) }}</p><button class="outline-button" disabled>分享 · 预览</button></template>
      <template v-else-if="route === 'test-intro' || route === 'test'"><small class="config-kicker">12 题 / 最近四周 / 多数票</small><h2>{{ route === 'test-intro' ? '记录此刻的自己' : c.quiz.questions[0]?.prompt }}</h2><p v-if="route === 'test-intro'">四个维度，各三题。趣味倾向参考。</p><template v-else><p v-for="o in c.quiz.questions[0]?.options" :key="o.id" class="config-manual">{{ o.label }}</p></template><button class="primary" disabled>作答仅在独立试算中进行</button></template>
      <template v-else><h2>{{ previewPages[route] }}</h2><p>仅展示渠道落地位置。该页真实数据与交互不在 B3 预览中读取。</p><p class="muted">没有载入用户记录或名片。</p></template>
    </div>
    <footer>布局预览 · {{ mode === 'draft' ? '内存草稿' : '原稿参考' }}</footer>
  </div>
</template>
