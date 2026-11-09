// ROOT ONLY: invoke after I197 is CODE_VERIFIED, on the isolated Linux Docker host.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
const enabled = process.env.AF199_ROOT_LIVE === '1';
const docker = process.env.AF199_DOCKER_CLI ?? '/usr/bin/docker';
const image = process.env.AF199_IMAGE_ID;
const require = createRequire(import.meta.url);
const cleanEnv = { PATH: '/usr/bin:/bin', HOME: '/nonexistent', DOCKER_CONFIG: '/nonexistent/aij-document-export-config' };
function ctl(args) { return execFileSync(docker, args, { env: cleanEnv, cwd: '/', encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 }); }
test('root Linux real renderer, resource enforcement, OOM, timeout, abort, protocol and cleanup', { skip: !enabled, timeout: 180000 }, async t => {
  assert.equal(process.platform, 'linux', 'real Linux required');
  assert(isAbsolute(docker));assert.match(image ?? '', /^sha256:[a-f0-9]{64}$/);
  const dir=mkdtempSync(join(tmpdir(),'aij-af199-live-')), images=[];
  const runNonce=randomBytes(24).toString('hex');
  let primaryError;
  const cleanupErrors=[];
  const imageIds=()=>new Set(ctl(['image','ls','--all','--quiet','--no-trunc']).trim().split('\n').filter(Boolean));
  const imageInfo=id=>JSON.parse(ctl(['image','inspect','--format','{{json .}}',id]));
  function verifyProbeImage(record) {
    assert.match(record.id ?? '',/^sha256:[a-f0-9]{64}$/);
    assert(!record.before.has(record.id),'refuse removal of any pre-existing image ID');
    const info=imageInfo(record.id);
    assert.equal(info.Id,record.id);
    assert.equal(info.Config.Labels['io.aij.af199.live.run'],runNonce);
    assert.equal(info.Config.Labels['io.aij.af199.live.probe'],record.nonce);
  }
  const owned = () => ctl(['container','ls','--all','--quiet','--no-trunc','--filter','label=io.aij.document-export.nonce']).trim().split('\n').filter(Boolean).sort();
  let baseline;
  try {
    baseline=owned();
    execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'apps/api/src/documents/document-export-executor.ts','--module','commonjs','--target','ES2022','--moduleResolution','node','--types','node','--strict','--skipLibCheck','--outDir',join(dir,'compiled')]);
    const { DocumentExportExecutor }=require(join(dir,'compiled/document-export-executor.js'));
    const runner=id=>new DocumentExportExecutor({enabled:true,dockerCliPath:docker,approvedImage:id});
    for(const format of ['pdf','docx']) {
      const r=await runner(image).run({input:{format,name:'Linux 文档导出验证',body:'真实受控渲染\n\n<&>\t第二段\n'+ '长行中文'.repeat(200)}});
      assert.equal(r.outcome,'SUCCESS');assert.equal(r.cleanupConfirmed,true);
      const file=join(dir,'actual.'+format);writeFileSync(file,r.artifact.bytes);
      if(format==='pdf') {
        const info=execFileSync('/usr/bin/pdfinfo',[file],{encoding:'utf8',timeout:10000});
        assert.equal(Number(info.match(/^Pages:\s+(\d+)/m)?.[1]),r.artifact.pageCount);
        const fonts=execFileSync('/usr/bin/pdffonts',[file],{encoding:'utf8',timeout:10000});assert.match(fonts,/yes\s+yes/);
        const text=execFileSync('/usr/bin/pdftotext',[file,'-'],{encoding:'utf8',timeout:10000});assert.match(text,/真实受控渲染/);
      } else {
        execFileSync('/usr/bin/python3',['-c',`import sys,zipfile,xml.etree.ElementTree as E
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 for n in ('[Content_Types].xml','word/document.xml','word/styles.xml'): E.fromstring(z.read(n))
 assert '真实受控渲染' in z.read('word/document.xml').decode()
`,file],{timeout:10000});
      }
      assert.deepEqual(owned(),baseline);
    }
    // Controlled root-only probe images test Linux enforcement; they are not production rendering evidence.
    async function probe(source) {
      const context=join(dir,'probe-'+images.length);mkdirSync(join(context,'runtime'),{recursive:true});
      cpSync('ops/document-export/Dockerfile',join(context,'Dockerfile'));
      writeFileSync(join(context,'runtime/document-renderer-cli.js'),source);
      // Unique labels change the final image config digest even on a cached filesystem build.
      // Record before building so a build failure still reaches independent cleanup handling.
      const record={context,nonce:randomBytes(24).toString('hex'),before:imageIds(),id:undefined};
      images.push(record);
      t.diagnostic(JSON.stringify({probeBuild:{runNonce,probeNonce:record.nonce}}));
      let buildError;
      const buildErrors=[];
      try {
        ctl(['build','--pull=false','--network=none','--label','io.aij.af199.live.run='+runNonce,
          '--label','io.aij.af199.live.probe='+record.nonce,'--iidfile',join(context,'iid'),context]);
      } catch(error) { buildError=error; }
      finally {
        try { if(existsSync(join(context,'iid')))record.id=readFileSync(join(context,'iid'),'utf8').trim(); }
        catch(error) { buildErrors.push(error); }
      }
      if(buildError || buildErrors.length)throw new AggregateError([...(buildError?[buildError]:[]),...buildErrors],'PROBE_BUILD_FAILED');
      verifyProbeImage(record);
      t.diagnostic(JSON.stringify({newProbeImage:{runNonce,probeNonce:record.nonce,imageId:record.id,absentFromPrebuildInventory:true}}));
      return {executor:runner(record.id),imageId:record.id};
    }
    const asyncCtl=args=>new Promise((resolve,reject)=>execFile(docker,args,{env:cleanEnv,cwd:'/',encoding:'utf8',timeout:2000,maxBuffer:1024*1024},(error,stdout)=>error?reject(Error('LIVE_OBSERVATION_UNCONFIRMED')):resolve(stdout)));
    const containerFormat='{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"configuredImage":{{json .Config.Image}},"nonce":{{json (index .Config.Labels "io.aij.document-export.nonce")}},"running":{{json .State.Running}},"state":{{json .State.Status}},"startedAt":{{json .State.StartedAt}}}';
    async function observeRunning(probe,pending,before) {
      let settled=false;
      pending.then(()=>{settled=true;},()=>{settled=true;});
      const until=performance.now()+10000;
      while(performance.now()<until) {
        assert(!settled,'early adapter return cannot prove running-container cancellation/timeout');
        const ids=(await asyncCtl(['container','ls','--all','--quiet','--no-trunc','--filter','ancestor='+probe.imageId,
          '--filter','label=io.aij.document-export.nonce'])).trim().split('\n').filter(Boolean);
        const fresh=ids.filter(id=>!before.includes(id));
        assert(fresh.length<=1,'ambiguous container ownership');
        if(fresh.length===1) {
          const info=JSON.parse(await asyncCtl(['container','inspect','--format',containerFormat,fresh[0]]));
          assert.equal(info.id,fresh[0]);assert.match(info.id,/^[a-f0-9]{64}$/);
          assert.match(info.name,/^\/aij-document-export-[a-f0-9]{32}$/);assert.match(info.nonce,/^[a-f0-9]{48}$/);
          assert.equal(info.image,probe.imageId);assert.equal(info.configuredImage,probe.imageId);
          if(info.running===true && info.state==='running') {
            assert(Number.isFinite(Date.parse(info.startedAt)) && Date.parse(info.startedAt)>0);
            const byName=JSON.parse(await asyncCtl(['container','inspect','--format',containerFormat,info.name.slice(1)]));
            assert.deepEqual(byName,info,'exact name and ID must identify the same running container');
            assert(!settled,'container exited before running observation completed');
            return {...info,observedAt:new Date().toISOString()};
          }
        }
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw Error('RUNNING_CONTAINER_NOT_OBSERVED');
    }
    async function runningCase(probe,kind,request) {
      const before=owned(), abort=new AbortController();
      const pending=probe.executor.run({...request,timeoutMs:15000,signal:abort.signal});
      let observation, result, failure;
      try {
        observation=await observeRunning(probe,pending,before);
        // Safe fixed metadata only, retained in TAP diagnostics before any cancellation/deadline outcome.
        t.diagnostic(JSON.stringify({case:kind,runningEvidence:observation}));
        if(kind==='ABORTED')abort.abort();
        result=await pending;
        assert.equal(result.outcome,kind);assert.equal(result.cleanupConfirmed,true);
        assert.deepEqual(owned(),before);
      } catch(error) { failure=error; }
      finally {
        // Observation failure is still a failed gate; cancellation here is cleanup, never acceptance evidence.
        abort.abort();
        try {
          result=await pending;
          if(!result.cleanupConfirmed)failure=new AggregateError([...(failure?[failure]:[]),Error('RUNNING_CASE_CLEANUP_UNCONFIRMED')]);
        } catch(error) { failure=new AggregateError([...(failure?[failure]:[]),error]); }
      }
      if(failure)throw failure;
      assert(observation,'missing real running evidence');
    }
    const request={input:{format:'pdf',name:'合成执行限制探针',body:'synthetic'}};
    const resource=await probe(`const fs=require('node:fs'),os=require('node:os');
function ok(v){if(!v)process.exit(9)}
ok(process.getuid()===65534);ok(!Object.keys(os.networkInterfaces()).some(k=>k!=='lo'));
const status=fs.readFileSync('/proc/self/status','utf8');ok(/CapEff:\\s+0+\\n/.test(status));ok(/NoNewPrivs:\\s+1/.test(status));
ok(fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim()==='536870912');ok(fs.readFileSync('/sys/fs/cgroup/memory.swap.max','utf8').trim()==='0');ok(fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim()==='64');
const cpu=fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim().split(' ').map(Number);ok(cpu[0]<=cpu[1]);
let refused=false;try{fs.writeFileSync('/aij/host-write','x')}catch{refused=true}ok(refused);fs.writeFileSync('/tmp/allowed','x');
process.exit(0);`);
    // Exit zero with no envelope proves probe executed all assertions, then adapter rejects missing protocol.
    const resourceResult=await resource.executor.run(request);assert.equal(resourceResult.outcome,'INVALID_PROTOCOL');assert.equal(resourceResult.cleanupConfirmed,true);
    const slow=await probe('setInterval(()=>{},1000)');
    await runningCase(slow,'TIMEOUT',request);
    await runningCase(slow,'ABORTED',request);
    const oom=await probe('const b=[];setInterval(()=>{b.push(Buffer.alloc(64*1024*1024,42))},10)');
    const killed=await oom.executor.run(request);assert.equal(killed.outcome,'OOM_KILLED');assert.equal(killed.cleanupConfirmed,true);
    const corrupt=await probe('process.stdout.write("{corrupt}\\n")');const bad=await corrupt.executor.run(request);assert.equal(bad.outcome,'INVALID_PROTOCOL');assert.equal(bad.cleanupConfirmed,true);
    const flood=await probe('setInterval(()=>process.stdout.write(Buffer.alloc(1024*1024,120)),1)');const capped=await flood.executor.run(request);assert.equal(capped.outcome,'OUTPUT_LIMIT');assert.equal(capped.cleanupConfirmed,true);
    assert.deepEqual(owned(),baseline,'all newly owned IDs must have confirmed cleanup');
  } catch(error) { primaryError=error; }
  finally {
    // Independent cleanup attempts: one unavailable resource must not skip any later attempt.
    // Never sweep containers; the executor alone removes exact nonce/name/image/ID matches.
    try { assert(baseline,'initial container inventory unconfirmed');assert.deepEqual(owned(),baseline,'unknown container liveness fails the gate'); }
    catch(error) { cleanupErrors.push(error); }
    for(const record of images) {
      try {
        verifyProbeImage(record); // re-prove exact new ID + both unpredictable run/probe labels immediately before removal
        ctl(['image','rm',record.id]); // no force and no tags/label-wide deletion
        assert(!imageIds().has(record.id),'owned image removal unconfirmed');
        t.diagnostic(JSON.stringify({probeImageCleanup:{imageId:record.id,probeNonce:record.nonce,confirmed:true}}));
      } catch(error) {
        cleanupErrors.push(error);
        t.diagnostic(JSON.stringify({probeImageCleanup:{imageId:record.id ?? null,probeNonce:record.nonce,confirmed:false}}));
      }
    }
    try { rmSync(dir,{recursive:true,force:true}); }
    catch(error) { cleanupErrors.push(error); }
  }
  if(primaryError || cleanupErrors.length)throw new AggregateError([...(primaryError?[primaryError]:[]),...cleanupErrors],'AF199_LIVE_OR_CLEANUP_FAILED');
});
