<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { refreshMockResultsFromStorage } from './api/mock/store'
import { ensurePublishedConfig } from './store/published'

onLaunch(() => {
  refreshMockResultsFromStorage()
  void ensurePublishedConfig()
})
</script>

<style lang="scss">
@import './uni.scss';
@import './styles/prototype.css';
</style>
