import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { inspect } from 'node:util';
import { createServer } from 'node:http';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import test from 'node:test';

// Default requires the actual whole-API build; worker-only isolated compilation is explicit.
const require = createRequire(import.meta.url);
const modulePath = process.env.AIJ_ALIYUN_PROTOCOL_MODULE
  ? resolve(process.env.AIJ_ALIYUN_PROTOCOL_MODULE)
  : '../../apps/api/dist/plugins/aij-ai/aliyun-retrieval-protocol.js';
const { AliyunRetrievalProtocol, AliyunRetrievalError, ALIYUN_RETRIEVAL_POLICY: policy } = require(modulePath);
const key = 'synthetic-credential-183';
const embed = { texts: ['synthetic first', 'synthetic second'], textType: 'document' };
const rerank = { query: 'synthetic query', documents: ['synthetic first', 'synthetic second', 'synthetic third'], topN: 2 };
const vector = n => Array.from({ length: 1024 }, () => n);
const embedding = () => ({ request_id: 'synthetic-183', output: { embeddings: [
  { text_index: 1, embedding: vector(0.25) }, { text_index: 0, embedding: vector(-0.5) },
] }, usage: { total_tokens: 9 } });
const ranking = () => ({ request_id: 'synthetic-183', output: { results: [
  { index: 2, relevance_score: 0.9 }, { index: 0, relevance_score: 0.1 },
] }, usage: { total_tokens: 15 } });
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const safeError = code => error => {
  assert.ok(error instanceof AliyunRetrievalError);
  assert.equal(error.message, code);
  assert.equal(error.code, code);
  for (const secret of [key, ...embed.texts, rerank.query, 'PRIVATE-UPSTREAM'])
    assert.equal(inspect(error).includes(secret), false);
  assert.equal(error.cause, undefined);
  return true;
};

