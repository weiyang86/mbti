<template>
  <view v-if="visible" class="demo-strip">
    <text>{{ DEMO_COPY.badge }}</text>
    <text class="textbtn" @click="show">{{ DEMO_COPY.link }}</text>
  </view>
</template>
<script setup lang="ts">
import { DEMO_COPY } from '@/constants/copy'

/** 开发环境默认展示；生产构建需显式 VITE_DEMO_STRIP=true 才显示 */
const visible = import.meta.env.DEV || import.meta.env.VITE_DEMO_STRIP === 'true'

function show() { uni.showToast({ title: DEMO_COPY.stateToast, icon: 'none' }) }
</script>
