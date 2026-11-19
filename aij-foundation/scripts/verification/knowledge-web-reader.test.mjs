import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getEventListeners } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Duplex } from 'node:stream';
import test from 'node:test';
import { checkServerIdentity } from 'node:tls';

const moduleUrl = process.env.AF171_COMPILED_READER ? pathToFileURL(resolve(process.env.AF171_COMPILED_READER)) : new URL('../../apps/api/src/plugins/aij-ai/knowledge-web-reader.ts', import.meta.url);
const { KnowledgeWebReader, KnowledgeWebReaderError, normalizeKnowledgeWebUrl, isPublicKnowledgeWebAddress, knowledgeWebReader } = await import(moduleUrl);
const source = 'https://reader.fixture.net/resource';
const publicAnswer = [{ address: '93.184.215.14', family: 4 }];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const response = (body = 'synthetic text', headers = {}, status = 200) => Buffer.concat([
  Buffer.from(`HTTP/1.1 ${status} Fixture\r\n${Object.entries({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...headers }).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`), Buffer.from(body),
]);
/** In-memory Node HTTP parser/stream unit seam. This is NOT live TLS/network proof. */
function fixture(responses = [response()], overrides = {}) {
  const state = { connections: 0, resolutions: 0, destroyed: 0, lookups: [], requests: [], dnsSignals: [], options: [] };
  const dependencies = {
    resolve: async (_host, signal) => { state.resolutions++; state.dnsSignals.push(signal); return publicAnswer; },
    connect: options => {
      state.connections++;
      state.options.push(options);
      options.lookup(options.host, { all: false }, (error, address, family) => { assert.ifError(error); state.lookups.push({ address, family }); });
      let received = '';
      let sent = false;
      let socket;
      const plan = responses[Math.min(state.connections - 1, responses.length - 1)];
      socket = new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          received += chunk.toString();
          if (!sent && received.includes('\r\n\r\n')) {
            sent = true; state.requests.push(received);
            setImmediate(async () => {
              if (typeof plan === 'function') { await plan(socket); return; }
              if (!socket.destroyed) { socket.push(plan); socket.push(null); }
            });
          }
          callback();
        },
        destroy(error, callback) { state.destroyed++; callback(error); },
      });
      socket.setTimeout = () => socket; socket.setNoDelay = () => socket; socket.setKeepAlive = () => socket;
      return socket;
    },
    ...overrides,
  };
  return { reader: new KnowledgeWebReader(dependencies), state, dependencies };
}
async function rejectsCode(promise, codes) {
  await assert.rejects(promise, error => error instanceof KnowledgeWebReaderError && (Array.isArray(codes) ? codes : [codes]).includes(error.code) && error.message === error.code && !('cause' in error));
}

test('URL normalization accepts canonical HTTPS DNS and rejects alternate/ambiguous authorities', async () => {
  assert.equal(normalizeKnowledgeWebUrl('HTTPS://READER.FIXTURE.NET:443/a/../b?q=%E4%B8%AD').href, 'https://reader.fixture.net/b?q=%E4%B8%AD');
  assert.equal(normalizeKnowledgeWebUrl('https://xn--bcher-kva.de/').hostname, 'xn--bcher-kva.de');
  const bad = [
    'http://reader.fixture.net', 'https://reader.fixture.net:444', 'https://reader.fixture.net:', 'https://reader.fixture.net:0443',
    'https://x:y@reader.fixture.net', 'https://@reader.fixture.net', 'https://reader.fixture.net/#', 'https://reader.fixture.net/#x',
    ' https://reader.fixture.net', 'https://reader.fixture.net/\n', 'https://reader.fixture.net\\evil', 'https://reader.fixture.net/%', 'https://reader.fixture.net/%ff',
    'https://%72eader.fixture.net', 'https://bücher.de', 'https://reader.fixture.net.', 'https://a..net', 'https://-x.net', 'https://x_.net', 'https://xn--.net',
    'https://localhost', 'https://local', 'https://a.local', 'https://a.internal', 'https://a.test', 'https://a.invalid', 'https://metadata.google.com',
    'https://instance-data.ec2.com', 'https://example.org', 'https://a.example.com', 'https://a.home.arpa', 'https://reader.fixture.123',
    'https://127.0.0.1', 'https://2130706433', 'https://0x7f000001', 'https://0177.0.0.1', 'https://127.1', 'https://8.8.8.8', 'https://0x08080808',
    'https://[::1]', 'https://[2001:4860::8888]', 'https://[::ffff:127.0.0.1]', 'https://reader.fixture.net/' + 'x'.repeat(2048),
  ];
  for (const value of bad) assert.throws(() => normalizeKnowledgeWebUrl(value), error => error.code === 'URL_REJECTED');
  await rejectsCode(knowledgeWebReader.read('http://localhost'), 'URL_REJECTED');
});

