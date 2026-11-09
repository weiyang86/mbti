// Offline execution of the actual AF-154 DTO/service/controller/SDK. No DB, app boot or network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import { loadSource } from './optimization-delta/source-loader.mjs';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
require('ts-node').register({ project: fileURLToPath(new URL('../../apps/api/tsconfig.json', import.meta.url)), transpileOnly: true });
require('reflect-metadata');
const dto = require('../../apps/api/src/plugins/aij-ai/ai-personal-skills.dto.ts');
const { AiPersonalSkillsService } = require('../../apps/api/src/plugins/aij-ai/ai-personal-skills.service.ts');
const { WorkspaceContextService } = require('../../apps/api/src/client-workspaces/workspace-context.service.ts');
const { AiPersonalSkillsController, PersonalSkillNoStoreGuard } = require('../../apps/api/src/plugins/aij-ai/ai-personal-skills.controller.ts');
const { WorkspaceContextGuard } = require('../../apps/api/src/client-workspaces/workspace-context.guard.ts');
const P = require('../../apps/api/src/client-workspaces/client-workspace-permissions.ts').CLIENT_WORKSPACE_PERMISSION;
const { CLIENT_WORKSPACE_PERMISSIONS_KEY } = require('../../apps/api/src/client-workspaces/client-workspace-permission.decorator.ts');
const status = code => e => e.getStatus?.() === code;
const initial = { code: 'private-prompt', name: 'Private name sentinel', instructions: "Private prompt sentinel '); DROP TABLE x; --" };
function fixture() {
  let state = { assets: [], versions: [], audits: [] }, deny = false, plugin = true, fault = false, tail = Promise.resolve();
  const calls = [];
  const sql = (parts, values) => {
    assert.ok(Array.isArray(parts) && Array.isArray(parts.raw), 'Prisma tagged SQL required');
    const text = parts.join('?').replace(/\s+/g, ' ').trim();
    assert.ok(!text.includes(initial.instructions) && !text.includes(initial.name), 'user fields remain bindings');
    calls.push({ text, values });
    return text;
  };
  const tx = {
    async $executeRaw(parts, ...v) {
      const q = sql(parts, v);
      if (q.startsWith('SELECT pg_advisory')) return 1;
      if (q.startsWith('INSERT INTO public.ai_personal_skill_version')) {
        const [id, skill_id, workspace_id, member_id, code, name, instructions, revision, created_at] = v;
        assert.ok(!state.versions.some(r => r.skill_id === skill_id && r.revision === revision));
        state.versions.push({ id, skill_id, workspace_id, member_id, code, name, instructions, revision, created_at }); return 1;
      }
      assert.fail('Unexpected execute ' + q);
    },
    async $queryRaw(parts, ...v) {
      const q = sql(parts, v);
      if (q.includes('FROM public.project_profile')) return [{ id: 'project' }];
      if (q.includes('FROM public.plugin_installation')) return plugin ? [{ id: 'plugin' }] : [];
      if (q.includes('FROM public.client_workspace_membership')) {
        assert.equal(typeof v[0], 'string'); assert.equal(typeof v[1], 'string');
        assert.ok([P.aiAssetsRead, P.aiAssetsManage].includes(v[2]));
        for (const fragment of ["u.status = 'active'", 'u.deleted_at IS NULL', 'm.disabled_at IS NULL', 'm.removed_at IS NULL', 'r.deleted_at IS NULL', 'g.deleted_at IS NULL', 'p.deleted_at IS NULL', 'FOR SHARE OF u, w, m, r, g, p']) assert.ok(q.includes(fragment));
        return deny ? [] : [{ id: 'membership' }];
      }
      if (q.startsWith('INSERT INTO public.ai_personal_skill ')) {
        const [id, workspace_id, member_id, code, name, instructions] = v, now = new Date();
        const row = { id, workspace_id, member_id, code, name, instructions, revision: 1, created_at: now, updated_at: now, deleted_at: null };
        state.assets.push(row); return [row];
      }
      if (q.startsWith('SELECT count')) return [{ count: BigInt(state.assets.filter(r => r.workspace_id === v[0] && r.member_id === v[1] && !r.deleted_at).length) }];
      if (q.includes('FROM public.ai_personal_skill_version')) {
        let rows = state.versions.filter(r => r.skill_id === v[0] && r.workspace_id === v[1] && r.member_id === v[2]);
        return q.includes('revision=1') ? rows.filter(r => r.revision === 1) : rows.filter(r => r.revision <= v[3]).sort((a,b) => b.revision-a.revision).slice(0,v[4]);
      }
      if (q.startsWith('SELECT * FROM public.ai_personal_skill WHERE id=')) return state.assets.filter(r => r.id === v[0] && r.workspace_id === v[1] && r.member_id === v[2]);
      if (q.includes('FROM public.ai_personal_skill WHERE workspace_id=')) {
        const rows = state.assets.filter(r => r.workspace_id === v[0] && r.member_id === v[1]);
        return q.includes('code=') ? rows.filter(r => r.code === v[2]) : rows.filter(r => !r.deleted_at && r.id > v[2]).sort((a,b) => a.id.localeCompare(b.id)).slice(0,v[3]);
      }
      if (q.startsWith('UPDATE public.ai_personal_skill')) {
        const editing = q.includes('SET name='), offset = editing ? 2 : 0;
        const row = state.assets.find(r => r.id === v[offset] && r.workspace_id === v[offset+1] && r.member_id === v[offset+2] && r.revision === v[offset+3] && !r.deleted_at);
        if (!row) return [];
        row.updated_at = new Date();
        if (editing) { row.name=v[0]; row.instructions=v[1]; row.revision++; } else row.deleted_at = new Date();
        return [row];
      }
      assert.fail('Unexpected query ' + q);
    },
    auditLog: { async create({ data }) { if (fault) throw new Error('SQL audit injected failure'); state.audits.push(data); return data; } }
  };
  const prisma = { async $transaction(fn) {
    let release; const previous=tail; tail=new Promise(r => { release=r; }); await previous;
    const before=structuredClone(state);
    try { return await fn(tx); } catch(e) { state=before; throw e; } finally { release(); }
  } };
  const plugins = { async projectId(actual) { assert.equal(actual,tx); calls.push({text:'project',values:[]}); return 'project'; }, async assertEnabledInTransaction(actual, project, code) { assert.equal(actual,tx); assert.equal(project,'project'); assert.equal(code,'aij-ai'); calls.push({text:'lifecycle',values:[]}); } };
  return { service: new AiPersonalSkillsService(prisma,new WorkspaceContextService(prisma),plugins), calls, state:()=>state, deny:()=>{deny=true;}, pluginOff:()=>{plugin=false;}, fault:()=>{fault=true;} };
}

