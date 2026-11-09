import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
assert.equal(git(['branch', '--show-current']), 'dev');
assert.equal(resolve(git(['rev-parse', '--git-dir'])), resolve(git(['rev-parse', '--git-common-dir'])));
assert.equal(git(['remote', 'get-url', 'origin']), 'git@github.com:weiyang86/aij-foundation.git');
const manifestPath = 'docs/planning/auto-ai-program-20261105/W22/SOURCE_BOOTSTRAP.json';
assert.equal(sha(readFileSync(manifestPath)), '1396522f0782f4e9fa5478786ea67d78cde328ec745de2725a85decff978eea3');
const manifest = read(manifestPath); assert.equal(manifest.files.length, 1026);
const blobs = execFileSync('git', ['cat-file', '--batch'], { input: manifest.files.map(file => file.oid + '\n').join(''), maxBuffer: 64 * 1024 * 1024 });
let offset = 0;
for (const file of manifest.files) {
  const end = blobs.indexOf(10, offset), [oid, kind, count] = blobs.subarray(offset, end).toString().split(' ');
  assert.equal(oid, file.oid); assert.equal(kind, 'blob'); assert.equal(Number(count), file.bytes);
  assert.equal(sha(blobs.subarray(end + 1, end + 1 + Number(count))), file.sha256); offset = end + 2 + Number(count);
}
const tasks = JSON.parse(execFileSync('orca', ['orchestration', 'task-list', '--run', 'run_72ed314cead8', '--json'], { maxBuffer: 8 * 1024 * 1024 })).result.tasks;
for (const id of ['task_180f373a05bc', 'task_f03f6130ad1e', 'task_3ec5292e3b7a', 'task_19d52bafe9f1']) assert.equal(tasks.find(task => task.id === id)?.status, 'completed', id);
const sources = read('docs/planning/auto-ai-program-20261105/W22/AF-221-ROOT_SOURCES.json');
assert.equal(sources.originalStop, 'msg_1736aa85d1a8'); assert.equal(sources.supplementStop, 'msg_fb4ec54af51b'); assert.equal(sources.workerTotalHours, 0.55);
for (const file of sources.files) assert.equal(sha(readFileSync(file.path)), file.sha256, file.path);
for (const candidate of sources.candidateFiles) assert.equal(sha(execFileSync('git', ['show', candidate.commit + ':' + candidate.path])), candidate.sha256);
for (const admission of sources.sharedAdmissions) {
  assert.ok(admission.count > 0 && admission.count <= 3);
  const text = readFileSync(admission.path, 'utf8'); assert.equal(text.split(admission.literal).length - 1, admission.count, admission.path);
  assert.equal(text.includes('AF-222'), false, 'No generic future acceptance admission');
}
console.log(JSON.stringify({ task: 'AF-221', immutableBlobs: 1026, actualCompletedDependencies: 4, candidateAndSupplementStopped: true,
  guardPolicy: 'exact AF221 only; inherited AF191 is not a code dependency', targetAcceptance: 'REQUIRES_REAL_HTTP_PG_NATIVE' }));
