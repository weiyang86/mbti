<template>
  <view class="demo-strip">
    <text>{{ DEMO_COPY.badge }}</text>
    <text class="textbtn" @click="show">{{ DEMO_COPY.link }}</text>
  </view>
</template>
<script setup lang="ts">
import { DEMO_COPY } from '@/constants/copy'
function show() { uni.showToast({ title: DEMO_COPY.stateToast, icon: 'none' }) }
</script>
