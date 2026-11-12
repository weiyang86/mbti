<template>
  <view class="showcase">
    <view class="scene-tabs">
      <view
        v-for="s in SCENE_TABS"
        :key="s.key"
        class="scene-tab"
        :class="{ active: sceneTab === s.key }"
        @click="pickScene(s.key)"
      >
        <text>{{ s.label }}</text>
      </view>
    </view>

    <view class="preview-card">
      <template v-if="sceneTab === 'moments'">
        <view class="pv-head">
          <image class="pv-avatar" :src="previewAsset" mode="aspectFill" />
          <view class="pv-head-main">
            <text class="pv-name">{{ nickname }}</text>
            <text class="pv-mock">{{ typeName }} · 朋友圈效果预览 · 未发布</text>
          </view>
        </view>
        <text class="pv-quote">同样是 {{ typeCode || 'MBTI' }}，我也有自己的主角感。✦</text>
        <view class="pv-img-wrap">
          <image class="pv-img" :src="previewAsset" mode="widthFix" />
          <view class="pv-overlay">
            <text class="pv-type">{{ typeCode || 'MBTI' }}</text>
            <text class="pv-type-name">{{ nickname }} / {{ typeName }}</text>
          </view>
        </view>
        <text class="pv-note">AI 示例人物</text>
      </template>

      <template v-else-if="sceneTab === 'avatar'">
        <view class="avatar-wrap">
          <image class="avatar-round" :src="previewAsset" mode="aspectFill" />
        </view>
        <text class="pv-quote centered">头像也要有我的 MBTI 气质。</text>
        <text class="pv-sub centered">同款 1:1 头像，可单独下载。</text>
        <text class="pv-note centered">AI 虚构人物样例</text>
      </template>

      <template v-else>
        <view class="card-tilt">
          <text class="mc-kicker">HELLO, I'M</text>
          <text class="mc-type">{{ typeCode || 'MBTI' }}</text>
          <text class="mc-name">{{ nickname }}</text>
          <text class="mc-line">{{ declaration }}</text>
          <view class="mc-tags">
            <text class="mc-tag">{{ typeName }}</text>
            <text class="mc-tag">{{ styleLabel }}</text>
          </view>
        </view>
        <text class="pv-quote centered">初次见面，亮一下我的 MBTI 名片。</text>
        <text class="pv-note centered">不含联系方式</text>
      </template>
    </view>

    <view class="format-tabs">
      <view
        v-for="f in STUDIO_STYLES"
        :key="f.key"
        class="format-tab"
        :class="{ active: styleTab === f.key }"
        @click="pickStyle(f.key)"
      >
        <text>{{ f.label }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { DECLARATIONS } from '@/constants/types'
import { STUDIO_STYLES, studio, styleAsset, type StyleKey } from '@/store/studio'

type SceneKey = 'moments' | 'avatar' | 'meet'

const props = defineProps<{
  typeCode: string
  typeName: string
  scene?: SceneKey
}>()

const emit = defineEmits<{
  (e: 'update:scene', value: SceneKey): void
}>()

const SCENE_TABS: { key: SceneKey; label: string }[] = [
  { key: 'moments', label: '发朋友圈' },
  { key: 'avatar', label: '换同款头像' },
  { key: 'meet', label: '见面亮名片' },
]

const sceneTab = ref<SceneKey>(props.scene || 'moments')
const styleTab = ref<StyleKey>(studio.style)

const previewAsset = computed(() => styleAsset(styleTab.value))
const styleLabel = computed(
  () => STUDIO_STYLES.find((s) => s.key === styleTab.value)?.label || '日常杂志',
)
const nickname = computed(() => studio.nickname || '小禾')
const declaration = computed(
  () => DECLARATIONS[props.typeCode] || '四个字母之外，还有不一样的我。',
)

function pickScene(key: SceneKey) {
  sceneTab.value = key
  emit('update:scene', key)
}

function pickStyle(key: StyleKey) {
  styleTab.value = key
}
</script>

<style scoped lang="scss">
.showcase {
  display: block;
}

.scene-tabs,
.format-tabs {
  display: flex;
  gap: 14rpx;
  margin-top: 24rpx;
}
.scene-tab,
.format-tab {
  flex: 1;
  text-align: center;
  padding: 18rpx 8rpx;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.7);
  color: #7c6f96;
  font-size: 22rpx;
  border: 2rpx solid transparent;
  transition: background 0.18s ease, color 0.18s ease;
}
.scene-tab.active,
.format-tab.active {
  background: #6c4cf3;
  color: #fff;
}

