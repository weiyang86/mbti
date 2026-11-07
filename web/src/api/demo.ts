import { useMock } from './client'
import { resetSocialMock } from './mock/social-state'
import { resetRadarMock } from './mock/radar'

export function resetDemoData() {
  if (useMock()) {
    resetSocialMock()
    resetRadarMock()
  }
}
