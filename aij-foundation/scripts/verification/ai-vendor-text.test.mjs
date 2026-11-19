import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { loadSource, nest } from './optimization-delta/source-loader.mjs';
import { syntheticAiCatalog } from './ai-center-fixture.mjs';

const path = 'apps/api/src/plugins/aij-ai/';
const profiles = loadSource(path + 'ai-vendor-profiles.ts', { '@nestjs/common': nest }, { URL });
const secret = loadSource('apps/api/src/secret-center/secret-ref.ts', { '@nestjs/common': nest });
const policy = loadSource(path + 'ai-center-policy.ts', { '@nestjs/common': nest, '../../secret-center/secret-ref': secret, './ai-vendor-profiles': profiles }, { URL });
const redactor = loadSource(path + 'deepseek-provider.ts', { '@nestjs/common': nest, '@nestjs/config': {}, './ai-evaluation-budget.service': {} }, { URL });
const provider = loadSource(path + 'ai-center-provider.ts', {
  '@nestjs/common': nest, '@nestjs/config': {}, './ai-center-policy': policy,
  './deepseek-provider': redactor, './ai-vendor-profiles': profiles
}, { URL, TextDecoder, fetch: () => { throw new Error('Offline source test forbids network'); } });
const budget = loadSource(path + 'ai-center-budget.service.ts', { '@nestjs/common': nest, 'node:crypto': await import('node:crypto'), './ai-provider': { AiBudgetExceededException: class extends Error {} } });
const plain = v => JSON.parse(JSON.stringify(v));
function catalog(vendor = 'aliyun') {
  const c = syntheticAiCatalog('env://AIJ_SECRET_AIJ_FOUNDATION_TEST_VENDOR');
  c.providers = [c.providers[0]]; c.models = [c.models[0]]; c.agents = [c.agents[0]];
  Object.assign(c.providers[0], { vendor, baseUrl: profiles.AI_VENDOR_BASES[vendor] ?? 'https://owned.example.test/v1', enabled: true, liveEnabled: true });
  Object.assign(c.models[0], { upstreamModel: vendor === 'aliyun' ? 'qwen3.8-max' : vendor === 'deepseek' ? 'deepseek-flash' : 'synthetic-text-v1', tokenParameter: vendor === 'aliyun' ? 'max_completion_tokens' : 'max_tokens' });
  return c;
}
function snapshot(c = catalog()) { return { provider: c.providers[0], model: c.models[0], agent: c.agents[0], skills: c.skills }; }
function fixture(vendor = 'aliyun', reply) {
  const state = { AI_CENTER_LIVE_ENABLED: 'true', AI_DEEPSEEK_LIVE_ENABLED: 'true', AI_DEEPSEEK_UPSTREAM_CONFIRMED: 'true', AI_DEEPSEEK_DATA_CLASS: 'synthetic-or-deidentified' };
  const calls = [], s = snapshot(catalog(vendor));
  const service = new provider.AiCenterProviderService({ get: key => state[key] }, { request: async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return reply ? reply(s) : response(s);
  } });
  return { state, calls, s, service, invoke: () => service.invoke(s, { selfType: 'ENFP contact synthetic@example.test', buddyType: 'INTJ sk-syntheticCredential' }, 'synthetic-owned-key', new AbortController().signal) };
}
function payload(s) { return { model: s.model.upstreamModel, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Final synthetic answer', reasoning_content: 'REASONING_MUST_NOT_PERSIST' } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, prompt_tokens_details: { cached_tokens: 2 } } }; }
function response(s, change = () => {}) { const p = payload(s); change(p); return Response.json(p); }

test('strict catalog accepts Alibaba exact mainland base, retains links and accepts no added fields', () => {
  for (const vendor of ['aliyun', 'deepseek', 'openai', 'compatible']) {
    const c = catalog(vendor); assert.equal(policy.validateAiCatalog(c, ['https://owned.example.test/v1']), c);
  }
  for (const mutate of [c => c.providers[0].vendor = 'alibaba', c => c.providers[0].apiKey = 'forbidden', c => c.models[0].providerCode = 'unknown', c => c.agents[0].modelCode = 'unknown', c => c.providers[0].credentialRef = 'raw-api-key', c => c.providers[0].enabled = undefined, c => c.providers[0].liveEnabled = undefined]) {
    const c = catalog(); mutate(c); assert.throws(() => policy.validateAiCatalog(c));
  }
});

test('first-party vendor/base bindings reject region changes and URL tricks even with extra allowlist', () => {
  for (const base of ['https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'http://127.0.0.1:8765/v1', profiles.ALIYUN_TEXT_BASE + '/', profiles.ALIYUN_TEXT_BASE + '?x=1', profiles.ALIYUN_TEXT_BASE + '#x', 'https://dashscope.aliyuncs.com.evil.test/compatible-mode/v1', 'https://user:pass@dashscope.aliyuncs.com/compatible-mode/v1', 'https://dashscope.aliyuncs.com:443/compatible-mode/v1', profiles.OPENAI_BASE]) {
    const c = catalog(); c.providers[0].baseUrl = base; assert.throws(() => policy.validateAiCatalog(c, [base]));
  }
  assert.throws(() => policy.approvedAiBaseUrl('https://arbitrary.example.test/v1'));
  assert.equal(policy.approvedAiBaseUrl('https://owned.example.test/v1', ['https://owned.example.test/v1']), 'https://owned.example.test/v1');
});

test('first-party text-only model/token profiles are enforced both at catalog validation and invocation', async () => {
  for (const vendor of ['aliyun', 'deepseek']) for (const mutate of [s => s.model.capability = 'image', s => s.model.tokenParameter = vendor === 'aliyun' ? 'max_tokens' : 'max_completion_tokens']) {
    const f = fixture(vendor); mutate(f.s);
    assert.throws(() => policy.validateAiCatalog({ ...catalog(vendor), providers: [f.s.provider], models: [f.s.model] }));
    await assert.rejects(f.invoke()); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.s.model.upstreamModel = 'stream-only-or-unknown-model'; await assert.rejects(f.invoke()); assert.equal(f.calls.length, 0);
  // A compatible label cannot bypass the actual first-party protocol or DeepSeek image restriction.
  for (const base of [profiles.ALIYUN_TEXT_BASE, profiles.DEEPSEEK_TEXT_BASE, 'https://api.deepseek.com/custom']) {
    const c = catalog(); c.providers[0].vendor = 'compatible'; c.providers[0].baseUrl = base; c.models[0].capability = 'image';
    assert.throws(() => policy.validateAiCatalog(c, [base]));
  }
});

test('Alibaba and DeepSeek emit only supported nonstream final-answer request fields and redact input', async () => {
  for (const vendor of ['aliyun', 'deepseek']) for (const format of ['text', 'json']) {
    const f = fixture(vendor, s => response(s, p => { if (format === 'json') p.choices[0].message.content = '{"answer":"Final answer"}'; }));
    f.s.agent.outputFormat = format; f.s.agent.outputFields = format === 'json' ? ['answer'] : [];
    const r = await f.invoke(), call = f.calls[0]; assert.equal(f.calls.length, 1);
    assert.equal(call.url, profiles.AI_VENDOR_BASES[vendor] + '/chat/completions');
    assert.equal(call.init.method, 'POST'); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.headers.authorization, 'Bearer synthetic-owned-key');
    assert.equal(call.body.stream, false); assert.equal(call.body[f.s.model.tokenParameter], 1024); assert.equal(call.body.model, f.s.model.upstreamModel);
    const expected = ['model', 'messages', f.s.model.tokenParameter, 'stream', vendor === 'aliyun' ? 'enable_thinking' : 'thinking', ...(format === 'json' ? ['response_format'] : [])];
    assert.deepEqual(Object.keys(call.body).sort(), expected.sort());
    if (vendor === 'aliyun') assert.equal(call.body.enable_thinking, false); else assert.deepEqual(call.body.thinking, { type: 'disabled' });
    if (format === 'json') { assert.deepEqual(call.body.response_format, { type: 'json_object' }); assert.match(call.body.messages[0].content, /JSON object/); assert.deepEqual(plain(r.output), { answer: 'Final answer' }); }
    else assert.equal(r.output, 'Final synthetic answer');
    assert.equal(JSON.stringify(call.body).includes('synthetic@example.test'), false); assert.equal(JSON.stringify(call.body).includes('sk-syntheticCredential'), false);
    assert.equal(JSON.stringify(r).includes('REASONING_MUST_NOT_PERSIST'), false);
    assert.deepEqual(plain(r.usage), { promptTokens: 20, completionTokens: 10, cachedTokens: 2 });
    assert.equal(new budget.AiCenterBudgetService().estimate(f.s.model, r.usage), 40000n);
  }
});

test('DeepSeek cache hit/miss and common usage map to the existing cost owner, never a receipt', async () => {
  const f = fixture('deepseek', s => response(s, p => { p.usage = { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30, prompt_cache_hit_tokens: 7, prompt_cache_miss_tokens: 13 }; }));
  const r = await f.invoke(); assert.deepEqual(plain(r.usage), { promptTokens: 20, completionTokens: 10, cachedTokens: 7 }); assert.equal(Object.hasOwn(r.usage, 'costAmountNanos'), false);
  const zero = fixture('aliyun', s => response(s, p => { delete p.usage.prompt_tokens_details; })); assert.equal((await zero.invoke()).usage.cachedTokens, 0);
});

test('root/provider/model/Agent disabled flags, DeepSeek triple confirmation and abort deny before transport', async () => {
  for (const mutate of [f => delete f.state.AI_CENTER_LIVE_ENABLED, f => f.s.provider.liveEnabled = false, f => f.s.provider.enabled = false, f => f.s.model.enabled = false, f => f.s.agent.enabled = false, f => f.s.agent.published = false]) {
    const f = fixture(); mutate(f); assert.throws(() => f.service.assertLive(f.s, [])); await assert.rejects(f.invoke()); assert.equal(f.calls.length, 0);
  }
  for (const key of ['AI_DEEPSEEK_LIVE_ENABLED', 'AI_DEEPSEEK_UPSTREAM_CONFIRMED', 'AI_DEEPSEEK_DATA_CLASS']) for (const vendor of ['deepseek', 'compatible']) {
    const f = fixture('deepseek'); f.s.provider.vendor = vendor; delete f.state[key]; assert.throws(() => f.service.assertLive(f.s, [])); await assert.rejects(f.invoke()); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); const controller = new AbortController(); controller.abort(); await assert.rejects(f.service.invoke(f.s, {}, 'synthetic', controller.signal)); assert.equal(f.calls.length, 0);
});

test('OpenAI and server-approved compatible text/JSON bodies retain both token parameters', async () => {
  for (const vendor of ['openai', 'compatible']) for (const token of ['max_tokens', 'max_completion_tokens']) {
    const f = fixture(vendor, s => response(s, p => { if (s.agent.outputFormat === 'json') p.choices[0].message.content = '{"answer":"Existing JSON answer"}'; })); f.s.model.tokenParameter = token; f.service.assertLive(f.s, ['https://owned.example.test/v1']); await f.invoke();
    assert.deepEqual(Object.keys(f.calls[0].body).sort(), ['model', 'messages', token, 'stream'].sort());
    f.s.agent.outputFormat = 'json'; f.s.agent.outputFields = ['answer']; assert.deepEqual(plain((await f.invoke()).output), { answer: 'Existing JSON answer' });
    const c = catalog(vendor); c.models[0].capability = 'image'; assert.equal(policy.validateAiCatalog(c, ['https://owned.example.test/v1']), c);
  }
});

test('existing OpenAI/compatible image requests still use the actual bounded PNG parser and optional usage', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfP8AAAAASUVORK5CYII=', 'base64');
  for (const vendor of ['openai', 'compatible']) for (const explicit of [false, true]) {
    const f = fixture(vendor, () => Response.json({ data: [{ b64_json: png.toString('base64') }] }));
    f.s.model.capability = 'image'; f.s.model.imageBase64Format = explicit; f.state.capabilities = { storage: true };
    f.service.assertLive(f.s, ['https://owned.example.test/v1']); const result = await f.invoke();
    assert.equal(f.calls[0].url, f.s.provider.baseUrl + '/images/generations'); assert.deepEqual(Buffer.from(result.bytes), png);
    assert.equal(f.calls[0].body.n, 1); assert.equal(f.calls[0].body[explicit ? 'response_format' : 'output_format'], explicit ? 'b64_json' : 'png');
    assert.deepEqual(plain(result.usage), { imageCount: 1 });
  }
});

test('length/tools/refusal/unknown/malformed/model/error/usage failures never become success or retries', async () => {
  const mutations = [
    p => p.choices[0].finish_reason = 'length', p => p.choices[0].finish_reason = 'tool_calls', p => p.choices[0].finish_reason = 'unknown',
    p => p.choices[0].message.tool_calls = [], p => p.choices[0].message.function_call = {}, p => p.choices[0].message.refusal = 'refused',
    p => p.choices[0].message.content = null, p => p.choices[0].message.content = '   ', p => p.choices[0].message.content = 'x'.repeat(64001),
    p => p.choices = [null], p => p.choices.push(p.choices[0]), p => p.choices = undefined,
    p => p.model = 'unknown-upstream', p => p.error = { message: 'sensitive upstream error' }, p => p.usage = undefined,
    p => delete p.usage.total_tokens, p => { p.usage.input_tokens = 20; delete p.usage.prompt_tokens; },
    p => p.usage.prompt_tokens = -1, p => p.usage.completion_tokens = 1.5, p => p.usage.completion_tokens = 1025,
    p => p.usage.prompt_tokens = 16385, p => p.usage.total_tokens = 31, p => p.usage.prompt_tokens_details.cached_tokens = 21,
    p => p.usage.prompt_tokens_details.cached_tokens = -1, p => p.usage.prompt_cache_hit_tokens = 3,
    p => p.usage.prompt_cache_miss_tokens = 10, p => p.usage.prompt_tokens_details = [], p => p.usage = []
  ];
  for (const vendor of ['aliyun', 'deepseek']) for (const change of mutations) {
    const f = fixture(vendor, s => response(s, change)); await assert.rejects(f.invoke()); assert.equal(f.calls.length, 1);
  }
  for (const content of ['not json', '{}', '{"answer":1}', '{"answer":"yes","extra":"no"}', '[]']) {
    const f = fixture('aliyun', s => response(s, p => p.choices[0].message.content = content)); f.s.agent.outputFormat = 'json'; f.s.agent.outputFields = ['answer']; await assert.rejects(f.invoke()); assert.equal(f.calls.length, 1);
  }
});

test('bounded actual response reader rejects HTTP errors, redirects, media types, oversize and invalid UTF8/JSON once', async () => {
  for (const reply of [() => Response.json({}, { status: 429 }), () => Response.json({}, { status: 503 }), () => Response.json({}, { status: 302, headers: { location: 'https://foreign.invalid' } }), () => new Response('event: data', { headers: { 'content-type': 'text/event-stream' } }), () => new Response('x'.repeat(256 * 1024 + 1), { headers: { 'content-type': 'application/json' } }), () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }), () => Response.json(null), () => Response.json([]), () => new Response('{bad-json', { headers: { 'content-type': 'application/json' } })]) {
    const f = fixture('aliyun', reply); await assert.rejects(f.invoke()); assert.equal(f.calls.length, 1);
  }
});

