import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { inspect } from 'node:util';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import test from 'node:test';

// ROOT ONLY: run after the actual whole API build and workspace package builds.
// "live" means an owned loopback wire, NEVER a billed Aliyun call.
// No environment URL override and no real credentials are read.
const require = createRequire(import.meta.url);
const { AiCenterHttpTransport } = require('../../apps/api/dist/plugins/aij-ai/ai-center-provider.js');
const { AliyunRetrievalProtocol, ALIYUN_RETRIEVAL_POLICY: policy } = require('../../apps/api/dist/plugins/aij-ai/aliyun-retrieval-protocol.js');
const key = 'synthetic-only-af183-wire';
const eInput = { texts: ['synthetic alpha', 'synthetic beta'], textType: 'query' };
const rInput = { query: 'synthetic query', documents: ['synthetic A', 'synthetic B', 'synthetic C'], topN: 2 };
const embedding = () => ({ request_id: 'synthetic-wire-183', output: { embeddings: [
  { text_index: 1, embedding: Array(1024).fill(0.125) }, { text_index: 0, embedding: Array(1024).fill(-0.25) },
] }, usage: { total_tokens: 8 } });
const ranking = () => ({ request_id: 'synthetic-wire-183', output: { results: [
  { index: 2, relevance_score: 0.8 }, { index: 0, relevance_score: 0.2 },
] }, usage: { total_tokens: 16 } });

