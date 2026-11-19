import { request, useMock } from './client'
import type { TypeMeta } from './types'
import * as mock from './mock/store'

export function listTypes() {
  if (useMock()) return mock.listTypes()
  return request<{ items: TypeMeta[] }>('/types')
}
