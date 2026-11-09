// F5 internal candidate / needs_human_review. Shared guest/error handling; no local fallback.
import { request } from './client'
import type { ContactChannel, ContactRequest, GrantedChannel, MyContacts } from './types-social'

export function getContacts() { return request<MyContacts>('/contacts/me') }
export function updateContacts(body: MyContacts) {
  return request<MyContacts>('/contacts/me', { method: 'PUT', data: body })
}
export function clearContacts() { return request<void>('/contacts/me', { method: 'DELETE' }) }
export function listContactRequests(buddyId?: string) {
  return request<{ items: ContactRequest[] }>(`/contact-requests${buddyId ? `?buddy_id=${encodeURIComponent(buddyId)}` : ''}`)
}
export function createContactRequest(body: { buddy_id: string; channels: ContactChannel[] }) {
  return request<ContactRequest>('/contact-requests', { method: 'POST', data: body })
}
export function respondContactRequest(id: string, action: 'accept' | 'decline') {
  return request<ContactRequest>(`/contact-requests/${encodeURIComponent(id)}/respond`, { method: 'POST', data: { action } })
}
export function revokeContactRequest(id: string) {
  return request<void>(`/contact-requests/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
export function getGrantedContacts(id: string) {
  return request<{ channels: GrantedChannel[] }>(`/contact-requests/${encodeURIComponent(id)}/granted`)
}
