/** ROOT ONLY: compiled adapter + exclusively owned DNS/HTTPS fixtures. Worker status: NOT_RUN.
 * No external requests. Test socket routing and fixture CA are local to this test process;
 * production policy, trust store, environment and address rules are never changed.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { Resolver } from 'node:dns/promises';
import { getEventListeners, once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:https';
import { Socket } from 'node:net';
import { resolve } from 'node:path';
import { connect } from 'node:tls';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

if (!process.env.AF171_COMPILED_READER || !/\.c?js$/.test(process.env.AF171_COMPILED_READER)) throw new Error('AF171_COMPILED_READER_REQUIRED');
const { KnowledgeWebReader, KnowledgeWebReaderError, knowledgeWebReader } = await import(pathToFileURL(resolve(process.env.AF171_COMPILED_READER)));
const source = 'https://reader.fixture.net';
const selected = { address: '93.184.215.14', family: 4 };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function denied(promise, codes) {
  await assert.rejects(promise, error => error instanceof KnowledgeWebReaderError && (Array.isArray(codes) ? codes : [codes]).includes(error.code) && error.message === error.code && !('cause' in error));
}
async function waitFor(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await pause(10); }
  assert.ok(predicate(), 'owned fixture cleanup completed');
}

test('AF-171 root compiled adapter: owned sockets/TLS/stream and separate production pin/refusal proofs', { timeout: 30000 }, async t => {
  await mkdir('.artifacts', { recursive: true });
  const dir = await mkdtemp(resolve('.artifacts/af171-live-'));
  const sockets = new Set();
  const dns = createSocket('udp4');
  let server;
  let dnsMode = 'public';
  let dnsCount = 0;
  let accepted = 0;
  let connections = 0;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/fixture.key`, '-out', `${dir}/fixture.pem`, '-days', '1', '-subj', '/CN=reader.fixture.net', '-addext', 'subjectAltName=DNS:reader.fixture.net,DNS:other.fixture.net'], { stdio: 'ignore' });
    const key = await readFile(`${dir}/fixture.key`); const cert = await readFile(`${dir}/fixture.pem`);
    server = createServer({ key, cert }, (req, res) => {
      accepted++;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const path = req.url.split('?')[0];
      if (path === '/slow-header') return;
      if (path === '/slow-body') { res.writeHead(200); res.write('x'); return; }
      if (path === '/redirect') { res.writeHead(302, { Location: 'https://other.fixture.net/text' }); res.end(); return; }
      if (path === '/downgrade') { res.writeHead(302, { Location: 'http://reader.fixture.net/text' }); res.end(); return; }
      if (path === '/private') { res.writeHead(302, { Location: 'https://hidden.fixture.net/text' }); res.end(); return; }
      if (path === '/html') { res.setHeader('Content-Type', 'text/html'); res.end('<script>untrustedDataOnly()</script>'); return; }
      if (path === '/bad-utf8') { res.end(Buffer.from([0xff])); return; }
      if (path === '/encoded') { res.setHeader('Content-Encoding', 'gzip'); res.end('synthetic'); return; }
      if (path === '/oversize') { res.writeHead(200); res.write('x'.repeat(1024 * 1024)); res.end('x'); return; }
      if (path === '/length-lie') { res.setHeader('Content-Length', '100'); res.end('x'); return; }
      if (path === '/always304') { res.writeHead(304); res.end(); return; }
      if (path === '/cache') { res.setHeader('ETag', '"fixture-v1"'); res.writeHead(req.headers['if-none-match'] === '"fixture-v1"' ? 304 : 200); res.end(req.headers['if-none-match'] ? undefined : 'fixture cache'); return; }
      if (path === '/chunked') { res.writeHead(200); res.write('chunk '); res.end('two'); return; }
      res.end('fixture text');
    });
    server.on('connection', socket => { connections++; sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
    server.on('clientError', (_error, socket) => socket.destroy());
    server.on('tlsClientError', () => {});
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const port = server.address().port;
    // Minimal owned DNS authoritative response: only A and AAAA, no forwarding.
    dns.on('message', (query, peer) => {
      dnsCount++;
      let end = 12;
      while (end < query.length && query[end] !== 0) end += query[end] + 1;
      end++;
      if (end + 4 > query.length) return;
      const qtype = query.readUInt16BE(end);
      const header = Buffer.alloc(12); query.copy(header, 0, 0, 2); header.writeUInt16BE(0x8180, 2); header.writeUInt16BE(1, 4);
      const answer = qtype === 1 ? Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 1, 0, 4, ...(dnsMode === 'private' ? [127, 0, 0, 1] : [93, 184, 215, 14])]) : Buffer.alloc(0);
      header.writeUInt16BE(answer.length ? 1 : 0, 6);
      dns.send(Buffer.concat([header, query.subarray(12, end + 4), answer]), peer.port, peer.address);
    });
    dns.bind(0, '127.0.0.1'); await once(dns, 'listening');
    const dnsTarget = `127.0.0.1:${dns.address().port}`;
    // Route the production Resolver's queries exclusively to owned UDP; no production resolver config seam.
    const routed = new WeakSet();
    for (const method of ['resolve4', 'resolve6']) {
      const original = Resolver.prototype[method];
      t.mock.method(Resolver.prototype, method, function (...args) {
        if (!routed.has(this)) { this.setServers([dnsTarget]); routed.add(this); }
        return original.apply(this, args);
      });
    }
    await t.test('default exported reader denies actual private DNS A answer before any TCP connection', async () => {
      dnsMode = 'private'; const before = connections; const queries = dnsCount;
      await denied(knowledgeWebReader.read(source + '/text'), 'ADDRESS_REJECTED');
      assert.equal(connections, before); assert.ok(dnsCount >= queries + 2);
    });
    await t.test('production default connector supplies checked IP to Node socket lookup; refused before external connection', async sub => {
      dnsMode = 'public'; let pins = 0;
      // Intercept the syscall boundary, consume the *real* lookup passed by production tls.connect,
      // then synthesize ECONNREFUSED without dialing the approved public address.
      sub.mock.method(Socket.prototype, 'connect', function (...args) {
        const options = Array.isArray(args[0]) ? args[0][0] : args[0];
        assert.equal(options.host, 'reader.fixture.net'); assert.equal(options.port, 443);
        options.lookup(options.host, { all: false }, (error, address, family) => { assert.ifError(error); assert.equal(address, selected.address); assert.equal(family, 4); pins++; });
        process.nextTick(() => this.destroy(Object.assign(new Error('OWNED_REFUSAL'), { code: 'ECONNREFUSED' })));
        return this;
      });
      await denied(knowledgeWebReader.read(source + '/text'), 'TRANSPORT_FAILED'); assert.equal(pins, 1);
      sub.mock.restoreAll();
    });
    await t.test('production default TLS rejects owned self-signed certificate with original servername/CA validation', async sub => {
      const original = Socket.prototype.connect; let pins = 0;
      // Test-only socket route after inspecting the real pinned lookup, preserving the default TLS trust policy.
      sub.mock.method(Socket.prototype, 'connect', function (...args) {
        const options = Array.isArray(args[0]) ? args[0][0] : args[0];
        assert.equal(options.host, 'reader.fixture.net');
        options.lookup(options.host, { all: false }, (error, address) => { assert.ifError(error); assert.equal(address, selected.address); pins++; });
        const callback = Array.isArray(args[0]) ? args[0][1] : args[1];
        return original.call(this, { ...options, host: '127.0.0.1', port, lookup: undefined, family: 4 }, ...(typeof callback === 'function' ? [callback] : []));
      });
      const before = accepted;
      await denied(knowledgeWebReader.read(source + '/text'), 'TLS_FAILED'); assert.equal(accepted, before); assert.equal(pins, 1);
      sub.mock.restoreAll();
    });
    // Only this trusted fixture constructor connector adds the ephemeral CA and routes to loopback.
    // The approved address is inspected separately; this routing is NOT default/public-network proof.
    let routedConnections = 0;
    const reader = new KnowledgeWebReader({
      resolve: async hostname => hostname === 'hidden.fixture.net' ? [{ address: '127.0.0.1', family: 4 }] : [selected],
      connect: options => {
        assert.equal(options.rejectUnauthorized, true); assert.equal(options.port, 443);
        options.lookup(options.host, { all: false }, (error, address, family) => { assert.ifError(error); assert.equal(address, selected.address); assert.equal(family, 4); });
        routedConnections++;
        return connect({ ...options, host: '127.0.0.1', port, family: 4, ca: cert });
      },
      timeouts: { overallMs: 2000, headersMs: 500, readMs: 200 },
    });
    await t.test('owned actual HTTPS bytes, HTML data, chunked response and re-pinned redirect', async () => {
      assert.equal((await reader.read(source + '/text')).text, 'fixture text');
      assert.equal((await reader.read(source + '/html')).contentType, 'text/html');
      assert.equal((await reader.read(source + '/chunked')).text, 'chunk two');
      const redirected = await reader.read(source + '/redirect'); assert.equal(redirected.redirectCount, 1); assert.equal(redirected.sourceUrl, 'https://other.fixture.net/text');
    });
    await t.test('actual HTTPS refusal paths and cache metadata-only update', async () => {
      await denied(reader.read(source + '/downgrade'), 'REDIRECT_REJECTED');
      await denied(reader.read(source + '/private'), 'ADDRESS_REJECTED');
      await denied(reader.read(source + '/bad-utf8'), 'BODY_INVALID');
      await denied(reader.read(source + '/encoded'), 'ENCODING_REJECTED');
      await denied(reader.read(source + '/oversize'), 'BODY_TOO_LARGE');
      await denied(reader.read(source + '/length-lie'), ['BODY_INVALID', 'TRANSPORT_FAILED', 'READ_TIMEOUT']);
      await denied(reader.read(source + '/always304'), 'CACHE_INVALID');
      const first = await reader.read(source + '/cache');
      const cache = { sourceUrl: first.sourceUrl, checksum: first.checksum, contentType: first.contentType, etag: first.etag };
      const unchanged = await reader.read(source + '/cache', { cache }); assert.equal(unchanged.state, 'not-modified'); assert.equal('text' in unchanged, false); assert.equal('bytes' in unchanged, false);
    });
    await t.test('actual header/read timeout, abort and fixture socket/listener cleanup', async () => {
      await denied(reader.read(source + '/slow-header'), 'HEADERS_TIMEOUT');
      await denied(reader.read(source + '/slow-body'), 'READ_TIMEOUT');
      const controller = new AbortController(); const pending = reader.read(source + '/slow-body', { signal: controller.signal });
      await pause(20); controller.abort('synthetic'); await denied(pending, 'CANCELLED');
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
      await waitFor(() => sockets.size === 0); assert.ok(routedConnections > 0);
    });
    t.diagnostic(`owned fixture counts: DNS=${dnsCount}, TCP=${connections}, HTTPS=${accepted}, mappedTLS=${routedConnections}`);
  } finally {
    t.mock.restoreAll();
    for (const socket of sockets) socket.destroy();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    try { await new Promise(resolve => dns.close(resolve)); } catch { /* no bound fixture */ }
    await rm(dir, { recursive: true, force: true });
  }
});