test('output redaction applies to text and every structured final-answer field', async () => {
  for (const format of ['text', 'json']) {
    const sensitive = 'synthetic@example.test sk-syntheticCredential +86 138 0013 8000';
    const f = fixture('aliyun', s => response(s, p => p.choices[0].message.content = format === 'text' ? sensitive : JSON.stringify({ answer: sensitive })));
    f.s.agent.outputFormat = format; f.s.agent.outputFields = ['answer']; const r = await f.invoke();
    assert.equal(JSON.stringify(r.output).includes('synthetic@example.test'), false); assert.equal(JSON.stringify(r.output).includes('sk-syntheticCredential'), false); assert.equal(JSON.stringify(r.output).includes('138'), false);
  }
});

test('actual Ant Design editor offers Alibaba exact prefill with disabled defaults and text model/token selection', () => {
  const slots = []; let cursor = 0;
  const values = {};
  const form = { resetFields: () => { for (const k of Object.keys(values)) delete values[k]; }, setFieldsValue: v => Object.assign(values, v), setFieldValue: (k, v) => values[k] = v };
  const config = { version: 0, catalog: catalog() }; config.catalog.providers[0].code = 'aliyun';
  const jsx = (type, props) => ({ type, props });
  const antd = Object.fromEntries(['Alert', 'Button', 'Checkbox', 'Input', 'InputNumber', 'Modal', 'Select', 'Space', 'Table', 'Tabs', 'Tag', 'Row', 'Col'].map(k => [k, k]));
  antd.Form = Object.assign(() => {}, { Item: 'Form.Item', useForm: () => [form], useWatch: key => values[key] });
  antd.Typography = { Text: 'Typography.Text', Paragraph: 'Typography.Paragraph' };
  const imports = { 'react/jsx-runtime': { jsx, jsxs: jsx }, '@aij/ui': { PageHeading: 'PageHeading' }, antd, 'next/link': { default: 'Link' },
    react: { useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = i === 0 ? config : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; }, useEffect: () => {}, useEffectEvent: fn => fn },
    './admin-api': { RequestFailure: class extends Error {}, requestMessage: e => e.message }, './admin-shell': { useAdmin: () => ({ can: () => true, request: () => { throw new Error('No network in editor source test'); } }) },
    './admin-ai-policy': { AI_CENTER_CONFIGURATION_PERMISSION: 'configuration', AI_CENTER_SECRET_PERMISSION: 'secrets' } };
  const source = readFileSync(new URL('../../apps/web/app/components/admin-ai-center.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const module = { exports: {} };
  new vm.Script(compiled.outputText).runInContext(vm.createContext({ module, exports: module.exports, require: name => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; }, structuredClone, BigInt }));
  const render = () => { cursor = 0; return module.exports.AdminAiCenter(); };
  function find(value, predicate) { if (!value || typeof value !== 'object') return undefined; if (predicate(value)) return value; for (const child of Object.values(value)) { const found = find(child, predicate); if (found) return found; } }
  find(render(), v => v.type === 'Button' && [].concat(v.props.children).join('') === '新增厂商连接').props.onClick();
  assert.equal(values.enabled, false); assert.equal(values.liveEnabled, false);
  const select = find(render(), v => v.type === 'Select' && v.props.options.some(o => o.value === 'aliyun'));
  select.props.onChange('aliyun'); assert.equal(values.baseUrl, profiles.ALIYUN_TEXT_BASE); assert.equal(values.enabled, false); assert.equal(values.liveEnabled, false);
  find(render(), v => v.type === 'Button' && [].concat(v.props.children).join('') === '新增模型').props.onClick();
  find(render(), v => v.type === 'Form.Item' && v.props.name === 'providerCode').props.children.props.onChange('aliyun');
  assert.equal(values.capability, 'text'); assert.equal(values.upstreamModel, 'qwen3.8-max'); assert.equal(values.tokenParameter, 'max_completion_tokens'); assert.equal(values.enabled, false);
});
