<template>
  <view class="page">
    <proto-nav />
    <view class="page-intro">
      <view class="eyebrow">HELLO, THIS IS ME / 亮名片</view>
      <view class="h1">认识我，从这张卡开始。</view>
    </view>

    <text v-if="loading" class="notice">正在读取公开名片…</text>
    <view v-if="error" class="notice warn">{{ error }}</view>

    <template v-if="shown">
      <view v-if="shown.style" class="portrait">
        <image class="portrait-img" :src="cardAsset" mode="aspectFill" />
        <view class="portrait-top">
          <text>MBTI搭子 / MY TYPE</text>
          <text>16 TYPES / 01 ME</text>
        </view>
        <view class="portrait-info">
          <view class="mbti">{{ shown.type_code }}</view>
          <view class="name">{{ buddyName }} · {{ shown.type_name }}</view>
          <view class="p">{{ declaration }}</view>
          <view v-if="shown.interests.length" class="choice-row">
            <text v-for="item in shown.interests" :key="item" class="tag">{{ item }}</text>
          </view>
          <view class="tiny" style="margin-top: 14px">AI 示例人物 · 趣味人格探索</view>
        </view>
      </view>

      <view v-else class="basic-type-card">
        <text class="span">MBTI BUDDY / 基础名片</text>
        <text class="strong">{{ shown.type_code }}</text>
        <view class="h3">{{ buddyName }} · {{ shown.type_name }}</view>
        <view class="p">{{ declaration }}</view>
        <view v-if="shown.interests.length" class="choice-row">
          <text v-for="item in shown.interests" :key="item" class="tag">{{ item }}</text>
        </view>
        <text class="small">联系方式仅在双方同意后单独交换</text>
      </view>

      <view v-if="shown.manual" class="manual-cards">
        <view v-for="item in manualCards" :key="item.no" class="manual-card">
          <text class="span">{{ item.no }}</text>
          <view>
            <view class="h3">{{ item.title }}</view>
            <view class="p">{{ item.body }}</view>
          </view>
        </view>
      </view>
      <text v-if="shown.manual" class="fine">依据当前类型的模板建议，可按真实相处调整。</text>
    </template>

    <view class="notice mt">这里只展示公开名片，不含联系方式。当前是本机公开页预览。</view>
    <view class="btn full mt" @click="goTab('/pages/discover/discover')">去交换一张 MBTI 名片</view>
  <proto-footer />
  </view>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { getPublicCard } from '@/api/cards'
import type { PublicCard } from '@/api/types-social'
import { DECLARATIONS } from '@/constants/types'
import { styleAsset } from '@/store/studio'
import { displayBuddyName, socialErrorMessage } from '@/utils/social-display'
const id = ref('')
const card = ref<PublicCard | null>(null)
const loading = ref(false)
const error = ref('')
const SAMPLE_CARD: PublicCard = {
  id: 'demo-public',
  nickname: '小禾',
  type_code: 'INFP',
  type_name: '理想收藏家',
  declaration: '温柔有自己的方向。',
  interests: ['摄影', '音乐', '散步'],
  style: 'illustration',
}
const shown = computed(() => card.value || (id.value ? null : SAMPLE_CARD))
onLoad((query) => { id.value = typeof query?.id === 'string' ? query.id : '' })
onShow(load)
async function load() {
  if (loading.value) return
  card.value = null; error.value = ''
  if (!id.value) return
  loading.value = true
  try { card.value = await getPublicCard(id.value) }
  catch (e) { error.value = socialErrorMessage(e, '公开名片读取失败，请重试') }
  finally { loading.value = false }
}
const buddyName = computed(() => displayBuddyName(shown.value?.nickname, shown.value?.id))
const declaration = computed(
  () => shown.value?.declaration || DECLARATIONS[shown.value?.type_code || ''] || '四个字母之外，还有不一样的我。',
)
const cardAsset = computed(() => styleAsset(shown.value?.style || 'illustration'))
const manualCards = computed(() => {
  const manual = shown.value?.manual
  if (!manual) return []
  return [
    { no: '01', title: '如何给我充电', body: manual.recharge },
    { no: '02', title: '怎样和我沟通', body: manual.communication },
    { no: '03', title: '我在意的相处细节', body: manual.care },
  ]
})
function goTab(url: string) { uni.switchTab({ url, fail: () => uni.reLaunch({ url }) }) }
</script>
<style scoped lang="scss">
.h3 {
  font-weight: 700;
}
.portrait {
  position: relative;
  overflow: hidden;
}
.portrait .tag {
  font-size: 10px;
}
.portrait .tiny {
  font-size: 8px;
}
.portrait-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
.manual-card {
  display: flex;
  align-items: flex-start;
  gap: 15px;
  padding: 20px 16px;
  background: white;
  border: 1px solid #e8e0ef;
  border-radius: 16px;
}
.manual-card .span {
  font-size: 14px;
  color: #b49aca;
}
.manual-card .h3 {
  font-size: 15px;
  margin: 0 0 6px;
}
.manual-card .p {
  font-size: 13px;
  line-height: 1.8;
  margin: 0;
}
</style>