test('AF-183 root whole-API compiled protocol + actual AiCenterHttpTransport owned HTTP wire', { timeout: 30_000 }, async t => {
  let mode = 'ok', requests = 0, slowEntered, lastRequest, coding = 'identity', wireBytes, decodedBytes, slowClosed;
  const encode = (bytes, encoding) => ({ gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync })[encoding](bytes);
  const server = createServer(async (req, res) => {
    requests++;
    const parts = []; for await (const part of req) parts.push(part);
    lastRequest = { method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(parts).toString('utf8') };
    res.setHeader('content-type', 'application/json');
    if (mode === 'slow') { res.write('{'); slowEntered(); return; }
    if (mode === 'gzipSlow') {
      res.setHeader('content-encoding', 'gzip'); res.on('close', () => slowClosed());
      res.write(gzipSync('{')); slowEntered(); return;
    }
    if (mode === 'huge') { res.write('x'.repeat(policy.maxResponseBytes)); res.end('x'); return; }
    if (mode === 'declaredHuge') { res.setHeader('content-length', policy.maxResponseBytes + 1); res.flushHeaders(); return; }
    if (mode === '429') { res.writeHead(429); res.end(key + ' synthetic private error'); return; }
    if (mode === '401') { res.writeHead(401); res.end(key); return; }
    if (mode === 'redirect') { res.writeHead(307, { location: '/must-never-follow' }); res.end(); return; }
    if (mode === 'html') { res.setHeader('content-type', 'text/html'); res.end('<html>' + key); return; }
    if (mode === 'empty') { res.end(); return; }
    if (mode === 'truncated') { res.end('{"output":'); return; }
    if (mode === 'unknownError') { res.end(JSON.stringify({ code: 'UnknownVendorFailure', message: key })); return; }
    const data = req.url.includes('/embeddings/') ? embedding() : ranking();
    if (mode === 'duplicate') data.output.results[1].index = 2;
    if (mode === 'reflection') data.output.results[0].document = { text: key };
    if (mode === 'badDimension') data.output.embeddings[0].embedding.pop();
    const raw = Buffer.from(mode === 'decodedHuge' ? ' '.repeat(policy.maxResponseBytes + 1) : mode === 'compressedJsonTruncated' ? '{"output":' : JSON.stringify(data));
    const contentEncoding = mode === 'unknownEncoding' ? 'compress' : mode === 'compoundEncoding' ? 'gzip, br' : coding;
    let encoded = mode === 'compoundEncoding' ? brotliCompressSync(gzipSync(raw)) : coding === 'identity' ? raw : encode(raw, coding);
    if (mode === 'gzipTrailerMissing') encoded = encoded.subarray(0, encoded.length - 8);
    if (mode === 'compressedCorrupt') { encoded = Buffer.from(encoded); encoded[0] = 0; }
    wireBytes = encoded.length; decodedBytes = raw.length;
    res.setHeader('content-encoding', contentEncoding);
    res.setHeader('content-length', mode === 'encodedDeclaredHuge' ? policy.maxResponseBytes + 1 : mode === 'wrongLength' ? encoded.length + 7 : encoded.length);
    if (mode === 'encodedDeclaredHuge') { res.flushHeaders(); return; }
    if (mode === 'wrongLength') res.setHeader('connection', 'close');
    res.end(encoded);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const actual = new AiCenterHttpTransport();
  const p = new AliyunRetrievalProtocol({ request: (url, init) => {
    assert.ok([policy.embedding.endpoint, policy.rerank.endpoint].includes(url));
    // This remap belongs only to the owned fixture; product code has no URL override.
    return actual.request(base + new URL(url).pathname, init);
  } });
  const refused = async (method, code) => {
    const before = requests;
    await assert.rejects(method(), error => {
      assert.equal(error.message, code); assert.equal(error.code, code);
      for (const privateText of [key, ...eInput.texts, rInput.query, ...rInput.documents])
        assert.equal(inspect(error).includes(privateText), false);
      return true;
    });
    assert.equal(requests, before + 1, 'one request, no retry/failover');
  };
  try {
    await t.test('serialized native embedding/query and rerank use real network and original indices', async () => {
      const e = await p.embed(eInput, key);
      assert.equal(e.readVectors()[0][0], -0.25); assert.equal(e.readVectors()[1][0], 0.125);
      assert.deepEqual(e.readUsage(), { state: 'reported', totalTokens: 8 });
      assert.equal(lastRequest.method, 'POST'); assert.equal(lastRequest.headers.authorization, `Bearer ${key}`);
      assert.equal(lastRequest.headers['content-type'], 'application/json');
      assert.equal(lastRequest.path, '/api/v1/services/embeddings/text-embedding/text-embedding');
      assert.equal(lastRequest.body, JSON.stringify({ model: 'text-embedding-v4', input: { texts: eInput.texts }, parameters: { text_type: 'query', dimension: 1024, output_type: 'dense' } }));
      const r = await p.rerank(rInput, key);
      assert.deepEqual(r.readRanks(), [{ index: 2, score: 0.8 }, { index: 0, score: 0.2 }]);
      assert.equal(lastRequest.path, '/api/v1/services/rerank/text-rerank/text-rerank');
      assert.equal(lastRequest.body, JSON.stringify({ model: 'qwen3-rerank', input: { query: rInput.query, documents: rInput.documents }, parameters: { top_n: 2, return_documents: false } }));
      assert.deepEqual(r.readUsage(), { state: 'reported', totalTokens: 16 });
    });
    await t.test('HTTP status, schema, content, streaming size and redirect refusal', async () => {
      for (const [nextMode, code] of [
        ['429', 'ALIYUN_RATE_LIMITED'], ['401', 'ALIYUN_AUTH_REJECTED'],
        ['redirect', 'ALIYUN_TRANSPORT_FAILED'], ['html', 'ALIYUN_RESPONSE_INVALID'],
        ['empty', 'ALIYUN_RESPONSE_INVALID'], ['truncated', 'ALIYUN_RESPONSE_INVALID'],
        ['huge', 'ALIYUN_RESPONSE_TOO_LARGE'], ['declaredHuge', 'ALIYUN_RESPONSE_TOO_LARGE'],
        ['unknownError', 'ALIYUN_UPSTREAM_REJECTED'], ['badDimension', 'ALIYUN_RESPONSE_INVALID'],
      ]) { mode = nextMode; await refused(() => p.embed(eInput, key), code); }
      for (mode of ['duplicate', 'reflection']) await refused(() => p.rerank(rInput, key), 'ALIYUN_RESPONSE_INVALID');
    });
    await t.test('abort cancels actual owned HTTP response and never admits a late result', async () => {
      mode = 'slow'; const c = new AbortController();
      const ready = new Promise(r => { slowEntered = r; });
      const before = requests, pending = p.embed(eInput, key, c.signal);
      await ready; c.abort(key);
      await assert.rejects(pending, error => error.code === 'ALIYUN_CANCELLED' && !inspect(error).includes(key));
      assert.equal(requests, before + 1);
    });
    await t.test('LF/CR/TAB survive actual embedding and rerank serialized inputs unchanged', async () => {
      mode = 'ok'; coding = 'identity';
      const formatted = '\tSynthetic heading\r\nFirst paragraph\n\tSecond paragraph\r';
      const e = { ...eInput, texts: [formatted, '\t第二段\n保留原文\r\n'] };
      const r = { ...rInput, query: '\tquery\r\nnext\n', documents: [formatted, 'A\nB\rC\tD', '\tThird\r\n'] };
      await p.embed(e, key); assert.deepEqual(JSON.parse(lastRequest.body).input, { texts: e.texts });
      await p.rerank(r, key); assert.deepEqual(JSON.parse(lastRequest.body).input, { query: r.query, documents: r.documents });
      const before = requests;
      for (const text of ['a\u0000b', 'a\vb', 'a\u007Fb', 'a\u0085b', 'a\u202Eb', '\uD800', '\t\r\n']) {
        await assert.rejects(p.embed({ ...eInput, texts: [text] }, key), error => error.code === 'ALIYUN_INPUT_INVALID');
        await assert.rejects(p.rerank({ ...rInput, query: text }, key), error => error.code === 'ALIYUN_INPUT_INVALID');
      }
      assert.equal(requests, before);
    });
    await t.test('gzip/deflate/br decoded body and encoded Content-Length use separate byte domains', async () => {
      mode = 'ok';
      for (coding of ['gzip', 'deflate', 'br', 'identity']) {
        const e = await p.embed(eInput, key);
        assert.equal(e.readVectors()[0][0], -0.25); assert.deepEqual(e.readUsage(), { state: 'reported', totalTokens: 8 });
        if (coding !== 'identity') assert.notEqual(wireBytes, decodedBytes);
        assert.deepEqual((await p.rerank(rInput, key)).readRanks(), [{ index: 2, score: 0.8 }, { index: 0, score: 0.2 }]);
      }
      coding = 'gzip'; mode = 'decodedHuge'; await refused(() => p.embed(eInput, key), 'ALIYUN_RESPONSE_TOO_LARGE');
      assert.ok(wireBytes < policy.maxResponseBytes); assert.ok(decodedBytes > policy.maxResponseBytes);
      mode = 'encodedDeclaredHuge'; await refused(() => p.embed(eInput, key), 'ALIYUN_RESPONSE_TOO_LARGE');
    });
    await t.test('compressed unknown/stacked encodings, framing, decoding, JSON and schema errors refuse', async () => {
      coding = 'gzip';
      for (mode of ['unknownEncoding', 'compoundEncoding']) await refused(() => p.embed(eInput, key), 'ALIYUN_RESPONSE_INVALID');
      for (coding of ['identity', 'gzip']) { mode = 'wrongLength'; await refused(() => p.embed(eInput, key), 'ALIYUN_TRANSPORT_FAILED'); }
      for (coding of ['gzip', 'deflate', 'br']) {
        mode = 'compressedCorrupt'; await refused(() => p.embed(eInput, key), 'ALIYUN_TRANSPORT_FAILED');
        mode = 'compressedJsonTruncated'; await refused(() => p.embed(eInput, key), 'ALIYUN_RESPONSE_INVALID');
      }
      coding = 'gzip'; mode = 'badDimension'; await refused(() => p.embed(eInput, key), 'ALIYUN_RESPONSE_INVALID');
      mode = 'duplicate'; await refused(() => p.rerank(rInput, key), 'ALIYUN_RESPONSE_INVALID');
    });
    await t.test('records real Node fetch missing gzip trailer tolerance as an explicit guarantee boundary', async () => {
      coding = 'gzip'; mode = 'gzipTrailerMissing';
      assert.equal((await p.embed(eInput, key)).readVectors()[0][0], -0.25);
      // Accepted complete decoded JSON is NOT evidence of independent gzip CRC/trailer validation.
    });
    await t.test('compressed response cancellation aborts actual transport and closes the owned socket', async () => {
      mode = 'gzipSlow'; const c = new AbortController();
      const ready = new Promise(r => { slowEntered = r; }), closed = new Promise(r => { slowClosed = r; });
      const pending = p.embed(eInput, key, c.signal); await ready; c.abort(key);
      await assert.rejects(pending, error => error.code === 'ALIYUN_CANCELLED' && !inspect(error).includes(key));
      await closed;
    });
  } finally {
    server.closeAllConnections(); await new Promise(r => server.close(r));
  }
});
