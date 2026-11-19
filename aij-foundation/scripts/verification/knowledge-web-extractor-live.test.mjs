// ROOT ONLY: after adding the real API dependency and building API. No source transpilation/scratch fallback.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:https';
import { createRequire } from 'node:module';
import path from 'node:path';
import { connect } from 'node:tls';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const compiledDirectory = path.resolve(process.env.AF174_COMPILED_API_DIR || path.join(root, 'apps/api/dist'));
const compiledFile = path.join(compiledDirectory, 'plugins/aij-ai/knowledge-web-extractor.js');
const compiledRequire = createRequire(compiledFile);
const { default: extract, KnowledgeWebExtractorError } = compiledRequire(compiledFile);
const { KnowledgeWebReader } = compiledRequire(path.join(compiledDirectory, 'plugins/aij-ai/knowledge-web-reader.js'));
assert.equal(JSON.parse(readFileSync(path.resolve(path.dirname(compiledRequire.resolve('htmlparser2')), '../../package.json'), 'utf8')).version, '10.1.0');
const checksum = value => createHash('sha256').update(value).digest('hex');
const safeRefusal = async (promise, code) => assert.rejects(promise, error => {
  assert.ok(error instanceof KnowledgeWebExtractorError);
  assert.equal(error.code, code); assert.equal(error.message, code);
  assert.equal(error.cause, undefined);
  return true;
});

test('AF174 compiled API extractor + actual AF171 HTTPS reader on owned trusted loopback fixture', { timeout: 20000 }, async t => {
  const artifacts = path.join(root, '.artifacts/af174');
  mkdirSync(artifacts, { recursive: true });
  const owned = mkdtempSync(path.join(artifacts, 'owned-https-'));
  const host = 'extractor-fixture.aij-acceptance.net';
  const key = path.join(owned, 'fixture.key'), cert = path.join(owned, 'fixture.pem');
  const sockets = new Set();
  let server;
  let fixtureRequests = 0, conditionalRequests = 0, transportCalls = 0;
  const beforeGlobal = globalThis.__af174Executed;
  const originalFetch = globalThis.fetch;
  let executedFetches = 0;
  const html = '<!doctype html><html><head><title> 合成 &amp; 正文 </title></head><body><nav>excluded fallback</nav><main><article><h1>知识正文</h1><p>中文 &amp; Unicode 🧭</p><script>globalThis.__af174Executed=1;fetch("https://sentinel.invalid/execute");</script><div hidden>private hidden sentinel</div><iframe src="https://sentinel.invalid/frame">sentinel</iframe><a href="https://sentinel.invalid/follow">safe link</a><table><tr><td>甲</td><td>乙</td></tr></table></article></main></body></html>';
  const expectedText = '知识正文\n\n中文 & Unicode 🧭\n\nsafe link\n甲\t乙';
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', `/CN=${host}`,
      '-addext', `subjectAltName=DNS:${host}`, '-keyout', key, '-out', cert], { stdio: 'ignore' });
    const certificate = readFileSync(cert);
    server = createServer({ key: readFileSync(key), cert: certificate }, (req, res) => {
      fixtureRequests++;
      if (req.url === '/html' && req.headers['if-none-match'] === '"af174-synthetic"') {
        conditionalRequests++; res.writeHead(304, { ETag: '"af174-synthetic"' }); res.end(); return;
      }
      if (req.url === '/plain') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(' 合成\t plain\r\n正文 '); return; }
      if (req.url !== '/html') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ETag: '"af174-synthetic"' });
      res.end(html);
    });
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    const reader = new KnowledgeWebReader({
      // Trusted composition seam routes an allowed syntactic hostname to our own fixture; no public DNS/HTTP.
      resolve: async () => [{ address: '1.1.1.1', family: 4 }],
      connect: options => {
        transportCalls++;
        assert.equal(options.host, host); assert.equal(options.port, 443);
        assert.equal(options.rejectUnauthorized, true);
        const socket = connect({ ...options, host: '127.0.0.1', port, ca: certificate, lookup: undefined });
        sockets.add(socket); socket.once('close', () => sockets.delete(socket));
        return socket;
      },
    });
    globalThis.fetch = () => { executedFetches++; throw new Error('EXECUTION_FORBIDDEN'); };
    let fetched;
    await t.test('real bytes/hash/text through reader and actual default parser produce bounded untrusted data', async () => {
      fetched = await reader.read(`https://${host}/html`);
      assert.equal(fetched.state, 'fetched');
      assert.equal(fetched.byteLength, Buffer.byteLength(html));
      assert.equal(fetched.checksum, checksum(Buffer.from(html)));
      assert.equal(fetched.text, html);
      const result = await extract(fetched);
      assert.equal(result.text, expectedText); assert.equal(result.title, '合成 & 正文');
      assert.equal(result.sourceByteLength, fetched.byteLength);
      assert.equal(result.sourceChecksum, fetched.checksum);
      assert.equal(result.textChecksum, checksum(expectedText));
      assert.equal(result.textByteLength, Buffer.byteLength(expectedText));
      assert.equal(executedFetches, 0); assert.equal(globalThis.__af174Executed, beforeGlobal);
      assert.equal(transportCalls, 1); assert.equal(fixtureRequests, 1);
      assert.equal(JSON.stringify(result).includes('sentinel'), false);
    });
    await t.test('reader 304 explicitly refuses extraction; owner must choose persisted extracted version', async () => {
      const cached = await reader.read(`https://${host}/html`, { cache: {
        sourceUrl: fetched.sourceUrl, checksum: fetched.checksum, contentType: fetched.contentType, etag: fetched.etag,
      } });
      assert.equal(cached.state, 'not-modified'); assert.equal('bytes' in cached, false);
      await safeRefusal(extract(cached), 'NOT_MODIFIED');
      assert.equal(conditionalRequests, 1);
    });
    await t.test('plain actual reader result and malformed checksum/bytes refuse without publication', async () => {
      const plain = await reader.read(`https://${host}/plain`);
      assert.equal((await extract(plain)).text, '合成 plain\n正文');
      await safeRefusal(extract({ ...fetched, checksum: '0'.repeat(64) }), 'CHECKSUM_MISMATCH');
      await safeRefusal(extract({ ...fetched, text: 'different synthetic bytes' }), 'TEXT_INVALID');
      assert.equal(fixtureRequests, 3); assert.equal(transportCalls, 3);
      assert.equal(executedFetches, 0); assert.equal(globalThis.__af174Executed, beforeGlobal);
    });
  } finally {
    globalThis.fetch = originalFetch;
    try {
      if (server?.listening) {
        const closures = [...sockets].map(socket => new Promise(resolve => socket.once('close', resolve)));
        const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
        server.closeAllConnections();
        await Promise.all([closed, ...closures]);
        assert.equal(server.listening, false);
      }
      assert.equal(sockets.size, 0, 'owned fixture sockets must be zero');
    } finally { rmSync(owned, { recursive: true }); }
  }
});
