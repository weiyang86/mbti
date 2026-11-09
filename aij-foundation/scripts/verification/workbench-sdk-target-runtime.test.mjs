import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRuntimeOptions, actorUrl, forwardTarget, OFFICIAL_ENDPOINT, startWorkbenchTargetRuntime } from './workbench-sdk-target-runtime.mjs';
const options = { task: 'AF-198', transport: 'AiCenterHttpTransport:owned-loopback', concurrency: 1, freshLease: true };
const api = 'http://127.0.0.1:32123/api', upstream = 'http://127.0.0.1:32124';
test('exact same-task fresh serial lease options only', () => {
  assert.equal(validateRuntimeOptions(options), 'AF-198');
  assert.equal(validateRuntimeOptions({ ...options, task: 'AF-191' }), 'AF-191');
  for (const invalid of [null, {}, { ...options, task: 'AF-999' }, { ...options, freshLease: false }, { ...options, concurrency: 2 }, { ...options, transport: 'stub' }, { ...options, acceptanceId: 'reuse' }]) assert.throws(() => validateRuntimeOptions(invalid), /OPTIONS_REJECTED/);
});
test('only AF191 admits an exact owned loopback browser origin; other tasks keep the original shape', () => {
  assert.equal(validateRuntimeOptions({ ...options, task: 'AF-191', browserOrigin: 'http://127.0.0.1:49191' }), 'AF-191');
  for (const browserOrigin of ['http://localhost:49191', 'https://127.0.0.1:49191', 'http://127.0.0.1:49191/', 'http://127.0.0.1:49191?x', 'http://a:b@127.0.0.1:49191', 'http://127.0.0.1:80']) {
    assert.throws(() => validateRuntimeOptions({ ...options, task: 'AF-191', browserOrigin }), /OPTIONS_REJECTED/);
  }
  for (const task of ['AF-198', 'AF-215']) assert.throws(() => validateRuntimeOptions({ ...options, task, browserOrigin: 'http://127.0.0.1:49191' }), /OPTIONS_REJECTED/);
});
test('only exact approved upstream POST; all other internet/loopback/redirect variants rejected', () => {
  const init = { method: 'POST', redirect: 'error' };
  assert.equal(forwardTarget(OFFICIAL_ENDPOINT, init, upstream, api), upstream + '/v1/chat/completions');
  for (const raw of [OFFICIAL_ENDPOINT + '?x=1', OFFICIAL_ENDPOINT + '#x', OFFICIAL_ENDPOINT.replace('https:', 'http:'), 'https://api.openai.com.evil.test/v1/chat/completions', upstream + '/v1/chat/completions', 'http://localhost:32123/api/client/ai/agents', new URL(OFFICIAL_ENDPOINT)]) assert.throws(() => forwardTarget(raw, init, upstream, api), /FETCH_DESTINATION_REJECTED/);
  for (const bad of [{}, { method: 'GET', redirect: 'error' }, { method: 'POST', redirect: 'follow' }]) assert.throws(() => forwardTarget(OFFICIAL_ENDPOINT, bad, upstream, api));
});
test('actor cookies never leave exact owned client namespace', () => {
  const url = api + '/client/ai/agents?limit=1';
  assert.equal(actorUrl(api, url), url);
  for (const raw of [api + '/admin/ai', api + '/client/../admin/ai', api + '/client/%2e%2e/admin', api + '/client/x#fragment', api + '/client/x\\y', api + '.evil/client/x', 'https://evil.test/api/client/x']) assert.throws(() => actorUrl(api, raw), /ACTOR_URL_REJECTED/);
});
test('missing explicit root authorization rejects before imports, DB or App', async () => {
  const key = 'AIJ_AF198_ROOT_ACCEPTANCE', previous = process.env[key];
  try { delete process.env[key]; await assert.rejects(startWorkbenchTargetRuntime(options), /AF198_ROOT_OPT_IN_REQUIRED/); }
  finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
});
