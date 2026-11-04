<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { refreshMockResultsFromStorage } from './api/mock/store'

onLaunch(() => {
  refreshMockResultsFromStorage()
})
</script>

<style lang="scss">
@import './uni.scss';

page {
  background-color: #f8f7f4;
  font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}
</style>
