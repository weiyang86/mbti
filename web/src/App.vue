<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { refreshMockResultsFromStorage } from './api/mock/store'

onLaunch(() => {
  refreshMockResultsFromStorage()
})
</script>

<style lang="scss">
@import './uni.scss';
@import './styles/prototype.css';
</style>
