import assert from 'node:assert/strict'
import { test } from 'node:test'
import vm from 'node:vm'
import { buildSync } from 'esbuild'

const api = 'http://test.invalid/api/v1'
const guestKey = `mbti_guest_v1:${api}`
const future = '2099-01-01T00:00:00.000Z'
const env = { VITE_API_BASE_URL: api, VITE_USE_MOCK: 'false' }
const compile = (entry) => buildSync({
  entryPoints: [new URL(entry, import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'cjs',
  define: { 'import.meta.env': JSON.stringify(env) },
}).outputFiles[0].text
const clientCode = compile('../src/api/client.ts')
const draftCode = compile('../src/store/quiz-draft.ts')

function browser(storage = new Map(), respond = () => ({ statusCode: 200, data: { items: [], next_cursor: null } })) {
  const calls = []
  const uni = {
    getStorageSync: (key) => structuredClone(storage.get(key)),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key) => storage.delete(key),
    request(options) {
      calls.push(options)
      queueMicrotask(() => options.success(options.url.endsWith('/auth/guest')
        ? { statusCode: 201, data: { guest_token: 'synthetic-guest', expires_at: future } }
        : respond(options)))
    },
  }
  const load = (code) => {
    const context = { module: { exports: {} }, uni }
    vm.runInNewContext(code, context)
    return context.module.exports
  }
  return { storage, calls, uni, load, client: load(clientCode), drafts: load(draftCode) }
}

test('concurrent first requests issue one guest, attach its token and return bare objects', async () => {
  const b = browser()
  const responses = await Promise.all([
    b.client.request('/results'), b.client.request('/quiz/versions/current'), b.client.request('/results'),
  ])
  assert.equal(b.calls.filter((c) => c.url.endsWith('/auth/guest')).length, 1)
  assert.equal(b.calls.length, 4)
  assert.ok(b.calls.slice(1).every((c) => c.header['X-Guest-Token'] === 'synthetic-guest'))
  assert.equal(responses[0].items.length, 0)
  assert.equal(responses[0].next_cursor, null)
})

test('refresh reuses persisted identity; another browser has its own issuance', async () => {
  const b = browser()
  await b.client.request('/results')
  const refreshed = browser(b.storage)
  await refreshed.client.request('/results')
  assert.equal(refreshed.calls.length, 1)
  const other = browser()
  await other.client.request('/results')
  assert.equal(other.calls.filter((c) => c.url.endsWith('/auth/guest')).length, 1)
})

test('401 on a write is shown explicitly, never replayed or replaced, including after refresh', async () => {
  const b = browser(new Map([[guestKey, { guest_token: 'invalid-guest', expires_at: future }]]),
    () => ({ statusCode: 401, data: { code: 'guest_invalid', message: 'invalid' } }))
  await assert.rejects(b.client.request('/quiz/sessions', { method: 'POST' }), (e) => e.status === 401 && e.message.includes('会话已失效'))
  await assert.rejects(b.client.request('/quiz/sessions', { method: 'POST' }), (e) => e.status === 401)
  const refreshed = browser(b.storage)
  await assert.rejects(refreshed.client.request('/results'), (e) => e.status === 401)
  assert.equal(b.calls.length, 1)
  assert.equal(refreshed.calls.length, 0)
  assert.equal(b.storage.get(guestKey).invalid, true)
})

test('expired and malformed stored identities block protected requests without silently creating a guest', async () => {
  for (const value of [{ guest_token: 'expired', expires_at: '2000-01-01T00:00:00Z' }, { guest_token: 'broken' }]) {
    const b = browser(new Map([[guestKey, value]]))
    await assert.rejects(b.client.request('/quiz/sessions', { method: 'POST' }), (e) => e.status === 401)
    assert.equal(b.calls.length, 0)
    assert.equal(b.client.isGuestSessionExpired(), true)
  }
})

test('an explicit new identity request does not replay the rejected operation', async () => {
  const b = browser(new Map([[guestKey, { guest_token: 'expired', expires_at: '2000-01-01T00:00:00Z' }]]))
  await b.client.startNewGuestSession()
  assert.equal(b.calls.length, 1)
  assert.ok(b.calls[0].url.endsWith('/auth/guest'))
  assert.equal(b.client.isGuestSessionExpired(), false)
})

test('failure to persist a new credential prevents protected writes', async () => {
  const b = browser()
  b.uni.setStorageSync = () => { throw new Error('storage denied') }
  await assert.rejects(b.client.request('/quiz/sessions', { method: 'POST' }), /storage denied/)
  assert.equal(b.calls.length, 1)
})

test('409 and other API errors preserve the server message and status', async () => {
  const b = browser(new Map([[guestKey, { guest_token: 'synthetic-guest', expires_at: future }]]),
    () => ({ statusCode: 409, data: { code: 'already_submitted', message: 'already submitted' } }))
  await assert.rejects(b.client.request('/quiz/sessions/s/submit', { method: 'POST' }),
    (e) => e.status === 409 && e.body.code === 'already_submitted' && e.message === 'already submitted')
  assert.equal(b.calls.length, 1)
})

const bank = {
  question_bank_version: 'frozen-version',
  questions: Array.from({ length: 12 }, (_, i) => ({
    id: `q${i + 1}`, index: i + 1, dimension: 'EI', prompt: `original ${i}`,
    options: [{ id: 'a', label: 'original A' }, { id: 'b', label: 'original B' }],
  })),
}

test('draft restores exact cached questions and progress without fetching the current bank', () => {
  const b = browser()
  const draft = b.drafts.createQuizDraft({ id: 'session-1', question_bank_version: 'frozen-version', answers: [] }, bank)
  b.drafts.saveQuizDraft({ ...draft, answers: { q1: 'b' }, index: 1 })
  bank.questions[0].prompt = 'new current question'
  const refreshed = browser(b.storage)
  const restored = refreshed.drafts.loadQuizDraft()
  assert.ok(refreshed.drafts.isRestorableDraft(restored))
  assert.equal(restored.questionBank.questions[0].prompt, 'original 0')
  assert.equal(restored.answers.q1, 'b')
  assert.equal(restored.index, 1)
  assert.equal(refreshed.calls.length, 0)
})

test('legacy draft without original bank is refused; clearing it preserves result history', () => {
  const b = browser(new Map([
    ['mbti_quiz_draft_v1', { sessionId: 'old-session', questionBankVersion: 'old-version', answers: {}, index: 0 }],
    ['mbti_mock_results_v1', { results: [{ id: 'history' }] }],
  ]))
  assert.equal(b.drafts.isRestorableDraft(b.drafts.loadQuizDraft()), false)
  b.drafts.clearQuizDraft()
  assert.equal(b.storage.get('mbti_mock_results_v1').results[0].id, 'history')
})

test('session binding mismatch never saves a draft under a different bank version', () => {
  const b = browser()
  assert.throws(() => b.drafts.createQuizDraft({ id: 'session-1', question_bank_version: 'other-version', answers: [] }, bank), /原题库/)
  assert.equal(b.drafts.loadQuizDraft(), null)
})

test('corrupted cached questions are refused without throwing during recovery', () => {
  const b = browser()
  const draft = { sessionId: 's', questionBankVersion: 'v', questionBank: { question_bank_version: 'v', questions: Array(12).fill(null) }, answers: {}, index: 0 }
  assert.equal(b.drafts.isRestorableDraft(draft), false)
})