test('address classifier covers every special-purpose class and native global examples', () => {
  const refused = ['0.0.0.0', '0.1.2.3', '10.255.255.255', '100.64.0.0', '100.127.255.255', '127.255.255.255', '169.254.169.254', '172.16.0.0', '172.31.255.255',
    '192.0.0.9', '192.0.2.1', '192.31.196.1', '192.52.193.1', '192.88.99.2', '192.168.0.1', '192.175.48.1', '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:8.8.8.8', '::ffff:808:808', '::8.8.8.8', '64:ff9b::808:808', '64:ff9b:1::1', '100::1', '100:0:0:1::1', '2001::1', '2001:1::1', '2001:2::1', '2001:3::1', '2001:4:112::1', '2001:10::1', '2001:20::1', '2001:30::1', '2001:db8::1', '2002:808:808::1', '2001:4860::5efe:a00:1', '2001:4860::200:5efe:808:808', '2620:4f:8000::1', '3fff:fff::1', '5f00::1', 'fc00::1', 'fdff::1', 'fe80::1', 'fec0::1', 'ff02::1', '4000::1', 'fe80::1%en0', '127.1', '0x08080808', 'garbage'];
  for (const address of refused) assert.equal(isPublicKnowledgeWebAddress(address), false, 'special class denied');
  for (const address of ['1.1.1.1', '8.8.8.8', '93.184.215.14', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '198.17.255.255', '198.20.0.0', '2001:4860:4860::8888', '2606:4700:4700::1111', '3ffe::1']) assert.equal(isPublicKnowledgeWebAddress(address), true);
});

test('mixed DNS, invalid families, empty/mass answers and resolver failures never connect', async () => {
  for (const answers of [[], Array(65).fill(publicAnswer[0]), [...publicAnswer, { address: '127.0.0.1', family: 4 }], [{ address: '::ffff:808:808', family: 6 }], [{ address: '8.8.8.8', family: 6 }]]) {
    const f = fixture([], { resolve: async () => answers });
    await rejectsCode(f.reader.read(source), ['DNS_FAILED', 'ADDRESS_REJECTED']); assert.equal(f.state.connections, 0);
  }
  const f = fixture([], { resolve: async () => { throw new Error('private resolver detail'); } });
  await rejectsCode(f.reader.read(source), 'DNS_FAILED'); assert.equal(f.state.connections, 0);
});

