// Root-owned real Next/API relay. Faults alter transport only, never API results.
import assert from 'node:assert/strict';
import { createServer, request as relayRequest } from 'node:http';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = '/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';
const requireWeb = createRequire(join(root, 'apps/web/package.json'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
export async function prepareW21UiHost(task, artifact) {
  assert.ok(['AF-218', 'AF-217', 'AF-221', 'AF-225'].includes(task));
  let base, handler, web, held, lost, closing;
  const traffic = [], server = createServer((incoming, outgoing) => {
    if (!incoming.url?.startsWith('/api/')) {
      if (handler) { void handler(incoming, outgoing); return; }
      outgoing.writeHead(503); outgoing.end(); return;
    }
    if (!base) { outgoing.writeHead(503); outgoing.end(); return; }
    const target = new URL(base), path = incoming.url.split('?', 1)[0];
    const relay = relayRequest({ hostname: '127.0.0.1', port: target.port, method: incoming.method, path: incoming.url, headers: { ...incoming.headers, host: target.host } }, response => {
      const loss = lost && incoming.method === lost.method && path === lost.path && response.statusCode >= 200 && response.statusCode < 300 ? lost : null;
      traffic.push({ method: incoming.method, path, status: response.statusCode, lostAfterCommit: Boolean(loss) });
      const barrier = held && path === held.path ? held : null;
      if (loss || barrier) {
        if (loss) lost = undefined;
        if (barrier) held = undefined;
        const chunks = [];
        response.on('data', b => chunks.push(b)); response.once('end', async () => {
          const bytes = Buffer.concat(chunks);
          loss?.committed.resolve();
          if (barrier) { barrier.entered.resolve(); await barrier.release.promise; }
          if (outgoing.destroyed) return;
          outgoing.writeHead(response.statusCode, response.headers);
          if (loss) { assert.ok(bytes.length > 1); outgoing.flushHeaders(); outgoing.write(bytes.subarray(0, 1), () => { const timer = setTimeout(() => outgoing.destroy(), 50); timer.unref(); }); }
          else outgoing.end(bytes);
        }); return;
      }
      outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing);
    });
    relay.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); }); incoming.pipe(relay);
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  return {
    origin: `http://127.0.0.1:${server.address().port}`, traffic,
    attach(url) { base = url; },
    hold(path) { assert.equal(held, undefined); held = { path, entered: deferred(), release: deferred() }; return held; },
    lose(method, path) {
      if (task === 'AF-218') { assert.equal(method, 'PATCH'); assert.match(path, /^\/api\/client\/ai\/personal-agents\/[A-Za-z0-9_-]+$/); }
      else if (['AF-221', 'AF-225'].includes(task)) { assert.equal(method, 'PATCH'); assert.match(path, /^\/api\/client\/documents\/[A-Za-z0-9_-]+$/); }
      else { assert.equal(method, 'POST'); assert.match(path, /^\/api\/client\/workflow-executions\/(?:runs|publications(?:\/[A-Za-z0-9_-]+\/unpublish)?)$/); }
      assert.equal(lost, undefined); lost = { method, path, committed: deferred() }; return lost;
    },
    async startWeb() {
      const keys = ['NODE_ENV', 'AIJ_NEXT_DIST_DIR', 'AIJ_TEST_API_URL'], before = Object.fromEntries(keys.map(k => [k, process.env[k]]));
      Object.assign(process.env, { NODE_ENV: 'production', AIJ_NEXT_DIST_DIR: '.next-' + task.toLowerCase().replace('-', ''), AIJ_TEST_API_URL: '/api' });
      try { web = requireWeb('next')({ dev: false, dir: join(root, 'apps/web'), hostname: '127.0.0.1' }); await web.prepare(); handler = web.getRequestHandler(); }
      finally { for (const k of keys) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } }
    },
    close() { return closing ??= (async () => {
      held?.release.resolve(); server.closeAllConnections(); await new Promise(r => server.close(r)); await web?.close();
      const sockets = await new Promise((yes, no) => server.getConnections((e, n) => e ? no(e) : yes(n))); assert.equal(sockets, 0); assert.equal(server.listening, false);
      await writeFile(join(artifact, 'host-closed.json'), JSON.stringify({ closed: true, sockets, traffic }, null, 2) + '\n');
    })(); }
  };
}