test('DTO strict whitelist, bounds, prompt-as-data, code and pagination', () => {
  assert.deepEqual(dto.createPersonalSkillDto(initial),initial);
  for (const extra of ['memberId','workspaceId','projectId','ownerId','script','file','ref','revision','__proto__']) {
    assert.throws(()=>dto.createPersonalSkillDto({...initial,[extra]:'forged'}),status(400));
  }
  for (const input of [{...initial,name:'a'.repeat(101)},{...initial,name:' x '},{...initial,code:'A..bad'},{...initial,code:'x'},{...initial,instructions:'a'.repeat(8001)},{...initial,instructions:'\0'},{...initial,instructions:'  '}]) assert.throws(()=>dto.createPersonalSkillDto(input),status(400));
  assert.equal(dto.createPersonalSkillDto({...initial,name:'n'.repeat(100),code:'a'.repeat(63),instructions:'中'.repeat(8000)}).instructions.length,8000);
  for(const expectedRevision of [0,-1,1.1,'1',2147483648]) assert.throws(()=>dto.updatePersonalSkillDto({name:initial.name,instructions:initial.instructions,expectedRevision}),status(400));
  assert.deepEqual(dto.personalSkillPage({limit:'50'}),{limit:50});
  for(const query of [{limit:'51'},{limit:['2']},{limit:'01'},{memberId:'forged'},{afterId:'../x'}]) assert.throws(()=>dto.personalSkillPage(query),status(400));
});

test('actual service creates one initial snapshot, exact replay is read-only and changed reuse conflicts',async()=>{
  const f=fixture(); const a=await f.service.create('member','workspace',initial);
  assert.equal(a.revision,1); assert.equal(a.instructions,initial.instructions);
  assert.deepEqual(await f.service.create('member','workspace',initial),a);
  await assert.rejects(f.service.create('member','workspace',{...initial,instructions:'different'}),status(409));
  assert.equal(f.state().assets.length,1);assert.equal(f.state().versions.length,1);assert.equal(f.state().audits.length,1);
  const texts=f.calls.map(c=>c.text);assert.ok(texts.indexOf('lifecycle')<texts.findIndex(q=>q.includes('membership:')||q.includes('FROM public.client_workspace_membership')));
  assert.ok(texts.findIndex(q=>q.includes('FROM public.client_workspace_membership'))<texts.findIndex(q=>q.startsWith('INSERT INTO public.ai_personal_skill ')));
  assert.equal(f.calls.filter(c=>c.text==='lifecycle').length,3);
});

