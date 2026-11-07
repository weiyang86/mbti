// TODO: 待 Remy 确认接口路径和字段（后端未开发，当前用 mock 数据支撑页面演示）
import { request, useMock } from './client'
import type {
  ContactChannel,
  ContactRequest,
  GrantedChannel,
  MyContacts,
} from './types-social'
import * as mock from './mock/contacts'

export function getContacts() {
  if (useMock()) return mock.getContacts()
  return request<MyContacts>('/contacts/me')
}

export function updateContacts(body: MyContacts) {
  if (useMock()) return mock.updateContacts(body)
  return request<MyContacts>('/contacts/me', { method: 'PUT', data: body })
}

export function clearContacts() {
  if (useMock()) return mock.clearContacts()
  return request<void>('/contacts/me', { method: 'DELETE' })
}

export function listContactRequests(buddyId?: string) {
  if (useMock()) return mock.listContactRequests(buddyId)
  const suffix = buddyId ? `?buddy_id=${encodeURIComponent(buddyId)}` : ''
  return request<{ items: ContactRequest[] }>(`/contact-requests${suffix}`)
}

export function createContactRequest(body: { buddy_id: string; channels: ContactChannel[] }) {
  if (useMock()) return mock.createContactRequest(body)
  return request<ContactRequest>('/contact-requests', { method: 'POST', data: body })
}

export function respondContactRequest(
  requestId: string,
  action: 'accept' | 'decline',
) {
  if (useMock()) return mock.respondContactRequest(requestId, action)
  return request<ContactRequest>(`/contact-requests/${encodeURIComponent(requestId)}/respond`, {
    method: 'POST',
    data: { action },
  })
}

export function revokeContactRequest(requestId: string) {
  if (useMock()) return mock.revokeContactRequest(requestId)
  return request<void>(`/contact-requests/${encodeURIComponent(requestId)}`, {
    method: 'DELETE',
  })
}

export function getGrantedContacts(requestId: string) {
  if (useMock()) return mock.getGrantedContacts(requestId)
  return request<{ channels: GrantedChannel[] }>(
    `/contact-requests/${encodeURIComponent(requestId)}/granted`,
  )
}