.preview-card {
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: 26rpx;
  background: #fff;
  border: 2rpx solid #e9e3f1;
}
.pv-head {
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.pv-avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  flex: none;
  overflow: hidden;
}
/* 素材是 2:3 竖图，圆形/方形裁切时对齐画面上方，避免切掉头部 */
.pv-avatar :deep(div) {
  background-position: 50% 12% !important;
}
.pv-head-main {
  display: flex;
  flex-direction: column;
}
.pv-name {
  font-size: 26rpx;
  font-weight: 700;
  color: #292630;
}
.pv-mock {
  font-size: 19rpx;
  color: #a398af;
  margin-top: 2rpx;
}
.pv-quote {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #3f3552;
  line-height: 1.6;
}
.pv-sub {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #7c6f96;
  line-height: 1.6;
}
.pv-quote.centered,
.pv-sub.centered,
.pv-note.centered {
  text-align: center;
}
.pv-img-wrap {
  position: relative;
  margin-top: 16rpx;
  border-radius: 20rpx;
  overflow: hidden;
}
.pv-img {
  width: 100%;
  display: block;
}
.pv-overlay {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 24rpx;
  background: linear-gradient(180deg, rgba(36, 22, 62, 0), rgba(36, 22, 62, 0.85));
  display: flex;
  flex-direction: column;
}
.pv-type {
  font-size: 64rpx;
  font-weight: 800;
  color: #fff;
  line-height: 1;
}
.pv-type-name {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.9);
}
.pv-note {
  display: block;
  margin-top: 12rpx;
  font-size: 18rpx;
  color: #a398af;
}

.avatar-wrap {
  display: flex;
  justify-content: center;
  padding: 28rpx 0 20rpx;
}
.avatar-round {
  width: 300rpx;
  height: 300rpx;
  border-radius: 50%;
  border: 8rpx solid #f2ecff;
  background: #f2ecff;
  overflow: hidden;
}
.avatar-round :deep(div) {
  background-position: 50% 12% !important;
}

.card-tilt {
  width: 84%;
  margin: 24rpx auto 20rpx;
  padding: 34rpx 30rpx;
  border-radius: 26rpx;
  background: linear-gradient(150deg, #211a36, #3a2c58 60%, #4b3570);
  box-shadow: 0 18rpx 38rpx rgba(33, 26, 54, 0.28);
  transform: rotate(-3deg);
}
.mc-kicker {
  display: block;
  font-size: 18rpx;
  letter-spacing: 3rpx;
  color: rgba(255, 255, 255, 0.55);
}
.mc-type {
  display: block;
  margin-top: 14rpx;
  font-size: 64rpx;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 2rpx;
  color: #dfff8b;
}
.mc-name {
  display: block;
  margin-top: 12rpx;
  font-size: 28rpx;
  font-weight: 700;
  color: #fff;
}
.mc-line {
  display: block;
  margin-top: 14rpx;
  font-size: 22rpx;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.72);
}
.mc-tags {
  display: flex;
  gap: 12rpx;
  margin-top: 20rpx;
}
.mc-tag {
  font-size: 18rpx;
  color: #e7ddff;
  border: 2rpx solid rgba(255, 255, 255, 0.28);
  border-radius: 999rpx;
  padding: 6rpx 16rpx;
}
</style>