test('real Node request consumes selected lookup only, preserves TLS policy, controlled headers and untrusted HTML bytes', async () => {
  const body = '<script>doNotExecute()</script><p>指令仅为数据</p>';
  const f = fixture([response(body, { 'Content-Type': 'text/html; charset="UTF-8"', ETag: '"v1"', 'Set-Cookie': 'private=hidden' })]);
  const result = await f.reader.read(source + '?synthetic=data', { headers: { Authorization: 'never-sent', Cookie: 'never-sent' }, connect: () => assert.fail('no caller transport') });
  assert.equal(result.state, 'fetched'); assert.equal(result.text, body); assert.equal(result.bytes.toString(), body);
  assert.equal(result.contentType, 'text/html'); assert.equal(result.checksum, createHash('sha256').update(body).digest('hex'));
  assert.equal(result.byteLength, Buffer.byteLength(body)); assert.equal(result.sourceUrl, source + '?synthetic=data');
  assert.equal('set-cookie' in result, false); assert.equal(f.state.resolutions, 1); assert.deepEqual(f.state.lookups, publicAnswer);
  const tls = f.state.options[0]; assert.equal(tls.servername, 'reader.fixture.net'); assert.equal(tls.host, 'reader.fixture.net'); assert.equal(tls.port, 443);
  assert.equal(tls.rejectUnauthorized, true); assert.equal(tls.checkServerIdentity, checkServerIdentity); assert.equal(tls.autoSelectFamily, false);
  const outbound = f.state.requests[0].toLowerCase(); assert.equal(outbound.includes('authorization:'), false); assert.equal(outbound.includes('cookie:'), false);
  assert.equal(outbound.includes('accept-encoding: identity'), true); assert.equal(outbound.includes('host: reader.fixture.net'), true);
  const allowed = new Set(['accept', 'user-agent', 'accept-encoding', 'host', 'connection']);
  for (const header of outbound.split('\r\n').slice(1).filter(Boolean)) assert.equal(allowed.has(header.split(':')[0]), true);
  assert.equal(f.state.destroyed, 1); assert.equal(getEventListeners(f.state.dnsSignals[0], 'abort').length, 0);
});

test('native IPv6 chosen address is pinned in single and all lookup modes without another resolution', async () => {
  const approved = { address: '2606:4700:4700::1111', family: 6 };
  const f = fixture([response()], { resolve: async () => [approved] });
  await f.reader.read(source);
  assert.deepEqual(f.state.lookups, [approved]);
  f.state.options[0].lookup('unrelated.hostname.net', { all: true }, (error, answers) => { assert.ifError(error); assert.deepEqual(answers, [approved]); });
  assert.equal(f.state.options[0].family, 6);
});

test('constructor dependencies/timeouts are snapshotted and cannot weaken production bounds', async () => {
  const f = fixture(); f.dependencies.resolve = async () => [{ address: '127.0.0.1', family: 4 }]; f.dependencies.connect = () => assert.fail('mutated dependency');
  assert.equal(Object.isFrozen(f.reader), true); assert.equal((await f.reader.read(source)).state, 'fetched');
  assert.throws(() => new KnowledgeWebReader({ timeouts: { overallMs: 16000 } }), error => error.code === 'HEADERS_INVALID');
});

test('redirects re-resolve every hop, cap at three and reject downgrade/credentials/private/rebinding', async () => {
  const f = fixture([response('', { Location: '/two' }, 302), response('', { Location: 'https://other.fixture.net/three' }, 307), response('', { Location: '/four' }, 308), response()]);
  assert.equal((await f.reader.read(source)).redirectCount, 3); assert.equal(f.state.resolutions, 4); assert.equal(f.state.destroyed, 4);
  const loop = fixture([response('', { Location: '/again' }, 301)]); await rejectsCode(loop.reader.read(source), 'REDIRECT_REJECTED'); assert.equal(loop.state.connections, 4);
  for (const location of ['http://reader.fixture.net', 'https://user:pass@reader.fixture.net', 'https://@reader.fixture.net', 'https://%72eader.fixture.net', 'https://127.0.0.1', 'https://reader.fixture.net/#', 'https://reader.fixture.net/%zz', 'https://reader.fixture.net:444']) {
    const bad = fixture([response('', { Location: location }, 302)]); await rejectsCode(bad.reader.read(source), 'REDIRECT_REJECTED'); assert.equal(bad.state.connections, 1);
  }
  let calls = 0;
  const rebound = fixture([response('', { Location: '/again' }, 302)], { resolve: async () => ++calls === 1 ? publicAnswer : [{ address: '10.0.0.1', family: 4 }] });
  await rejectsCode(rebound.reader.read(source), 'ADDRESS_REJECTED'); assert.equal(rebound.state.connections, 1);
});

