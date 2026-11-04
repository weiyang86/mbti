import { request, useMock } from './client'
import * as mock from './mock/store'

export function getHealth() {
  if (useMock()) return mock.getHealth()
  return request<{ status: string; version?: string }>('/health')
}
