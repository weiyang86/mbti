import { useMock } from './client'
import { resetSocialMock } from './mock/social-state'

export function resetDemoData() {
  if (useMock()) resetSocialMock()
}
