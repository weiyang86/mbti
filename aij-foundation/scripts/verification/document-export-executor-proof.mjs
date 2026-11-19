import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
const folder = '.artifacts/auto-ai-program-20261105/W16/';
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const output = read(folder + 'AF-199-linux-latest.json').output;
const e = read(path.join(output, 'evidence.json'));
assert.equal(e.status, 'PASS'); assert.equal(e.outcome.platform, 'linux'); assert.equal(e.outcome.realTests, 1); assert.equal(e.outcome.skipped, 0);
assert.equal(e.qaContainerRemoved, true); assert.equal(e.runtimeBundleRemoved, true); assert.equal(e.ownedContainersUnchanged, true);
const cleanup = read(path.join(output, 'cleanup.json')); assert.equal(cleanup.primaryFailure, null); assert.deepEqual(cleanup.cleanupErrors, []); assert.deepEqual(cleanup.remaining, cleanup.baseline);
const packet = read(path.join(output, 'packet.json'));
for (const f of packet.sources) assert.equal(createHash('sha256').update(readFileSync(f.path)).digest('hex'), f.sha256);
const stdout = readFileSync(path.join(output, 'live.stdout.log'), 'utf8');
for (const pattern of [/# tests 1\b/, /# pass 1\b/, /# fail 0\b/, /# skipped 0\b/]) assert.match(stdout, pattern);
const diagnostics = stdout.split('\n').filter(l => l.startsWith('# {')).map(l => JSON.parse(l.slice(2)));
const running = diagnostics.filter(d => d.runningEvidence);
assert.deepEqual(running.map(d => d.case).sort(), ['ABORTED', 'TIMEOUT']);
for (const d of running) {
  assert.equal(d.runningEvidence.state, 'running'); assert.equal(d.runningEvidence.running, true);
  assert.match(d.runningEvidence.id, /^[a-f0-9]{64}$/); assert.match(d.runningEvidence.name, /^\/aij-document-export-[a-f0-9]{32}$/);
  assert.match(d.runningEvidence.nonce, /^[a-f0-9]{48}$/); assert.equal(d.runningEvidence.image, d.runningEvidence.configuredImage);
}
const images = diagnostics.filter(d => d.newProbeImage).map(d => d.newProbeImage);
const removed = diagnostics.filter(d => d.probeImageCleanup).map(d => d.probeImageCleanup);
assert.equal(images.length, 5); assert.equal(removed.length, 5);
assert.deepEqual(images.map(d => d.imageId).sort(), removed.map(d => d.imageId).sort());
for (const i of images) { assert.equal(i.absentFromPrebuildInventory, true); assert.match(i.imageId, /^sha256:[a-f0-9]{64}$/); }
for (const i of removed) assert.equal(i.confirmed, true);
const docker = (...args) => execFileSync('/usr/local/bin/docker', args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
for (const d of running) {
  for (const [filter, value] of [['id', d.runningEvidence.id], ['name', '^' + d.runningEvidence.name + '$']]) assert.equal(docker('container', 'ls', '-aq', '--no-trunc', '--filter', filter + '=' + value).trim(), '');
}
const knownImages = new Set(docker('image', 'ls', '-aq', '--no-trunc').trim().split('\n'));
for (const i of images) assert.ok(!knownImages.has(i.imageId));
const [production] = JSON.parse(docker('image', 'inspect', e.outcome.imageId));
assert.equal(production.Id, e.outcome.imageId); assert.equal(production.Config.User, '65534:65534');
assert.deepEqual(production.Config.Entrypoint, ['/usr/local/bin/node', '/aij/document-renderer-cli.js']);
assert.equal(e.externalAcceptance, 'DEFERRED_NOT_PASSED'); assert.equal(e.full40, 'NOT_RUN_TARGET_ACCEPTANCE');
console.log(JSON.stringify({ status: 'PASS', task: 'AF-199', actualLinuxTests: 1, productionFormats: 2,
  controlledResourceCases: 6, observedRunningCases: 2, newProbeImagesRemoved: 5,
  noRemainingNewContainers: true, retainedLocalFixtureImage: production.Id, output, scope: 'internal default-off executor; no API/attachments/SDK/UI/target or owner acceptance' }));
