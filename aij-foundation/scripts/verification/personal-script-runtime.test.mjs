// Executes the actual services with explicitly synthetic SQL/File/runner collaborators.
// No assertion in this suite is Docker, PostgreSQL, filesystem-owner or integration evidence.
import Module, {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
const require = createRequire(import.meta.url), ts = require('typescript');
const apiRequire = createRequire(resolve('apps/api/package.json')), nest = apiRequire('@nestjs/common');
function load(name, overrides = {}) {
  const file = resolve('apps/api/src/plugins/aij-ai/' + name + '.ts'), m = new Module(file);
  m.filename = file; m.paths = Module._nodeModulePaths(resolve('apps/api'));
  m.require = p => overrides[p] ?? apiRequire(p);
  m._compile(ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: true}}).outputText, file);
  return m.exports;
}
const p = load('ai-personal-script-run-profile');
const r = load('ai-personal-script-runs.service', {'./ai-personal-script-run-profile': p, '../../async-runtime/job.service': {JobService: class {}}});
const e = load('ai-personal-script-execution.service', {'./ai-personal-script-run-profile': p, './ai-personal-script-runs.service': r,
  '../../prisma/prisma.service': {PrismaService: class {}}, '../../async-runtime/registry': {RuntimeRegistry: class {}}, './python-sandbox-runner': load('python-sandbox-runner')});
