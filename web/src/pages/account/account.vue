<template>
  <view class="page account-page">
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="demo-link" @click="showDemo">演示状态 ↗</text>
    </view>

    <view class="panel">
      <view class="profile-head">
        <image class="profile-img" src="/static/cover-illustration.webp" mode="aspectFill" />
        <view class="profile-info">
          <text class="nickname">{{ nickname }}</text>
          <text class="type-line">{{ typeCode }} · 免费基础用户</text>
        </view>
      </view>

      <view class="links">
        <view class="link-row" @click="goHistory">
          <text>我的轨迹</text><text class="arrow">→</text>
        </view>
        <view class="link-row" @click="goResult">
          <text>类型结果</text><text class="arrow">→</text>
        </view>
        <view class="link-row" @click="goCard">
          <text>我的名片</text><text class="arrow">→</text>
        </view>
        <view class="link-row" @click="showUnavailable('名片夹')">
          <text>名片夹</text><text class="arrow">→</text>
        </view>
        <view class="link-row" @click="showUnavailable('联系方式')">
          <text>联系方式</text><text class="arrow">→</text>
        </view>
      </view>
    </view>

    <view class="panel">
      <text class="panel-title">我的模拟订单</text>
      <text class="panel-desc">本期不实现支付与订单（契约 OUT OF SCOPE），这里只保留入口位置。</text>
      <view class="btn-secondary mt" @click="showUnavailable('订单')">查看模拟订单</view>
    </view>

    <text class="foot">趣味倾向体验 · 非临床测评 · 数据仅保存在本机</text>
  </view>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { listResults } from '@/api/results'

const nickname = ref('小禾')
const typeCode = ref('INFP')
const latestId = ref('')

onShow(async () => {
  try {
    const raw = uni.getStorageSync('mbti_test_profile_v1')
    if (raw && typeof raw === 'object' && typeof raw.name === 'string' && raw.name.trim()) {
      nickname.value = raw.name.trim()
    }
  } catch {
    /* ignore */
  }
  try {
    const res = await listResults({ limit: 1 })
    const latest = res.items[0]
    if (latest) {
      latestId.value = latest.id
      typeCode.value = latest.type_code
    }
  } catch {
    /* ignore */
  }
})

function goHistory() {
  uni.switchTab({ url: '/pages/history/list' })
}

function goResult() {
  if (!latestId.value) {
    uni.showToast({ title: '先测一次再看结果', icon: 'none' })
    return
  }
  uni.navigateTo({ url: `/pages/result/result?id=${latestId.value}` })
}

function goCard() {
  uni.switchTab({ url: '/pages/card/card' })
}

function showUnavailable(name: string) {
  uni.showModal({
    title: `${name}本期未实现`,
    content: '该能力对应的接口不在本周契约范围内，当前只保留入口占位。',
    showCancel: false,
    confirmText: '知道了',
  })
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：账号、订单与联系方式均为模拟，不产生真实费用。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.account-page {
  padding-top: 24rpx;
  padding-bottom: 56rpx;
}

.demo-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 20rpx;
  color: #a398af;
  margin-bottom: 24rpx;
}
.demo-link {
  color: #7560df;
}

.panel {
  margin-top: 24rpx;
  padding: 32rpx 28rpx;
  background: #fff;
  border: 2rpx solid #e9e5ed;
  border-radius: 24rpx;
}
.profile-head {
  display: flex;
  align-items: center;
}
.profile-img {
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  margin-right: 20rpx;
}
.profile-info {
  flex: 1;
}
.nickname {
  display: block;
  font-size: 34rpx;
  font-weight: 700;
}
.type-line {
  display: block;
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #77727e;
}

.links {
  margin-top: 24rpx;
  border-top: 2rpx solid #f1ecfb;
}
.link-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24rpx 0;
  border-bottom: 2rpx solid #f6f3fb;
  font-size: 26rpx;
  color: #292630;
}
.arrow {
  color: #7560df;
}

.panel-title {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
}
.panel-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #a398af;
  line-height: 1.6;
}
.mt {
  margin-top: 24rpx;
}

.foot {
  display: block;
  margin-top: 40rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
}
</style>
