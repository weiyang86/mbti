// Root-only original Next/API/Job browser acceptance. eval is read-only.
import assert from 'node:assert/strict';
import { createServer, request as relayRequest } from 'node:http';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
const requireWeb = createRequire(join(root, 'apps/web/package.json'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
export async function preparePersonalScriptsHost(artifact) {
  let base, handler, web, held, closing, lost;
  const traffic = [];
  const server = createServer((incoming, outgoing) => {
    if (incoming.url?.startsWith('/api/')) {
      if (!base) { outgoing.writeHead(503); outgoing.end(); return; }
      const target = new URL(base), path = incoming.url.split('?', 1)[0];
      const relay = relayRequest({ hostname: '127.0.0.1', port: target.port, method: incoming.method, path: incoming.url, headers: { ...incoming.headers, host: target.host } }, response => {
        const lose = lost && incoming.method === lost.method && path === lost.path && response.statusCode >= 200 && response.statusCode < 300;
        traffic.push({ method: incoming.method, path, status: response.statusCode, lostAfterCommit: Boolean(lose) });
        if (lose) {
          lost = undefined; const chunks = []; response.on('data', b => chunks.push(b)); response.once('end', () => {
            const body = Buffer.concat(chunks); assert.ok(body.length > 1);
            // Deliver real upstream headers and one original body byte, then
            // break the committed reply. Pre-header resets can be transparently
            // replayed by WebKit; the earlier observed CAS409 case is retained.
            outgoing.writeHead(response.statusCode, response.headers); outgoing.flushHeaders();
            outgoing.write(body.subarray(0, 1), () => { const timer = setTimeout(() => outgoing.destroy(), 50); timer.unref(); });
          }); return;
        }
        const barrier = held && path === held.path ? held : null;
        if (barrier) {
          held = undefined; const chunks = [];
          response.on('data', b => chunks.push(b)); response.once('end', async () => {
            barrier.entered.resolve(); await barrier.release.promise;
            if (!outgoing.destroyed) { outgoing.writeHead(response.statusCode ?? 502, response.headers); outgoing.end(Buffer.concat(chunks)); }
          }); return;
        }
        outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing);
      });
      relay.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); }); incoming.pipe(relay); return;
    }
    if (handler) { void handler(incoming, outgoing); return; }
    outgoing.writeHead(503); outgoing.end('Owned script acceptance preparing');
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`, traffic,
    attach(url) { base = url; },
    hold(path) { assert.equal(held, undefined); held = { path, entered: deferred(), release: deferred() }; return held; },
    lose(method, path) {
      assert.equal(method, 'POST'); assert.ok(['/api/client/script-executions/versions', '/api/client/script-executions/runs'].includes(path));
      assert.equal(lost, undefined); lost = { method, path };
    },
    async startWeb() {
      const keys = ['NODE_ENV', 'AIJ_NEXT_DIST_DIR', 'AIJ_TEST_API_URL'];
      const before = Object.fromEntries(keys.map(k => [k, process.env[k]]));
      Object.assign(process.env, { NODE_ENV: 'production', AIJ_NEXT_DIST_DIR: '.next-af213', AIJ_TEST_API_URL: '/api' });
      try { web = requireWeb('next')({ dev: false, dir: join(root, 'apps/web'), hostname: '127.0.0.1' }); await web.prepare(); handler = web.getRequestHandler(); }
      finally { for (const k of keys) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } }
    },
    close() { return closing ??= (async () => {
      held?.release.resolve(); server.closeAllConnections(); await new Promise(r => server.close(r)); await web?.close();
      const sockets = await new Promise((yes, no) => server.getConnections((e, n) => e ? no(e) : yes(n)));
      assert.equal(server.listening, false); assert.equal(sockets, 0);
      await writeFile(join(artifact, 'native-host.json'), JSON.stringify({ traffic, ownedSockets: sockets, closed: true }, null, 2) + '\n');
    })(); }
  };
}