test('CAS edit, stale no-op denial, exact no-op, bounded history and read/list',async()=>{
  const f=fixture(), a=await f.service.create('member','workspace',initial);
  const input={name:initial.name,instructions:initial.instructions,expectedRevision:1};
  await f.service.update('member','workspace',a.id,input);assert.equal(f.state().versions.length,1);
  const result=await f.service.update('member','workspace',a.id,{...input,instructions:'second'});assert.equal(result.revision,2);
  await assert.rejects(f.service.update('member','workspace',a.id,{...input,instructions:'third'}),status(409));
  assert.equal((await f.service.get('member','workspace',a.id)).instructions,'second');
  const versions=await f.service.versions('member','workspace',a.id,{limit:'1'});assert.equal(versions.items[0].revision,2);assert.equal(versions.nextCursor,2);
  assert.equal((await f.service.versions('member','workspace',a.id,{beforeRevision:'2'})).items[0].instructions,initial.instructions);
  const list=await f.service.list('member','workspace',{});assert.equal(list.items.length,1);assert.equal(list.items[0].instructions,undefined);
  assert.equal((await f.service.list('member','workspace',{afterId:a.id})).items.length,0);
  assert.equal(f.state().versions.length,2);assert.equal(f.state().audits.length,2);
});

test('private ownership, workspace selector, denied membership and disabled plugin perform no writes',async()=>{
  const f=fixture(), a=await f.service.create('member','workspace',initial), before=JSON.stringify(f.state());
  for(const [member,workspace] of [['another','workspace'],['member','another']]) {
    await assert.rejects(f.service.get(member,workspace,a.id),status(404));
    await assert.rejects(f.service.versions(member,workspace,a.id,{}),status(404));
    await assert.rejects(f.service.update(member,workspace,a.id,{name:'n',instructions:'i',expectedRevision:1}),status(404));
    await assert.rejects(f.service.delete(member,workspace,a.id,{expectedRevision:1}),status(404));
  }
  f.deny();for(const action of [()=>f.service.get('member','workspace',a.id),()=>f.service.list('member','workspace',{}),()=>f.service.versions('member','workspace',a.id,{}),()=>f.service.delete('member','workspace',a.id,{expectedRevision:1}),()=>f.service.update('member','workspace',a.id,{name:'x',instructions:'x',expectedRevision:1}),()=>f.service.create('member','workspace',{...initial,code:'another'})]) await assert.rejects(action(),status(403));
  assert.equal(JSON.stringify(f.state()),before);
  const g=fixture();g.pluginOff();await assert.rejects(g.service.create('member','workspace',initial),status(404));assert.equal(g.state().assets.length,0);
});

test('delete is stable, preserves history, hides deleted versions and blocks resurrection by code',async()=>{
  const f=fixture(),a=await f.service.create('member','workspace',initial);
  await assert.rejects(f.service.delete('member','workspace',a.id,{expectedRevision:2}),status(409));
  const result=await f.service.delete('member','workspace',a.id,{expectedRevision:1});
  assert.deepEqual(await f.service.delete('member','workspace',a.id,{expectedRevision:1}),result);
  await assert.rejects(f.service.get('member','workspace',a.id),status(404));
  await assert.rejects(f.service.versions('member','workspace',a.id,{}),status(404));
  await assert.rejects(f.service.update('member','workspace',a.id,{name:'x',instructions:'x',expectedRevision:1}),status(404));
  await assert.rejects(f.service.create('member','workspace',initial),status(409));
  assert.equal(f.state().versions.length,1);assert.equal(f.state().audits.length,2);
});

