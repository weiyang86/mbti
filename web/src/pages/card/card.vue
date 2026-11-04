<template>
  <view class="page card-page">
    <view class="demo-strip">
      <text>V0.4 · Mock 演示 · 不产生费用</text>
      <text class="demo-link" @click="showDemo">演示状态 ↗</text>
    </view>

    <text class="kicker">MY CARD / 我的名片</text>
    <text class="title">这一张，<text class="hl">是我的名片。</text></text>
    <text class="sub">公开图只放昵称、类型、兴趣与宣言，不放联系方式。</text>

    <view class="portrait">
      <image class="portrait-img" src="/static/cover-illustration.webp" mode="aspectFill" />
      <view class="portrait-shade" />
      <view class="portrait-top">
        <text>MBTI搭子 / MY TYPE</text>
        <text>16 TYPES / 01 ME</text>
      </view>
      <view class="portrait-info">
        <text class="mbti">{{ typeCode }}</text>
        <text class="name">{{ nickname }} · {{ typeName }}</text>
        <text class="quote">{{ declaration }}</text>
        <view class="tags" v-if="interests.length">
          <text class="tag" v-for="i in interests" :key="i">{{ i }}</text>
        </view>
        <text class="tiny">AI 示例人物 · 趣味人格探索</text>
      </view>
    </view>

    <view class="actions">
      <view class="btn-primary" @click="goShare">去晒成一张图</view>
      <view class="btn-secondary mt" @click="goTest">重新测一次</view>
    </view>

    <text class="foot">名片默认私有 · 是否交换由你和对方决定</text>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import { listResults } from '@/api/results'

const TYPE_NAMES: Record<string, string> = {
  INTJ: '独立构想者', INTP: '好奇研究员', ENTJ: '行动策划家', ENTP: '灵感实验家',
  INFJ: '安静观察家', INFP: '理想收藏家', ENFJ: '温暖连接者', ENFP: '灵感漫游者',
  ISTJ: '秩序守护者', ISFJ: '细节记录员', ESTJ: '计划推进者', ESFJ: '关系照料者',
  ISTP: '动手探索家', ISFP: '感受艺术家', ESTP: '即时行动派', ESFP: '快乐分享家',
}

const DECLARATIONS: Record<string, string> = {
  INTJ: '想得很远，也走得很稳。', INTP: '好奇心在线，脑洞不打烊。',
  ENTJ: '有想法，也有把它落地的行动力。', ENTP: '给日常一点新可能。',
  INFJ: '安静观察，也认真理解。', INFP: '温柔有自己的方向。',
  ENFJ: '把温暖，留在每一次相遇里。', ENFP: '今天也想遇见有趣的世界。',
  ISTJ: '把靠谱，藏进每一件小事。', ISFJ: '记得小事，也珍惜身边的人。',
  ESTJ: '喜欢把事情，安排得明明白白。', ESFJ: '让每一次相处都有温度。',
  ISTP: '与其想很久，不如亲手试一试。', ISFP: '把感受到的美，留在生活里。',
  ESTP: '行动是我认识世界的方式。', ESFP: '把快乐，分享给今天的你。',
}

const typeCode = ref('INFP')
const resultId = ref('')
const nickname = ref('小禾')
const interests = ref<string[]>([])

onShow(async () => {
  try {
    const raw = uni.getStorageSync('mbti_test_profile_v1')
    if (raw && typeof raw === 'object') {
      nickname.value = (typeof raw.name === 'string' && raw.name.trim()) || '小禾'
      interests.value = Array.isArray(raw.interests) ? raw.interests.slice(0, 3) : []
    }
  } catch {
    /* ignore */
  }
  try {
    const res = await listResults({ limit: 1 })
    const latest = res.items[0]
    if (latest) {
      resultId.value = latest.id
      typeCode.value = latest.type_code
    }
  } catch {
    /* ignore */
  }
})

const typeName = computed(() => TYPE_NAMES[typeCode.value] || 'MBTI')
const declaration = computed(
  () => DECLARATIONS[typeCode.value] || '四个字母之外，还有不一样的你。',
)

function goShare() {
  if (!resultId.value) {
    uni.showToast({ title: '先测一次再晒图', icon: 'none' })
    return
  }
  uni.navigateTo({ url: `/pages/share-preview/share-preview?id=${resultId.value}` })
}

function goTest() {
  uni.navigateTo({ url: '/pages/test-intro/test-intro' })
}

function showDemo() {
  uni.showModal({
    title: '演示状态',
    content: '当前为 V0.4 Mock 演示：名片使用本地昵称与最近一次结果，不产生真实费用。',
    showCancel: false,
    confirmText: '知道了',
  })
}
</script>

<style scoped lang="scss">
.card-page {
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

.kicker {
  display: block;
  font-size: 20rpx;
  letter-spacing: 3rpx;
  color: #a398af;
  font-weight: 600;
}
.title {
  display: block;
  margin-top: 16rpx;
  font-size: 50rpx;
  font-weight: 800;
  line-height: 1.3;
}
.hl {
  color: #7560df;
  border-bottom: 10rpx solid #dfff8b;
}
.sub {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx;
  color: #77727e;
  line-height: 1.6;
}

.portrait {
  position: relative;
  margin-top: 36rpx;
  height: 720rpx;
  border-radius: 32rpx;
  overflow: hidden;
  box-shadow: 0 24rpx 60rpx rgba(49, 33, 77, 0.18);
}
.portrait-img {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}
.portrait-shade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 62%;
  background: linear-gradient(180deg, rgba(20, 12, 40, 0) 0%, rgba(20, 12, 40, 0.82) 100%);
}
.portrait-top {
  position: absolute;
  left: 32rpx;
  right: 32rpx;
  top: 28rpx;
  display: flex;
  justify-content: space-between;
  font-size: 18rpx;
  letter-spacing: 2rpx;
  color: rgba(255, 255, 255, 0.8);
}
.portrait-info {
  position: absolute;
  left: 32rpx;
  right: 32rpx;
  bottom: 32rpx;
}
.mbti {
  display: block;
  font-size: 88rpx;
  font-weight: 800;
  color: #fff;
  letter-spacing: 4rpx;
  line-height: 1;
}
.name {
  display: block;
  margin-top: 14rpx;
  font-size: 28rpx;
  color: #fff;
}
.quote {
  display: block;
  margin-top: 10rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.78);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 16rpx;
}
.tag {
  font-size: 20rpx;
  color: #dfff8b;
  border: 2rpx solid rgba(223, 255, 139, 0.4);
  border-radius: 999rpx;
  padding: 4rpx 14rpx;
}
.tiny {
  display: block;
  margin-top: 18rpx;
  font-size: 18rpx;
  color: rgba(255, 255, 255, 0.55);
}

.actions {
  margin-top: 40rpx;
}
.btn-primary {
  font-weight: 700;
}
.mt {
  margin-top: 20rpx;
}

.foot {
  display: block;
  margin-top: 40rpx;
  text-align: center;
  font-size: 20rpx;
  color: #a398af;
}
</style>