test('status/header/type/charset/compression rejection yields only safe codes', async () => {
  for (const [wire, expected] of [
    [response('raw-response', {}, 500), 'STATUS_REJECTED'], [response('', {}, 204), 'STATUS_REJECTED'],
    [response('compressed', { 'Content-Encoding': 'gzip' }), 'ENCODING_REJECTED'], [response('compressed', { 'Content-Encoding': 'br' }), 'ENCODING_REJECTED'],
    [response('text', { 'Content-Type': 'application/json' }), 'CONTENT_TYPE_REJECTED'], [response('text', { 'Content-Type': 'text/plain; charset=iso-8859-1' }), 'CONTENT_TYPE_REJECTED'],
    [response('text', { 'Content-Type': 'text/html; charset=utf-8; charset=utf-8' }), 'CONTENT_TYPE_REJECTED'],
    [Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 4\r\nContent-Type: text/plain\r\nContent-Type: text/html\r\n\r\ntext'), 'HEADERS_INVALID'],
    [response('x', { ETag: '"' + 'x'.repeat(260) + '"' }), 'HEADERS_INVALID'],
    [response('x', { 'X-Extra': 'x'.repeat(17000) }), 'HEADERS_INVALID'],
    [response('x', Object.fromEntries(Array.from({ length: 101 }, (_, i) => ['X-' + i, 'x']))), 'HEADERS_INVALID'],
  ]) { const f = fixture([wire]); await rejectsCode(f.reader.read(source + '?secret=hidden'), expected); assert.equal(f.state.destroyed, 1); }
});

test('actual streamed bytes, advertised sizes, chunked overflow and malformed/empty UTF8 are bounded', async () => {
  const large = 'x'.repeat(1024 * 1024 + 1);
  const chunked = Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n${large.length.toString(16)}\r\n${large}\r\n0\r\n\r\n`);
  for (const wire of [response('x', { 'Content-Length': 1024 * 1024 + 1 }), chunked, Buffer.concat([Buffer.from('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n'), Buffer.from(large)])]) await rejectsCode(fixture([wire]).reader.read(source), 'BODY_TOO_LARGE');
  for (const body of ['', '   \n', '\0binary', Buffer.from([0xff]), Buffer.from([0xc0, 0xaf]), Buffer.from([0xe2, 0x82]), '\ufefftext', Buffer.from([0xff, 0xfe, 0x61, 0x00])]) await rejectsCode(fixture([response(body)]).reader.read(source), 'BODY_INVALID');
  const shortLie = fixture([response('long', { 'Content-Length': 1 })]); await rejectsCode(shortLie.reader.read(source), ['BODY_INVALID', 'TRANSPORT_FAILED']);
  const truncated = fixture([response('short', { 'Content-Length': 999 })]); await rejectsCode(truncated.reader.read(source), ['BODY_INVALID', 'TRANSPORT_FAILED']);
  const exact = await fixture([response('x'.repeat(1024 * 1024))]).reader.read(source); assert.equal(exact.byteLength, 1024 * 1024);
});

test('conditional updates use only exact same-resource trusted cache and never resurrect a body on 304', async () => {
  const old = await fixture([response('prior', { ETag: '"v1"', 'Last-Modified': 'Wed, 21 Oct 2015 07:28:00 GMT' })]).reader.read(source);
  const cache = { sourceUrl: old.sourceUrl, checksum: old.checksum, contentType: old.contentType, etag: old.etag, lastModified: old.lastModified };
  const f = fixture([response('', { ETag: '"v1"' }, 304)]); const result = await f.reader.read(source, { cache });
  assert.equal(result.state, 'not-modified'); assert.equal(result.checksum, old.checksum); assert.equal('text' in result, false); assert.equal('bytes' in result, false);
  assert.equal(f.state.requests[0].includes('If-None-Match: "v1"'), true); assert.equal(f.state.requests[0].includes('If-Modified-Since:'), true);
  await rejectsCode(fixture([response('', {}, 304)]).reader.read(source), 'CACHE_INVALID');
  await rejectsCode(fixture([response('', { ETag: '"different"' }, 304)]).reader.read(source, { cache }), 'CACHE_INVALID');
  const other = fixture([response('', {}, 304)]); await rejectsCode(other.reader.read(source + '?changed=1', { cache }), 'CACHE_INVALID'); assert.equal(other.state.requests[0].includes('If-None-Match:'), false);
  const redirect = fixture([response('', { Location: '/other' }, 302), response('', {}, 304)]); await rejectsCode(redirect.reader.read(source, { cache }), 'CACHE_INVALID'); assert.equal(redirect.state.requests[1].includes('If-None-Match:'), false);
  for (const invalid of [{ ...cache, checksum: 'invalid' }, { ...cache, etag: 'x\r\nAuthorization: value' }, { ...cache, etag: undefined, lastModified: undefined }, { ...cache, lastModified: 'not a date' }]) {
    const bad = fixture(); await rejectsCode(bad.reader.read(source, { cache: invalid }), 'CACHE_INVALID'); assert.equal(bad.state.connections, 0);
  }
  assert.equal((await fixture([response('updated', { ETag: '"v2"' })]).reader.read(source, { cache })).text, 'updated');
});

test('cancellation, DNS/header/read/overall deadlines and TLS errors clean up sockets and listeners', async () => {
  const pre = new AbortController(); pre.abort(new Error('secret-reason')); const before = fixture(); await rejectsCode(before.reader.read(source, { signal: pre.signal }), 'CANCELLED'); assert.equal(before.state.connections, 0);
  const dns = fixture([], { resolve: () => new Promise(() => {}), timeouts: { dnsMs: 15 } }); await rejectsCode(dns.reader.read(source), 'DNS_TIMEOUT'); assert.equal(dns.state.connections, 0);
  const header = fixture([() => {}], { timeouts: { headersMs: 15 } }); await rejectsCode(header.reader.read(source), 'HEADERS_TIMEOUT'); assert.equal(header.state.destroyed, 1);
  const read = fixture([socket => socket.push('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 10\r\n\r\nx')], { timeouts: { readMs: 15 } }); await rejectsCode(read.reader.read(source), 'READ_TIMEOUT'); assert.equal(read.state.destroyed, 1);
  const overall = fixture([() => {}], { timeouts: { overallMs: 15 } }); await rejectsCode(overall.reader.read(source), 'DEADLINE_EXCEEDED'); assert.equal(overall.state.destroyed, 1);
  const controller = new AbortController(); const cancel = fixture([() => {}]); const pending = cancel.reader.read(source, { signal: controller.signal }); await delay(5); controller.abort('private-reason'); await rejectsCode(pending, 'CANCELLED'); assert.equal(cancel.state.destroyed, 1); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  for (const code of ['CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT']) {
    const tls = fixture([], { connect: () => { throw Object.assign(new Error('secret certificate'), { code }); } }); await rejectsCode(tls.reader.read(source), 'TLS_FAILED');
  }
});

test('overall deadline stops a continuously dripping body and DNS cancellation leaves no listener', async () => {
  const drip = fixture([socket => {
    socket.push('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n');
    const timer = setInterval(() => { if (!socket.destroyed) socket.push('x'); }, 5);
    socket.once('close', () => clearInterval(timer));
  }], { timeouts: { overallMs: 30, readMs: 20 } });
  await rejectsCode(drip.reader.read(source), 'DEADLINE_EXCEEDED'); assert.equal(drip.state.destroyed, 1);
  let dnsSignal;
  const controller = new AbortController();
  const dns = fixture([], { resolve: async (_host, signal) => { dnsSignal = signal; return new Promise(() => {}); } });
  const pending = dns.reader.read(source, { signal: controller.signal }); await delay(5); controller.abort('private');
  await rejectsCode(pending, 'CANCELLED'); assert.equal(dns.state.connections, 0); assert.equal(getEventListeners(dnsSignal, 'abort').length, 0);
});