test('audit failure rolls back asset and immutable version; audit output contains IDs/fields only',async()=>{
  const f=fixture();f.fault();await assert.rejects(f.service.create('member','workspace',initial),status(503));assert.equal(f.state().assets.length,0);assert.equal(f.state().versions.length,0);
  const g=fixture(),a=await g.service.create('member','workspace',initial),before=JSON.stringify(g.state());g.fault();
  await assert.rejects(g.service.update('member','workspace',a.id,{name:'new name',instructions:'new body',expectedRevision:1}),status(503));assert.equal(JSON.stringify(g.state()),before);
  const audit=g.state().audits[0];assert.equal(audit.userId,'member');assert.equal(JSON.stringify(audit).includes(initial.name),false);assert.equal(JSON.stringify(audit).includes(initial.instructions),false);
  assert.deepEqual(Object.keys(audit.afterData).sort(),['fields','revision','skillId']);
});

test('scoped quota rejects 101st live asset and serialized fixture duplicate create/CAS',async()=>{
  const f=fixture();const both=await Promise.all([f.service.create('member','workspace',initial),f.service.create('member','workspace',initial)]);assert.equal(both[0].id,both[1].id);
  const edits=await Promise.allSettled(['a','b'].map(instructions=>f.service.update('member','workspace',both[0].id,{name:'n',instructions,expectedRevision:1})));
  assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);assert.equal(edits.find(r=>r.status==='rejected').reason.getStatus(),409);
  for(let i=1;i<100;i++) await f.service.create('member','workspace',{...initial,code:'skill-'+i});
  await assert.rejects(f.service.create('member','workspace',{...initial,code:'overflow'}),status(409));assert.equal(f.state().assets.length,100);
});

test('actual controller uses verified identity, permissions, origin and pre-auth no-store guard',()=>{
  let called=0;const spy=new Proxy({}, {get:()=> (member,workspace)=>{called++;assert.equal(member,'verified');assert.equal(workspace,'verified-space');}});
  const c=new AiPersonalSkillsController(spy,{getOrThrow:()=> 'http://localhost:3655'}),r={client:{id:'verified'},workspaceContext:{workspaceId:'verified-space'},headers:{origin:'http://localhost:3655','x-aij-workspace-id':'forged'}};
  c.create(r,initial);c.update(r,'id',{});c.delete(r,'id',{});c.list(r,{});c.get(r,'id');c.versions(r,'id',{});assert.equal(called,6);
  for(const origin of [undefined,'https://foreign.invalid']) assert.throws(()=>c.create({...r,headers:{origin}},initial),status(403));
  assert.throws(()=>c.delete({...r,headers:{...r.headers,'sec-fetch-site':'cross-site'}},'id',{}),status(403));
  assert.throws(()=>c.list({headers:{}},{}),status(403));
  assert.ok(Reflect.getMetadata('__guards__',AiPersonalSkillsController).includes(WorkspaceContextGuard));
  for(const method of ['list','get','versions']) assert.deepEqual(Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY,c[method]),[P.aiAssetsRead]);
  for(const method of ['create','update','delete']) assert.deepEqual(Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY,c[method]),[P.aiAssetsManage]);
  let header;new PersonalSkillNoStoreGuard().canActivate({switchToHttp:()=>({getResponse:()=>({setHeader:(...value)=>{header=value;}})})});assert.deepEqual(header,['Cache-Control','private, no-store']);
});

test('actual SDK module calls ClientApi with narrow bodies, cursors and propagates failures',async()=>{
  const {createPersonalSkillsClient}=loadSource('packages/sdk/src/personal-skills.ts',{}, {URLSearchParams,TextEncoder});
  const calls=[], failure=new Error('HTTP409');let fail=false;
  const sdk=createPersonalSkillsClient(async(path,options)=>{calls.push({path,options});if(fail)throw failure;return{id:'x'};});
  await sdk.create('space',initial);assert.equal(calls[0].options.workspaceId,'space');assert.equal(calls[0].options.method,'POST');assert.deepEqual(JSON.parse(calls[0].options.body),initial);
  await sdk.list('space',{limit:50,afterId:'id'});assert.ok(calls.at(-1).path.includes('limit=50&afterId=id'));
  await sdk.versions('space','id',{beforeRevision:2,limit:1});assert.ok(calls.at(-1).path.includes('/id/versions?limit=1&beforeRevision=2'));
  await sdk.update('space','id',{name:'n',instructions:'i',expectedRevision:1});await sdk.delete('space','id',2);
  for(const operation of [()=>sdk.create('space',{...initial,memberId:'forged'}),()=>sdk.update('space','id',{name:'n',instructions:'i',expectedRevision:0}),()=>sdk.list('space',{limit:51}),()=>sdk.get('space','../id')]) assert.throws(operation);
  fail=true;await assert.rejects(sdk.get('space','id'),e=>e===failure);
});