const versionId = '11111111-1111-4111-8111-111111111111', nonce = '22222222-2222-4222-8222-222222222222';
const scope = {projectId: 'p', memberId: 'm', workspaceId: 'w'}, claims = {sub: 'm', sessionId: 'startup', tokenVersion: 1};
const ref = {scriptVersionId: versionId, skillId: 'skill', skillVersionId: 'version', revision: 1, scriptDigest: p.digest('print(input_data)'), policyDigest: p.POLICY_DIGEST};
const status = n => err => err.getStatus?.() === n;
function fixture() {
  const f = {row: null, jobs: [], assets: new Map(), configured: true, active: true, lease: true, calls: [], sessions: [], output: ' {"ok":true}\n', cleanup: true, expired: false, auditFail: false, changed: false, denyExecute: false, runnerCalls: 0, ioLocks: [], inTx: false};
  const tx = {
    $queryRaw: async (strings, ...v) => {
      const sql = strings.join('?'); f.calls.push(sql);
      if (sql.includes('pg_advisory')) return [];
      if (sql.includes('FROM public.runtime_job')) return f.lease ? [{id: f.row.job_id}] : [];
      if (sql.startsWith('SELECT project_id')) return f.row ? [f.row] : [];
      if (sql.includes("outcome='SUCCESS'")) return f.row?.outcome === 'SUCCESS' && f.row.output_asset_id === v[5] ? [{id: f.row.id}] : [];
      if (!f.row) return [];
      if (sql.includes('WHERE request_key=') && v[0] !== f.row.request_key) return [];
      if (sql.includes('WHERE id=') && v[0] !== f.row.id) return [];
      return [{...f.row, expired: f.expired}];
    },
    $executeRaw: async (strings, ...v) => {
      const sql = strings.join('?'); f.calls.push(sql);
      if (sql.startsWith('INSERT')) f.row = {id:v[0], project_id:v[1],workspace_id:v[2],member_id:v[3],script_version_id:v[4],skill_ref:JSON.parse(v[5]),request_key:v[6],request_hash:v[7],input:JSON.parse(v[8]),session_id:v[9],token_version:v[10],job_id:v[11],created_at:new Date(),expires_at:new Date(Date.now()+86400000),attempted_at:null,outcome:null,output_asset_id:null,content_purged_at:null};
      else if (sql.includes('SET attempted_at')) f.row.attempted_at = new Date();
      else if (sql.includes("SET outcome='SUCCESS'")) { f.row.outcome = 'SUCCESS'; f.row.output_asset_id = v[0]; }
      else if (sql.includes('SET outcome=')) f.row.outcome = v[0];
      else if (sql.includes('SET input=NULL')) { f.row.input = null; f.row.content_purged_at = new Date(); }
      return 1;
    },
    runtimeJob: {findFirst: async () => f.jobs[0] ? {status: f.jobStatus ?? 'pending'} : null},
    auditLog: {create: async data => { f.calls.push(data); if (f.auditFail) throw new Error('private audit diagnostic'); }},
  };
  const transact = async work => {
    const before = structuredClone(f.row), jobs = [...f.jobs], assets = new Map(f.assets);
    f.inTx = true;
    try { const result = await work(tx); f.inTx = false; if (f.commitUnknown && f.row?.outcome === 'SUCCESS') {f.commitUnknown = false; throw new Error('unknown committed');} return result; }
    catch (err) { if (err.message !== 'unknown committed') {f.row = before; f.jobs = jobs; f.assets = assets;} f.inTx = false; throw err; }
  };
  const auth = {assertSessionInTransaction: async (_tx,c) => {f.sessions.push(c.sessionId); if (!f.active) throw new nest.UnauthorizedException();}};
  const source = async (tx, _s, _id, gate) => {await gate(tx); return {projectId:'p',ref:{...ref,revision:f.changed ? 2 : 1},scriptSource:'print(input_data)'};};
  const skills = {resolveInTransaction:source,resolveForReadInTransaction:source};
  const access = {withCurrent: async (_m,_w,permissions,work) => {
    if (f.denyExecute && permissions.includes('workspace.ai.execute')) throw new nest.ForbiddenException();
    return transact(tx => work(tx, scope));
  }};
  const files = {
    stage: async (_scope,spec) => {f.ioLocks.push(f.inTx); f.stageSpec = {...spec,bytes:Buffer.from(spec.bytes)}; if (f.revokeAtStage) f.active = false; if (f.expireAtStage) f.lease = false; return {assetId:'33333333-3333-4333-8333-333333333333'};},
    commitInTransaction: async (_tx,ticket) => {const meta = {assetId:ticket.assetId,originalName:f.stageSpec.originalName,mimeType:'application/json',size:f.stageSpec.bytes.length,checksum:f.stageSpec.checksum,createdAt:new Date()}; f.assets.set(ticket.assetId,meta); return meta;},
    metadataInTransaction: async (_tx,id) => f.assets.get(id),
    confirm: async () => {f.ioLocks.push(f.inTx); f.confirmed = true;},
    discard: async ticket => {f.ioLocks.push(f.inTx); f.discarded = true; return {removed:!f.assets.has(ticket.assetId),retainedBecauseCommitted:f.assets.has(ticket.assetId)};},
    prepareReadInTransaction: async () => ({}),
    readPrepared: async () => {f.ioLocks.push(f.inTx); if (f.revokeAtRead) f.active = false; f.readBytes = Buffer.from(f.stageSpec.bytes); return f.readBytes;},
  };
  const config = {get configured(){return f.configured;},runner:{run:async () => {f.runnerCalls++; assert(f.row.attempted_at); f.ioLocks.push(f.inTx); if(f.runnerThrows) throw new Error('private docker diagnostic'); return {stdout:f.output,stderr:'PRIVATE',outcome:'SUCCESS',cleanupConfirmed:f.cleanup};}}};
  const jobs = {enqueueInTransaction:async (_tx,input) => {f.jobs.push(input); return {id:input.id};}};
  f.runs = new r.AiPersonalScriptRunsService(access,skills,auth,files,config,jobs);
  f.execution = new e.AiPersonalScriptExecutionService({$queryRaw:tx.$queryRaw,$executeRaw:tx.$executeRaw}, {registerOrchestratedJob:(...args) => {f.registration=args;}}, f.runs,config);
  f.submit = (input = {a:1},key='request01') => f.runs.submit('m','w',{scriptVersionId:versionId,input,idempotencyKey:key},claims);
  f.execute = () => f.execution.execute({id:f.row.job_id,payload:{runId:f.row.id},idempotencyKey:'script:'+f.row.id,leaseOwner:'owner',leaseNonce:nonce,attempt:1,maxAttempts:1,signal:new AbortController().signal});
  return f;
}
test('strict canonical values reject getters/proxies/prototypes/holes/symbols/dangerous keys/nonfinite/Unicode/size/depth', () => {
  assert.equal(p.canonical({b:1,a:[null,true,'中']}),'{"a":[null,true,"中"],"b":1}');
  const cycle={};cycle.x=cycle; let deep=null;for(let i=0;i<18;i++)deep=[deep];
  for (const bad of [undefined,NaN,Infinity,1n,'\ud800',Object.create(null),{get a(){throw Error('getter');}},new Proxy({},{}),Array(2),{[Symbol()]:1},JSON.parse('{"__proto__":1}'),cycle,deep,'x'.repeat(16385)]) assert.throws(()=>p.canonical(bad));
  assert.equal(p.canonical('x'.repeat(16382)).length,16384);
});
test('strict output preserves original bytes and rejects duplicate escaped keys and secondary documents',()=>{
  assert.equal(p.outputBytes(' \n[1,true,null]\t').toString(),' \n[1,true,null]\t');
  for(const bad of ['{"a":1,"\\u0061":2}','{"a":{"b":1,"b":2}}','1 2','hello {}','1e999','"\\ud800"','{"constructor":1}','', '"'+'x'.repeat(65536)+'"'])assert.throws(()=>p.outputBytes(bad));
});
test('request domain includes every ref field and canonical input',()=>{
  const hash=p.requestHash(ref,p.canonical({b:2,a:1}));assert.equal(hash,p.requestHash(ref,p.canonical({a:1,b:2})));
  for(const key of Object.keys(ref))assert.notEqual(hash,p.requestHash({...ref,[key]:key==='revision'?2:'different'},p.canonical({a:1,b:2})));
  assert.throws(()=>p.scriptRef({...ref,policyDigest:'0'.repeat(64)}));
});
test('default production profile is disabled and missing DI fails closed',async()=>{
  assert.equal(new e.ScriptSandboxConfiguration().configured,false);
  await assert.rejects(new r.AiPersonalScriptRunsService().read('m','w',versionId,claims),status(503));
  const f=fixture();f.configured=false;await assert.rejects(f.submit(),status(503));assert.equal(f.jobs.length,0);
});
test('admission atomicity, replay and conflicting key use actual service with synthetic transaction rollback',async()=>{
  const f=fixture();const first=await f.submit();assert.equal(f.jobs.length,1);assert.equal((await f.submit()).id,first.id);assert.equal(f.jobs.length,1);
  await assert.rejects(f.submit({a:2}),status(409));assert.equal(f.jobs.length,1);
  const g=fixture();g.auditFail=true;await assert.rejects(g.submit(),status(503));assert.equal(g.row,null);assert.equal(g.jobs.length,0);
  assert.equal(f.jobs[0].maxAttempts,1);assert.equal(f.jobs[0].timeoutMs,120000);assert.deepEqual(Object.keys(f.jobs[0].payload),['runId']);
});
test('real registration and successful orchestration commit attachment without locks across IO',async()=>{
  const f=fixture();f.execution.onModuleInit();assert.equal(f.registration[0],p.SCRIPT_JOB);await f.submit();assert.equal((await f.execute()).resultReference.code,'SUCCESS');
  assert.equal(f.runnerCalls,1);assert.equal(f.row.outcome,'SUCCESS');assert.equal(f.confirmed,true);assert(f.ioLocks.every(x=>x===false));
  assert.equal(f.stageSpec.bytes.toString(),f.output);assert(!JSON.stringify(f.calls).includes('PRIVATE'));
  const download=await f.runs.content('m','w',f.row.id,{...claims,sessionId:'new-query'});assert.equal(download.meta.checksum,p.digest(download.bytes));assert(f.sessions.includes('new-query'));
});
test('attempted marker prevents second container even when outcome unknown',async()=>{
  const f=fixture();await f.submit();f.runnerThrows=true;await f.execute();assert.equal(f.row.outcome,'UNKNOWN');await f.execute();assert.equal(f.runnerCalls,1);
  const g=fixture();await g.submit();g.row.attempted_at=new Date();await g.execute();assert.equal(g.runnerCalls,0);assert.equal(g.row.outcome,'UNKNOWN');
});
test('cleanup unconfirmed and invalid output never create an asset',async()=>{
  for(const kind of ['cleanup','duplicate']){const f=fixture();await f.submit();if(kind==='cleanup')f.cleanup=false;else f.output='{"x":1,"x":2}';await f.execute();assert.equal(f.assets.size,0);assert.equal(f.row.outcome,kind==='cleanup'?'UNKNOWN':'INVALID_OUTPUT');}
});
test('revoked startup session prevents container; late revocation discards staged bytes',async()=>{
  const f=fixture();await f.submit();f.active=false;await f.execute();assert.equal(f.runnerCalls,0);
  const g=fixture();await g.submit();g.revokeAtStage=true;await g.execute();assert.equal(g.assets.size,0);assert.equal(g.discarded,true);assert.equal(g.runnerCalls,1);
});
test('stale lease before or after IO cannot commit result or audit',async()=>{
  const f=fixture();await f.submit();f.lease=false;const count=f.calls.filter(x=>typeof x==='object').length;await f.execute();assert.equal(f.runnerCalls,0);assert.equal(f.calls.filter(x=>typeof x==='object').length,count);
  const g=fixture();await g.submit();g.expireAtStage=true;await g.execute();assert.equal(g.assets.size,0);assert.equal(g.row.outcome,null);assert.equal(g.discarded,true);
  assert(g.calls.some(sql=>typeof sql==='string'&&sql.includes('lease_expires_at>clock_timestamp()')));
});
test('unknown committed attachment is retained and exact relation readback recovers SUCCESS',async()=>{
  const f=fixture();await f.submit();f.commitUnknown=true;const result=await f.execute();assert.equal(result.resultReference.code,'SUCCESS');assert.equal(f.assets.size,1);assert.equal(f.discarded,true);await f.execute();assert.equal(f.runnerCalls,1);
});
test('reads use new session, do not enqueue; revocation after storage IO zeroes bytes',async()=>{
  const f=fixture();await f.submit();await f.execute();const before=f.jobs.length;await f.runs.recover('m','w','request01',{...claims,sessionId:'current-query'});assert.equal(f.jobs.length,before);assert.equal(f.sessions.at(-1),'current-query');
  f.revokeAtRead=true;await assert.rejects(f.runs.content('m','w',f.row.id,claims),status(401));assert(f.readBytes.every(b=>b===0));
});
test('changed source and expiry refuse reads; retention purges input without deleting identity',async()=>{
  const f=fixture();await f.submit();f.changed=true;await assert.rejects(f.runs.read('m','w',f.row.id,claims),status(409));f.changed=false;f.expired=true;await assert.rejects(f.runs.recover('m','w','request01',claims),status(410));await f.execution.purgeExpiredInputs();assert.equal(f.row.input,null);assert.equal(f.row.request_key,'request01');
});
test('capability separates configured and permission and never invokes runner',async()=>{
  const f=fixture();f.denyExecute=true;assert.deepEqual(await f.runs.capability('m','w',claims),{configured:true,canExecute:false,reason:'not_permitted'});assert.equal(f.runnerCalls,0);f.denyExecute=false;f.configured=false;assert.equal((await f.runs.capability('m','w',claims)).reason,'not_configured');
});
test('strict limits count total entries and all JSON primitive roots; malformed API identifiers are400',async()=>{
  for(const value of [null,true,false,0,'text',[]]) assert.deepEqual(JSON.parse(p.canonical(value)),value);
  assert.throws(()=>p.canonical(Array(2049).fill(null)));assert.doesNotThrow(()=>p.canonical(Array(2048).fill(null)));
  const f=fixture();await assert.rejects(f.runs.read('m','w','invalid',claims),status(400));
});