test('AF-183 compiled native protocol fixes model, endpoints, headers and envelope', async () => {
  const calls = [];
  const protocol = new AliyunRetrievalProtocol({ request: async (url, init) => {
    calls.push({ url, init }); return response(calls.length === 1 ? embedding() : ranking());
  } });
  assert.equal(policy.configured, false);
  assert.ok(Object.isFrozen(policy.embedding));
  const e = await protocol.embed(embed, key);
  const r = await protocol.rerank(rerank, key);
  assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding');
  assert.equal(calls[1].url, 'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank');
  for (const { init } of calls) {
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}` });
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(Object.keys(init).sort(), ['body', 'headers', 'method', 'redirect', 'signal']);
  }
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: 'text-embedding-v4', input: { texts: embed.texts }, parameters: { text_type: 'document', dimension: 1024, output_type: 'dense' } });
  assert.deepEqual(JSON.parse(calls[1].init.body), { model: 'qwen3-rerank', input: { query: rerank.query, documents: rerank.documents }, parameters: { top_n: 2, return_documents: false } });
  assert.equal(e.readVectors()[0][0], -0.5); assert.equal(e.readVectors()[1][0], 0.25);
  assert.deepEqual(e.readUsage(), { state: 'reported', totalTokens: 9 });
  assert.deepEqual(r.readRanks(), [{ index: 2, score: 0.9 }, { index: 0, score: 0.1 }]);
  assert.deepEqual(r.readUsage(), { state: 'reported', totalTokens: 15 });
  for (const result of [e, r]) {
    assert.deepEqual(Object.keys(result), []);
    assert.equal(JSON.stringify(result).includes('0.25'), false);
    assert.equal(inspect(result, { showHidden: true }).includes(key), false);
    assert.equal(inspect(result).includes('private'), true);
  }
  assert.throws(() => e.readVectors()[0].push(1), TypeError);
  assert.throws(() => { r.readRanks()[0].index = 1; }, TypeError);
});

test('AF-183 input validation refuses structure, caller overrides, secret and non-text before dispatch', async () => {
  let calls = 0;
  const p = new AliyunRetrievalProtocol({ request: async () => { calls++; return response(embedding()); } });
  for (const input of [null, [], {}, { ...embed, url: 'https://example.invalid' },
    { ...embed, model: 'deepseek-embedding' }, { ...embed, headers: {} }, { ...embed, ca: 'unsafe' },
    { ...embed, dimension: 1 }, { ...embed, textType: 'image' },
    { ...embed, texts: [] }, { ...embed, texts: Array(5).fill('x') },
    { ...embed, texts: [''] }, { ...embed, texts: ['   '] }, { ...embed, texts: ['\uD800'] },
    { ...embed, texts: ['\uDC00'] }, { ...embed, texts: ['abc\v'] }, { ...embed, texts: ['a\u0000b'] },
    { ...embed, texts: ['a\u0085b'] }, { ...embed, texts: ['a\u202Eb'] },
    { ...embed, texts: ['x'.repeat(2049)] }, { ...embed, texts: ['汉'.repeat(683)] },
    { ...embed, texts: [{ text: 'multimodal refused' }] }, { ...embed, texts: [1] },
    { ...embed, texts: Array(2) }, { ...embed, texts: Object.assign(['x'], { extra: true }) },
    Object.defineProperty({ textType: 'document' }, 'texts', { get() { throw new Error(key); } }),
    new Proxy({}, { getPrototypeOf() { throw new Error(key); } }),
  ]) await assert.rejects(p.embed(input, key), safeError('ALIYUN_INPUT_INVALID'));
  for (const input of [{ ...rerank, topN: 0 }, { ...rerank, topN: 4 }, { ...rerank, topN: 1.5 },
    { ...rerank, topN: Infinity }, { ...rerank, query: '' }, { ...rerank, query: 'x'.repeat(513) },
    { ...rerank, documents: [] }, { ...rerank, documents: Array(9).fill('x') },
    { ...rerank, documents: ['x'.repeat(2049)] }, { ...rerank, instruct: 'override' },
    { ...rerank, documents: [{ image: 'https://example.invalid' }] },
    // Each field is within its text bound, but escaping makes the serialized body too large.
    { query: 'q', documents: Array(8).fill('"'.repeat(2048)), topN: 1 },
  ]) await assert.rejects(p.rerank(input, key), safeError('ALIYUN_INPUT_INVALID'));
  for (const secret of [key, 'sk-syntheticprivate183', 'Bearer syntheticprivate183', '-----BEGIN PRIVATE KEY-----'])
    await assert.rejects(p.embed({ ...embed, texts: [secret] }, key), safeError('ALIYUN_SECRET_INPUT'));
  for (const bad of ['', 'short', 'a\r\nx-evil: injected', { ref: 'secret/ref' }])
    await assert.rejects(p.embed(embed, bad), safeError('ALIYUN_CREDENTIAL_INVALID'));
  assert.equal(calls, 0);
});

test('AF-183 embedding checks count, index, dimensions, finite values, native schema and usage', async () => {
  const mutations = [
    d => { d.output.embeddings.pop(); }, d => { d.output.embeddings.push(d.output.embeddings[0]); },
    d => { d.output.embeddings[0].text_index = 0; }, d => { d.output.embeddings[0].text_index = 2; },
    d => { d.output.embeddings[0].text_index = -1; }, d => { d.output.embeddings[0].text_index = 0.5; },
    d => { d.output.embeddings[0].embedding.pop(); }, d => { d.output.embeddings[0].embedding.push(0); },
    d => { d.output.embeddings[0].embedding[0] = '0.2'; }, d => { d.output.embeddings[0].embedding[0] = null; },
    d => { d.output.embeddings[0].text = key; }, d => { d.output.embeddings[0].sparse_embedding = []; },
    d => { d.output.embeddings[0].index = 1; },
    d => { d.output.embeddings[0].index = 1; delete d.output.embeddings[0].text_index; },
    d => { d.embeddings = d.output.embeddings; delete d.output; },
    d => { d.output.embeddings = {}; }, d => { d.output.extra = true; },
    d => { d.request_id = key + '\n'; }, d => { d.unknown = 'PRIVATE-UPSTREAM'; },
  ];
  for (const mutate of mutations) {
    const d = embedding(); mutate(d);
    const p = new AliyunRetrievalProtocol({ request: async () => response(d) });
    await assert.rejects(p.embed(embed, key), safeError('ALIYUN_RESPONSE_INVALID'));
  }
  for (const n of ['1e999', '-1e999']) {
    const raw = JSON.stringify(embedding()).replace('0.25', n);
    await assert.rejects(new AliyunRetrievalProtocol({ request: async () => new Response(raw, { headers: { 'content-type': 'application/json' } }) }).embed(embed, key), safeError('ALIYUN_RESPONSE_INVALID'));
  }
  const current = embedding();
  for (const e of current.output.embeddings) { e.index = e.text_index; delete e.text_index; }
  const currentResult = await new AliyunRetrievalProtocol({ request: async () => response(current) }).embed(embed, key);
  assert.equal(currentResult.readVectors()[0][0], -0.5);
  for (const bad of [null, [], { total_tokens: -1 }, { total_tokens: 1.5 }, { total_tokens: '9' },
    { total_tokens: 2147483648 }, { completion_tokens: 0 }, { total_tokens: 9, cost: 0 }, { total_tokens: null }]) {
    const d = embedding(); d.usage = bad;
    await assert.rejects(new AliyunRetrievalProtocol({ request: async () => response(d) }).embed(embed, key), safeError('ALIYUN_USAGE_INVALID'));
  }
  for (const kind of ['missing', 'empty', 'zero']) {
    const d = embedding();
    if (kind === 'missing') delete d.usage;
    else d.usage = kind === 'empty' ? {} : { total_tokens: 0 };
    const result = await new AliyunRetrievalProtocol({ request: async () => response(d) }).embed(embed, key);
    assert.deepEqual(result.readUsage(), kind === 'zero' ? { state: 'reported', totalTokens: 0 } : { state: 'unknown' });
    assert.equal(result.readUsage().costAmountNanos, undefined);
  }
});

test('AF-183 rerank checks original index, topN, duplicates, score range/order and refuses reflected documents', async () => {
  for (const mutate of [
    d => { d.output.results.pop(); }, d => { d.output.results.push({ index: 1, relevance_score: 0 }); },
    d => { d.output.results[1].index = 2; }, d => { d.output.results[0].index = -1; },
    d => { d.output.results[0].index = 3; }, d => { d.output.results[0].index = 0.5; },
    d => { d.output.results[0].relevance_score = -0.1; }, d => { d.output.results[0].relevance_score = 1.1; },
    d => { d.output.results[1].relevance_score = 1; }, d => { d.output.results[0].relevance_score = '0.9'; },
    d => { d.output.results[0].document = { text: key }; }, d => { d.output.results[0].text = key; },
  ]) {
    const d = ranking(); mutate(d);
    await assert.rejects(new AliyunRetrievalProtocol({ request: async () => response(d) }).rerank(rerank, key), safeError('ALIYUN_RESPONSE_INVALID'));
  }
  const d = ranking(); d.output.results[1].relevance_score = 0.9; delete d.usage;
  const r = await new AliyunRetrievalProtocol({ request: async () => response(d) }).rerank(rerank, key);
  assert.deepEqual(r.readRanks().map(r => r.index), [2, 0]);
  assert.deepEqual(r.readUsage(), { state: 'unknown' });
});

test('AF-183 safe HTTP errors, malformed/empty/huge bodies and no retries', async () => {
  const cases = [
    [() => new Response('PRIVATE-UPSTREAM ' + key, { status: 429 }), 'ALIYUN_RATE_LIMITED'],
    [() => new Response(key, { status: 401 }), 'ALIYUN_AUTH_REJECTED'],
    [() => new Response(key, { status: 403 }), 'ALIYUN_AUTH_REJECTED'],
    [() => new Response(key, { status: 500 }), 'ALIYUN_UPSTREAM_REJECTED'],
    [() => new Response('', { status: 307 }), 'ALIYUN_UPSTREAM_REJECTED'],
    [() => response({ code: 'UnexpectedVendorCode', message: key }), 'ALIYUN_UPSTREAM_REJECTED'],
    [() => response({ error: { message: key } }), 'ALIYUN_UPSTREAM_REJECTED'],
    [() => new Response('<html>' + key, { headers: { 'content-type': 'text/html' } }), 'ALIYUN_RESPONSE_INVALID'],
    ...['', '{', '{}{}', 'null', '[]', '{"output":'].map(raw => [() => new Response(raw, { headers: { 'content-type': 'application/json' } }), 'ALIYUN_RESPONSE_INVALID']),
    [() => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }), 'ALIYUN_RESPONSE_INVALID'],
    [() => new Response('x'.repeat(policy.maxResponseBytes + 1), { headers: { 'content-type': 'application/json' } }), 'ALIYUN_RESPONSE_TOO_LARGE'],
    [() => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': String(policy.maxResponseBytes + 1) } }), 'ALIYUN_RESPONSE_TOO_LARGE'],
    [() => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '3' } }), 'ALIYUN_RESPONSE_INVALID'],
    [() => { throw new Error('PRIVATE-UPSTREAM ' + key); }, 'ALIYUN_TRANSPORT_FAILED'],
  ];
  for (const [make, code] of cases) {
    let calls = 0;
    const p = new AliyunRetrievalProtocol({ request: async () => { calls++; return make(); } });
    await assert.rejects(p.embed(embed, key), safeError(code)); assert.equal(calls, 1);
  }
});

test('AF-183 cancellation reaches boundary, refuses pre-abort and cleans late/stalled responses', async () => {
  const pre = new AbortController(); pre.abort(key);
  await assert.rejects(new AliyunRetrievalProtocol({ request: () => assert.fail('no dispatch') }).embed(embed, key, pre.signal), safeError('ALIYUN_CANCELLED'));
  let finish, seenSignal, cancelled = false;
  const c = new AbortController();
  const p = new AliyunRetrievalProtocol({ request: (_url, init) => { seenSignal = init.signal; return new Promise(r => { finish = r; }); } });
  const pending = p.embed(embed, key, c.signal);
  c.abort(key);
  await assert.rejects(pending, safeError('ALIYUN_CANCELLED')); assert.equal(seenSignal.aborted, true);
  finish(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }));
  await new Promise(r => setImmediate(r)); assert.equal(cancelled, true);
  const stalled = new AbortController();
  let entered;
  const ready = new Promise(r => { entered = r; });
  const slow = new AliyunRetrievalProtocol({ request: async () => new Response(new ReadableStream({
    pull() { entered(); }, cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'application/json' } }) });
  cancelled = false;
  const call = slow.embed(embed, key, stalled.signal); await ready; stalled.abort(key);
  await assert.rejects(call, safeError('ALIYUN_CANCELLED'));
  await new Promise(r => setImmediate(r)); assert.equal(cancelled, true);
});

test('AF-183 isolated compiled source crosses owned HTTP wire with exact JSON, size, 429 and cancellation', async () => {
  let mode = 'embedding', requests = 0, serialized, path, receivedHeaders, slowEntered;
  const server = createServer(async (req, res) => {
    requests++; path = req.url; receivedHeaders = req.headers;
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    serialized = Buffer.concat(chunks).toString('utf8');
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (mode === 'slow') { res.write('{'); slowEntered(); return; }
    if (mode === '429') { res.writeHead(429); res.end('PRIVATE-UPSTREAM ' + key); return; }
    if (mode === 'huge') { res.write('x'.repeat(policy.maxResponseBytes)); res.end('x'); return; }
    res.end(JSON.stringify(mode === 'embedding' ? embedding() : ranking()));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const p = new AliyunRetrievalProtocol({ request: (url, init) => {
    assert.ok([policy.embedding.endpoint, policy.rerank.endpoint].includes(url));
    return fetch(base + new URL(url).pathname, init);
  } });
  try {
    const e = await p.embed(embed, key);
    assert.equal(e.readVectors()[0][0], -0.5);
    assert.equal(path, '/api/v1/services/embeddings/text-embedding/text-embedding');
    assert.equal(receivedHeaders.authorization, `Bearer ${key}`);
    assert.equal(serialized, JSON.stringify({ model: 'text-embedding-v4', input: { texts: embed.texts }, parameters: { text_type: 'document', dimension: 1024, output_type: 'dense' } }));
    mode = 'rerank';
    assert.deepEqual((await p.rerank(rerank, key)).readRanks().map(r => r.index), [2, 0]);
    assert.equal(path, '/api/v1/services/rerank/text-rerank/text-rerank');
    for (const [nextMode, code] of [['429', 'ALIYUN_RATE_LIMITED'], ['huge', 'ALIYUN_RESPONSE_TOO_LARGE']]) {
      mode = nextMode; const before = requests;
      await assert.rejects(p.embed(embed, key), safeError(code)); assert.equal(requests, before + 1);
    }
    mode = 'slow'; const controller = new AbortController();
    const ready = new Promise(r => { slowEntered = r; });
    const pending = p.embed(embed, key, controller.signal); await ready; controller.abort(key);
    await assert.rejects(pending, safeError('ALIYUN_CANCELLED'));
  } finally {
    server.closeAllConnections(); await new Promise(r => server.close(r));
  }
});

test('AF-183 fixed timeout aborts a non-cooperating boundary without retries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0, signal;
  const p = new AliyunRetrievalProtocol({ request: (_url, init) => {
    calls++; signal = init.signal; return new Promise(() => {});
  } });
  const pending = p.embed(embed, key);
  t.mock.timers.tick(policy.timeoutMs);
  await assert.rejects(pending, safeError('ALIYUN_TIMEOUT'));
  assert.equal(signal.aborted, true); assert.equal(calls, 1);
});

test('AF-183 ordinary LF/CR/TAB survive actual embedding and rerank HTTP requests', async () => {
  const layout = '\tSynthetic heading\r\nFirst paragraph\n\tSecond paragraph\rLast line\t';
  const eInput = { texts: [layout, '\t第二段\n保留原文\r\n'], textType: 'document' };
  const rInput = { query: '\tquery\r\nnext line\n', documents: [layout, '\tAnother\nparagraph\r'], topN: 1 };
  let received, requests = 0;
  const server = createServer(async (req, res) => {
    requests++; const parts = []; for await (const part of req) parts.push(part);
    received = JSON.parse(Buffer.concat(parts).toString('utf8'));
    const data = req.url.includes('/embeddings/') ? embedding() : ranking();
    if (data.output.results) data.output.results = [{ index: 1, relevance_score: 0.9 }];
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const p = new AliyunRetrievalProtocol({ request: (url, init) => fetch(base + new URL(url).pathname, init) });
  try {
    assert.equal((await p.embed(eInput, key)).readVectors().length, 2);
    assert.deepEqual(received.input, { texts: eInput.texts });
    assert.deepEqual((await p.rerank(rInput, key)).readRanks(), [{ index: 1, score: 0.9 }]);
    assert.deepEqual(received.input, { query: rInput.query, documents: rInput.documents });
    const before = requests;
    const unsafe = Array.from({ length: 160 }, (_, n) => n)
      .filter(n => (n < 32 || n >= 127) && ![9, 10, 13].includes(n))
      .map(n => `before${String.fromCharCode(n)}after`);
    unsafe.push('a\u202Eb', '\uD800', '\uDC00', '\t\r\n');
    for (const text of unsafe) {
      await assert.rejects(p.embed({ ...embed, texts: [text] }, key), safeError('ALIYUN_INPUT_INVALID'));
      await assert.rejects(p.rerank({ ...rerank, query: text }, key), safeError('ALIYUN_INPUT_INVALID'));
      await assert.rejects(p.rerank({ ...rerank, documents: [text] }, key), safeError('ALIYUN_INPUT_INVALID'));
    }
    assert.equal(requests, before);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test('AF-183 actual fetch decoded HTTP supports bounded compression and fails closed at observable boundaries', { timeout: 30_000 }, async t => {
  let mode = 'ok', coding = 'gzip', requests = 0, wireBytes, decodedBytes, slowEntered, slowClosed;
  const encode = (bytes, encoding) => ({ gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync })[encoding](bytes);
  const server = createServer(async (req, res) => {
    requests++; for await (const part of req) { void part; /* drain owned request */ }
    res.setHeader('content-type', 'application/json');
    if (mode === 'slow') {
      res.setHeader('content-encoding', 'gzip');
      res.on('close', () => slowClosed());
      res.write(gzipSync('{')); slowEntered(); return;
    }
    const data = req.url.includes('/embeddings/') ? embedding() : ranking();
    const raw = Buffer.from(mode === 'decodedHuge' ? ' '.repeat(policy.maxResponseBytes + 1) : mode === 'jsonTruncated' ? '{"output":' : JSON.stringify(data));
    let encoded = mode === 'compound' ? brotliCompressSync(gzipSync(raw)) : coding === 'identity' ? raw : encode(raw, mode === 'unknown' ? 'gzip' : coding);
    const contentEncoding = mode === 'unknown' ? 'compress' : mode === 'compound' ? 'gzip, br' : coding;
    res.setHeader('content-encoding', contentEncoding);
    if (mode === 'gzipTrailerMissing') encoded = encoded.subarray(0, encoded.length - 8);
    if (mode === 'corrupt') { encoded = Buffer.from(encoded); encoded[0] = 0; }
    const declared = mode === 'declaredHuge' ? policy.maxResponseBytes + 1 : mode === 'wrongLength' ? encoded.length + 7 : encoded.length;
    wireBytes = encoded.length; decodedBytes = raw.length;
    res.setHeader('content-length', declared);
    if (mode === 'declaredHuge') { res.flushHeaders(); return; }
    if (mode === 'wrongLength') res.setHeader('connection', 'close');
    res.end(encoded);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const p = new AliyunRetrievalProtocol({ request: (url, init) => fetch(base + new URL(url).pathname, init) });
  const refused = async code => {
    const before = requests;
    await assert.rejects(p.embed(embed, key), safeError(code)); assert.equal(requests, before + 1);
  };
  try {
    await t.test('gzip/deflate/br and identity return valid private embedding and original rerank indices', async () => {
      for (coding of ['gzip', 'deflate', 'br', 'identity']) {
        const e = await p.embed(embed, key);
        assert.equal(e.readVectors()[0][0], -0.5); assert.equal(e.readVectors()[1][0], 0.25);
        assert.deepEqual(e.readUsage(), { state: 'reported', totalTokens: 9 });
        if (coding !== 'identity') assert.notEqual(wireBytes, decodedBytes);
        assert.deepEqual((await p.rerank(rerank, key)).readRanks(), [{ index: 2, score: 0.9 }, { index: 0, score: 0.1 }]);
      }
    });
    await t.test('decoded expansion and encoded length declaration retain independent caps', async () => {
      coding = 'gzip'; mode = 'decodedHuge';
      await refused('ALIYUN_RESPONSE_TOO_LARGE');
      assert.ok(wireBytes < policy.maxResponseBytes); assert.ok(decodedBytes > policy.maxResponseBytes);
      mode = 'declaredHuge'; await refused('ALIYUN_RESPONSE_TOO_LARGE');
    });
    await t.test('unknown and compound encodings are refused; identity, compressed framing and substantive truncation fail', async () => {
      for (mode of ['unknown', 'compound']) { coding = 'gzip'; await refused('ALIYUN_RESPONSE_INVALID'); }
      for (coding of ['identity', 'gzip']) { mode = 'wrongLength'; await refused('ALIYUN_TRANSPORT_FAILED'); }
      for (coding of ['gzip', 'deflate', 'br']) {
        mode = 'corrupt'; await refused('ALIYUN_TRANSPORT_FAILED');
        mode = 'jsonTruncated'; await refused('ALIYUN_RESPONSE_INVALID');
      }
    });
    await t.test('records Node fetch gzip trailer tolerance without claiming independent CRC/trailer verification', async () => {
      coding = 'gzip'; mode = 'gzipTrailerMissing';
      // Real fetch may deliver complete JSON despite the absent gzip footer. The Response
      // interface hides encoded bytes; acceptance here is recorded, never called a refusal.
      const r = await p.embed(embed, key);
      assert.equal(r.readVectors()[0][0], -0.5); assert.deepEqual(r.readUsage(), { state: 'reported', totalTokens: 9 });
    });
    await t.test('cancellation aborts compressed HTTP body and the owned server observes socket cleanup', async () => {
      mode = 'slow'; const c = new AbortController();
      const ready = new Promise(r => { slowEntered = r; });
      const closed = new Promise(r => { slowClosed = r; });
      const pending = p.embed(embed, key, c.signal); await ready; c.abort(key);
      await assert.rejects(pending, safeError('ALIYUN_CANCELLED')); await closed;
    });
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