test('actual ClientApi transport supplies workspace/cookie policy and preserves HTTP409',async()=>{
  const personal=loadSource('packages/sdk/src/personal-skills.ts',{}, {URLSearchParams,TextEncoder});
  const requests=[];let responseStatus=200;
  const contracts=loadSource('packages/contracts/src/index.ts');
  const sdk=loadSource('packages/sdk/src/index.ts',{'@aij/contracts':contracts,'./knowledge-citations.js':loadSource('packages/sdk/src/knowledge-citations.ts'),'./personal-script-execution.js':loadSource('packages/sdk/src/personal-script-execution.ts'),'./client-binary-response.js':loadSource('packages/sdk/src/client-binary-response.ts'),'./personal-document-exports.js':loadSource('packages/sdk/src/personal-document-exports.ts',{'./client-binary-response.js':loadSource('packages/sdk/src/client-binary-response.ts')},{Object,TextEncoder,URLSearchParams}),'./personal-workflow-execution.js':loadSource('packages/sdk/src/personal-workflow-execution.ts',{}, {Object,TextEncoder,URLSearchParams}),'./external-services.js':loadSource('packages/sdk/src/external-services.ts',{}, {Object,TextEncoder,URLSearchParams}),'./knowledge-web-imports.js':loadSource('packages/sdk/src/knowledge-web-imports.ts',{}, {Object,TextEncoder,URLSearchParams}),'./personal-documents.js':loadSource('packages/sdk/src/personal-documents.ts',{}, {Object,TextEncoder,TextDecoder,URLSearchParams}),'./personal-agent-publications.js':loadSource('packages/sdk/src/personal-agent-publications.ts',{}, {Object}),'./personal-workflows.js':loadSource('packages/sdk/src/personal-workflows.ts',{}, {Object,TextEncoder,URLSearchParams}),'./personal-agent-run-previews.js':loadSource('packages/sdk/src/personal-agent-run-previews.ts'),'./personal-memories.js':loadSource('packages/sdk/src/personal-memories.ts',{}, {Object,TextEncoder,TextDecoder}),'./personal-agent-runs.js':loadSource('packages/sdk/src/personal-agent-runs.ts'),'./personal-skills.js':personal,'./ai-run-recovery.js':{},'./personal-agents.js':loadSource('packages/sdk/src/personal-agents.ts',{}, {URLSearchParams,TextEncoder})}, {
    Headers, FormData, AbortSignal,
    fetch:async(url,options)=>{requests.push({url,options});return {ok:responseStatus===200,status:responseStatus,json:async()=>({success:true,message:'ok',data:{id:'result'}})};}
  });
  const client=sdk.createPersonalSkillsClient(sdk.createClientApi(()=> 'http://fixture.invalid/api'));
  assert.equal((await client.get('workspace','skill')).id,'result');
  const r=requests[0];assert.equal(r.url,'http://fixture.invalid/api/client/ai/skills/skill');
  assert.equal(r.options.headers.get('x-aij-workspace-id'),'workspace');assert.equal(r.options.credentials,'include');assert.equal(r.options.cache,'no-store');
  responseStatus=409;await assert.rejects(client.get('workspace','skill'),e=>e instanceof sdk.ClientRequestFailure&&e.status===409);
});

test('SQL migration and schema proposal retain composite scope and DB append-only protections',()=>{
  const sql=readFileSync(new URL('../../apps/api/prisma/migrations/20261105010000_ai_personal_skills/migration.sql',import.meta.url),'utf8');
  assert.ok(sql.includes('BEFORE UPDATE OR DELETE OR TRUNCATE'));assert.ok(sql.includes('FOREIGN KEY ("skill_id","workspace_id","member_id")'));assert.ok(sql.includes('ON CONFLICT ("role_id","permission_id") DO NOTHING'));
  const source=readFileSync(new URL('../../apps/api/src/plugins/aij-ai/ai-personal-skills.service.ts',import.meta.url),'utf8');assert.equal(source.includes('$queryRawUnsafe'),false);assert.equal(source.includes('$executeRawUnsafe'),false);
  assert.equal((source.match(/\$transaction\(/g)||[]).length,1);assert.ok(source.includes('assertWritePermissionInTransaction'));
  assert.ok(readFileSync(new URL('../../packages/sdk/src/index.ts',import.meta.url),'utf8').includes('createAiRunRecoveryClient'));
});
