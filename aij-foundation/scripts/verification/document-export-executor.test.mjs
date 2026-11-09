import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import test, { after } from 'node:test';
import { createHash } from 'node:crypto';
import { assertBundleTree, buildRuntimeImage, createRuntimeBuildContext } from '../document-export/build-runtime-image.mjs';
const require = createRequire(import.meta.url);
const compiled = mkdtempSync(join(tmpdir(), 'aij-af199-unit-'));
after(() => rmSync(compiled, { recursive: true, force: true }));
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), 'apps/api/src/documents/document-export-executor.ts', '--module', 'commonjs', '--target', 'ES2022', '--moduleResolution', 'node', '--types', 'node', '--strict', '--skipLibCheck', '--outDir', compiled]);
const { DocumentExportExecutor } = require(join(compiled, 'document-export-executor.js'));
const image = 'sha256:' + 'a'.repeat(64), id = 'b'.repeat(64);
const input = { format: 'pdf', name: '测试', body: 'synthetic\n\t<&>' };
function fixture(mode = 'ok') {
  const dir = mkdtempSync(join(compiled, 'collaborator-')), cli = join(dir, 'docker-collaborator'), state = join(dir, 'state'), log = join(dir, 'calls');
  const bytes = mode === 'max-file' ? Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(5 * 1024 * 1024 - 5, 120)]) : mode === 'docx' ? Buffer.from([80,75,3,4,1,2,3]) : Buffer.from('%PDF-1.7\nsynthetic protocol only');
  const envelope = { schemaVersion: 1, format: 'pdf', mimeType: 'application/pdf', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), pageCount: 1, rendererVersion: 'aij-plain-document-v1', base64: bytes.toString('base64') };
  if (mode === 'docx') { envelope.format='docx'; envelope.mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document'; envelope.pageCount=null; }
  writeFileSync(join(dir,'envelope'),JSON.stringify(envelope));
  writeFileSync(cli, `#!${process.execPath}
const fs=require('node:fs'), a=process.argv.slice(2), mode=${JSON.stringify(mode)}, state=${JSON.stringify(state)}, log=${JSON.stringify(log)}, id=${JSON.stringify(id)}, image=${JSON.stringify(image)}, p=JSON.parse(fs.readFileSync(${JSON.stringify(join(dir,'envelope'))},'utf8'));
fs.appendFileSync(log,JSON.stringify({args:a,env:process.env})+'\\n');
let s=fs.existsSync(state)?JSON.parse(fs.readFileSync(state)):null;
const save=()=>fs.writeFileSync(state,JSON.stringify(s));
const absent=()=>{process.stderr.write('Error: No such container: '+a.at(-1)+'\\n');process.exitCode=1};
(async()=>{
if(a[0]==='image'){ if(mode==='image-missing'){process.exitCode=1;return}console.log(JSON.stringify(image));return; }
if(a[1]==='create') { s={id,name:'/'+a[a.indexOf('--name')+1],nonce:a[a.indexOf('--label')+1].split('=')[1],image,imageId:image,state:'created',exitCode:0,oomKilled:false};save(); if(mode==='ctl-flood'){process.stdout.write('x'.repeat(20000));return} console.log(id);return; }
if(a[1]==='inspect'){if(!s){if(mode==='cleanup-unknown'){process.exitCode=1;return}return absent()} if(mode==='foreign')s.nonce='foreign';console.log(JSON.stringify(s));return;}
if(a[1]==='start') {s.state='running';save(); let data='';for await(const c of process.stdin)data+=c; fs.writeFileSync(${JSON.stringify(join(dir,'input'))},data);
if(mode==='slow')await new Promise(r=>setTimeout(r,10000));
if(mode==='flood'){process.stdout.write('x'.repeat(9*1024*1024));await new Promise(r=>setTimeout(r,10000));return;}
s.state='exited';s.exitCode=mode==='oom'?137:mode==='nonzero'?2:0;s.oomKilled=mode==='oom';save();process.exitCode=s.exitCode;
if(mode==='bad-hash')p.sha256='c'.repeat(64);if(mode==='bad-base64')p.base64+='!';if(mode==='bad-size')p.size++;if(mode==='bad-mime')p.mimeType='text/html';if(mode==='bad-pages')p.pageCount=101;if(mode==='bad-version')p.rendererVersion='unknown';if(mode==='bad-format')p.format='docx';
if(mode==='utf8'){process.stdout.write(Buffer.from([255]));return;}
if(mode==='duplicate'){process.stdout.write(JSON.stringify(p).replace('{','{"size":1,')+'\\n');return;}
if(mode==='stderr')process.stderr.write('PRIVATE_DAEMON_SECRET');
console.log(JSON.stringify(p));if(mode==='extra-line')console.log('{}');return; }
if(a[1]==='kill'){s.state='exited';s.exitCode=137;save();return;}
if(a[1]==='rm'){if(mode!=='remove-lies')fs.unlinkSync(state);console.log(id);return;}
throw Error('unexpected');})();`, { mode: 0o700 });
  delete require.cache[require.resolve(join(compiled, 'document-export-executor.js'))];
  const Executor = require(join(compiled, 'document-export-executor.js')).DocumentExportExecutor;
  return { Executor, runner: new Executor({ enabled: true, dockerCliPath: cli, approvedImage: image }), dir, calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [], cli };
}
async function withFixture(mode, fn) { const f = fixture(mode); try { await fn(f); } finally { rmSync(f.dir, { recursive: true, force: true }); } }
test('defaults, immutable admin configuration and input refusals', async () => {
  assert.equal((await new DocumentExportExecutor().run({ input })).outcome, 'DISABLED');
  for (const opts of [{ dockerCliPath: 'docker', approvedImage: image }, { dockerCliPath: '/bin/true', approvedImage: 'node:latest' }]) assert.equal((await new DocumentExportExecutor({ enabled: true, ...opts }).run({ input })).outcome, 'INVALID_CONFIGURATION');
  await withFixture('ok', async f => {
    for (const bad of [{ ...input, format: 'html' }, { ...input, body: 'x'.repeat(65537) }, { ...input, name: ' ' }, { ...input, name: ' test' }, { ...input, body: '\u0080' }, { ...input, body: '\n'.repeat(2048) }, { ...input, font: '/host' }]) assert.equal((await f.runner.run({ input: bad })).outcome, 'INVALID_INPUT');
    assert.equal(f.calls().length, 0);
  });
});
test('collaborator success validates envelope and hardened argv, never Docker evidence', async () => withFixture('ok', async f => {
  const r = await f.runner.run({ input }); assert.equal(r.outcome, 'SUCCESS'); assert.equal(r.cleanupConfirmed, true); assert.equal(r.artifact.size, r.artifact.bytes.length);
  assert.deepEqual(JSON.parse(readFileSync(join(f.dir, 'input'))), { input });
  const calls = f.calls(), create = calls.find(c => c.args[1] === 'create').args;
  for (const [k,v] of [['--network','none'],['--memory','512m'],['--memory-swap','512m'],['--pids-limit','64'],['--cpus','1'],['--user','65534:65534'],['--cap-drop','ALL'],['--security-opt','no-new-privileges'],['--pull','never']]) assert.equal(create[create.indexOf(k)+1],v);
  assert(create.includes('--read-only')); assert(!create.some(a=>['--mount','--volume','-v','--env','-e','--publish'].includes(a))); assert.equal(create.at(-1),'/aij/document-renderer-cli.js');
  assert.equal(calls[0].env.DOCKER_HOST,undefined); assert.equal(calls[0].env.HOME,'/nonexistent');
  assert(calls.filter(c=>c.args[1]==='inspect').length>=5);
}));
for (const mode of ['bad-hash','bad-base64','bad-size','bad-mime','bad-pages','bad-version','bad-format','utf8','duplicate','stderr','extra-line']) test('reject protocol '+mode, async()=>withFixture(mode,async f=>{
  const r=await f.runner.run({input});assert.equal(r.outcome,'INVALID_PROTOCOL');assert.equal(r.artifact,undefined);assert.equal(r.cleanupConfirmed,true);
}));
for (const [mode, expected] of [['image-missing','IMAGE_UNAVAILABLE'],['oom','OOM_KILLED'],['nonzero','RENDERER_REJECTED'],['flood','OUTPUT_LIMIT'],['ctl-flood','EXECUTION_FAILED'],['foreign','CLEANUP_UNCONFIRMED'],['remove-lies','CLEANUP_UNCONFIRMED'],['cleanup-unknown','CLEANUP_UNCONFIRMED']]) test('lifecycle '+mode,async()=>withFixture(mode,async f=>{
  const r=await f.runner.run({input});assert.equal(r.outcome,expected);assert.equal(r.artifact,undefined);if(mode==='foreign')assert(!f.calls().some(c=>['kill','rm'].includes(c.args[1])));if(expected==='CLEANUP_UNCONFIRMED'){const count=f.calls().length;assert.equal((await f.runner.run({input})).outcome,'CLEANUP_UNCONFIRMED');assert.equal(f.calls().length,count);}
}));
test('deadline, cancellation and process-wide admission; no queue',async()=>withFixture('slow',async f=>{
  const pending=f.runner.run({input,timeoutMs:500});
  assert.equal((await new f.Executor({enabled:true,dockerCliPath:f.cli,approvedImage:image}).run({input})).outcome,'BUSY');
  const result=await pending;assert.equal(result.outcome,'TIMEOUT');assert.equal(result.cleanupConfirmed,true);
  const controller=new AbortController();const p=f.runner.run({input,signal:controller.signal});setTimeout(()=>controller.abort(),250);assert.equal((await p).outcome,'ABORTED');
  controller.abort();assert.equal((await f.runner.run({input,signal:controller.signal})).outcome,'ABORTED');
}));
test('build helper requires explicit root integration',async()=>{await assert.rejects(buildRuntimeImage(),/ROOT_BUILD_REQUIRED/);await assert.rejects(assertBundleTree(compiled),/CLI_MISSING/);});

test('bundle tree rejects symbolic links and secrets',async()=>{const d=mkdtempSync(join(compiled,'bundle-'));writeFileSync(join(d,'document-renderer-cli.js'),'');symlinkSync('/etc/passwd',join(d,'escape'));await assert.rejects(assertBundleTree(d),/UNSAFE_BUNDLE/);rmSync(join(d,'escape'));mkdirSync(join(d,'credentials'));await assert.rejects(assertBundleTree(d),/UNSAFE_BUNDLE/);});

test('maximum allowed file and docx envelope',async()=>{await withFixture('max-file',async f=>{const r=await f.runner.run({input});assert.equal(r.outcome,'SUCCESS');assert.equal(r.artifact.size,5*1024*1024);});await withFixture('docx',async f=>{const r=await f.runner.run({input:{...input,format:'docx'}});assert.equal(r.outcome,'SUCCESS');assert.equal(r.artifact.pageCount,null);});});


// Actual filesystem path regressions only: neither AF197 builder nor Docker is replaced or executed.
function assertCanonicalBuildPaths(paths) {
  for (const directory of [paths.repositoryRoot, paths.context, dirname(paths.destination)]) {
    assert.equal(resolve(directory), directory, 'AF197 lexical canonical precondition');
    assert.equal(realpathSync(directory), directory, 'AF197 physical canonical precondition');
  }
  assert.equal(paths.destination,join(paths.context,'runtime'));
  assert.equal(existsSync(paths.destination),false,'bundle destination must not already exist');
}
test('operations default repository root is canonical without trailing slash',async()=>{
  const paths=await createRuntimeBuildContext();
  try {
    assertCanonicalBuildPaths(paths);
    assert.equal(paths.repositoryRoot,realpathSync(resolve(fileURLToPath(new URL('../../',import.meta.url)))));
  } finally { rmSync(paths.context,{recursive:true,force:true}); }
});
test('operations temp symlink parent resolves before fresh contexts are minted',async()=>{
  const parent=mkdtempSync(join(compiled,'path-parent-')), alias=join(parent,'alias'), target=join(parent,'target');
  mkdirSync(target);symlinkSync(target,alias,'dir');
  const sentinel=join(target,'runtime');mkdirSync(sentinel);writeFileSync(join(sentinel,'keep'),'untouched');
  const contexts=[];
  try {
    for(let i=0;i<2;i++) {
      const paths=await createRuntimeBuildContext({temporaryParent:alias});contexts.push(paths.context);
      assertCanonicalBuildPaths(paths);assert.equal(dirname(paths.context),realpathSync(target));
    }
    assert.notEqual(contexts[0],contexts[1]);assert.equal(readFileSync(join(sentinel,'keep'),'utf8'),'untouched');
  } finally { for(const context of contexts)rmSync(context,{recursive:true,force:true});rmSync(parent,{recursive:true,force:true}); }
});
