// Actual source, OFFLINE ONLY: fake SQL returns do not prove PostgreSQL behavior.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {loadSource} from './optimization-delta/source-loader.mjs';
const require=createRequire(new URL('../../apps/api/package.json',import.meta.url));
require('ts-node').register({project:fileURLToPath(new URL('../../apps/api/tsconfig.json',import.meta.url)),transpileOnly:true});
require('reflect-metadata');
const dto=require('../../apps/api/src/plugins/aij-ai/ai-personal-agents.dto.ts');
const {AiPersonalAgentsService}=require('../../apps/api/src/plugins/aij-ai/ai-personal-agents.service.ts');
const {WorkspaceContextService}=require('../../apps/api/src/client-workspaces/workspace-context.service.ts');
const {AiPersonalAgentsController,PersonalAgentNoStoreGuard}=require('../../apps/api/src/plugins/aij-ai/ai-personal-agents.controller.ts');
const {WorkspaceContextGuard}=require('../../apps/api/src/client-workspaces/workspace-context.guard.ts');
const P=require('../../apps/api/src/client-workspaces/client-workspace-permissions.ts').CLIENT_WORKSPACE_PERMISSION;
const {CLIENT_WORKSPACE_PERMISSIONS_KEY}=require('../../apps/api/src/client-workspaces/client-workspace-permission.decorator.ts');
const status=code=>e=>e.getStatus?.()===code;
const initial={code:'private-agent',name:'Agent name sentinel',instructions:"Agent instruction sentinel '); DELETE FROM x; --",modelCode:'text-model',modelRevision:1,catalogVersion:1,inputFields:['question'],outputFormat:'json',outputFields:['answer'],skillBindings:[{skillId:'skill-b',revision:1},{skillId:'skill-a',revision:1}]};
const edit=(extra={})=>{const c={...initial};delete c.code;return {...c,expectedRevision:1,...extra};};
function fixture(){
  let state={assets:[],versions:[],bindings:[],audits:[]},tail=Promise.resolve(),deny=false,plugin=true,fault=false;
  const calls=[],skills=['skill-a','skill-b','foreign-skill'].map((id,i)=>({skill_id:id,id:id+'-v1',revision:1,workspace:i===2?'foreign':'space',member:'member',deleted:false}));
  const catalog={version:1,catalog:{providers:[{code:'provider',enabled:true,vendor:'compatible',baseUrl:'SECRET_URL',credentialRef:'SECRET_REF'}],models:[{code:'text-model',name:'Text',revision:1,enabled:true,providerCode:'provider',capability:'text',upstreamModel:'SECRET_UPSTREAM',inputNanosPerMillion:'100'}, {code:'image-model',name:'Image',revision:1,enabled:true,providerCode:'provider',capability:'image'},{code:'disabled-model',name:'Disabled',revision:1,enabled:false,providerCode:'provider',capability:'text'}]}};
  const sql=(parts,v)=>{assert.ok(Array.isArray(parts)&&Array.isArray(parts.raw));const text=parts.join('?').replace(/\s+/g,' ').trim();assert.ok(!text.includes(initial.instructions)&&!text.includes(initial.name));calls.push({text,v});return text;};
  const tx={
    async $executeRaw(parts,...v){const q=sql(parts,v);
      if(q.startsWith('SELECT pg_advisory'))return 1;
      if(q.startsWith('INSERT INTO public.ai_personal_agent_version')){
        const [id,agent_id,workspace_id,member_id,code,name,instructions,enabled,model_code,model_revision,catalog_version,input,output_format,output,revision,created_at,skill_binding_count]=v;
        state.versions.push({id,agent_id,workspace_id,member_id,code,name,instructions,enabled,model_code,model_revision,catalog_version,input_fields:JSON.parse(input),output_format,output_fields:JSON.parse(output),revision,created_at,skill_binding_count});return 1;
      }
      if(q.startsWith('INSERT INTO public.ai_personal_agent_skill_binding')){const [id,agent_version_id,workspace_id,member_id,skill_version_id,position]=v;state.bindings.push({id,agent_version_id,workspace_id,member_id,skill_version_id,position});return 1;}
      assert.fail('Unexpected execute '+q);
    },
    async $queryRaw(parts,...v){const q=sql(parts,v);
      if(q.includes('FROM public.project_profile'))return [{id:'project'}];
      if(q.includes('FROM public.plugin_installation'))return plugin?[{id:'plugin'}]:[];
      if(q.includes('FROM public.client_workspace_membership')){
        for(const fragment of ["u.status = 'active'",'u.deleted_at IS NULL','m.disabled_at IS NULL','m.removed_at IS NULL','r.deleted_at IS NULL','g.deleted_at IS NULL','p.deleted_at IS NULL','FOR SHARE OF u, w, m, r, g, p'])assert.ok(q.includes(fragment));
        assert.ok([P.aiAssetsRead,P.aiAssetsManage].includes(v[2]));return deny?[]:[{id:'membership'}];
      }
      if(q.includes('FROM public.scoped_config'))return [{id:'catalog'}];
      if(q.includes('FROM public.ai_personal_skill s')){assert.ok(q.includes('FOR SHARE OF s,v'));return skills.filter(s=>s.skill_id===v[0]&&s.workspace===v[1]&&s.member===v[2]&&!s.deleted&&s.revision===v[3]);}
      if(q.includes('FROM public.ai_personal_agent_skill_binding b'))return state.bindings.filter(b=>b.agent_version_id===v[0]&&b.workspace_id===v[1]&&b.member_id===v[2]).sort((a,b)=>a.position-b.position).map(b=>{const s=skills.find(s=>s.id===b.skill_version_id);return {skill_id:s.skill_id,skill_version_id:s.id,revision:s.revision};});
      if(q.includes('FROM public.ai_personal_agent_version')){let rows=state.versions.filter(r=>r.agent_id===v[0]&&r.workspace_id===v[1]&&r.member_id===v[2]);return q.includes('revision <')?rows.filter(r=>r.revision<v[3]).sort((a,b)=>b.revision-a.revision).slice(0,v[4]):rows.filter(r=>r.revision===v[3]);}
      if(q.startsWith('INSERT INTO public.ai_personal_agent ')){
        const [id,workspace_id,member_id,code,name,instructions,enabled,model_code,model_revision,catalog_version,input,output_format,output]=v,now=new Date();
        const r={id,workspace_id,member_id,code,name,instructions,enabled,model_code,model_revision,catalog_version,input_fields:JSON.parse(input),output_format,output_fields:JSON.parse(output),revision:1,created_at:now,updated_at:now,deleted_at:null};state.assets.push(r);return [r];
      }
      if(q.startsWith('SELECT count'))return [{count:BigInt(state.assets.filter(r=>r.workspace_id===v[0]&&r.member_id===v[1]&&!r.deleted_at).length)}];
      if(q.startsWith('SELECT * FROM public.ai_personal_agent WHERE id='))return state.assets.filter(r=>r.id===v[0]&&r.workspace_id===v[1]&&r.member_id===v[2]);
      if(q.startsWith('SELECT * FROM public.ai_personal_agent WHERE workspace_id=')){const rows=state.assets.filter(r=>r.workspace_id===v[0]&&r.member_id===v[1]);return q.includes('code=')?rows.filter(r=>r.code===v[2]):rows.filter(r=>!r.deleted_at&&r.id>v[2]).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,v[3]);}
      if(q.startsWith('UPDATE public.ai_personal_agent')){const editing=q.includes('SET name='),o=editing?9:0;const r=state.assets.find(r=>r.id===v[o]&&r.workspace_id===v[o+1]&&r.member_id===v[o+2]&&r.revision===v[o+3]&&!r.deleted_at);if(!r)return [];r.updated_at=new Date();if(editing){[r.name,r.instructions,r.enabled,r.model_code,r.model_revision,r.catalog_version]=v;r.input_fields=JSON.parse(v[6]);r.output_format=v[7];r.output_fields=JSON.parse(v[8]);r.revision++;}else r.deleted_at=new Date();return [r];}
      assert.fail('Unexpected query '+q);
    },auditLog:{async create({data}){if(fault)throw new Error('Synthetic SQL audit fault');state.audits.push(data);return data;}}
  };
  const prisma={async $transaction(fn){let release;const prev=tail;tail=new Promise(r=>{release=r;});await prev;const before=structuredClone(state);try{return await fn(tx);}catch(e){state=before;throw e;}finally{release();}}};
  const plugins={async projectId(t){assert.equal(t,tx);return 'project';},async assertEnabledInTransaction(t){assert.equal(t,tx);calls.push({text:'lifecycle'});}};
  const config={async current(t){assert.equal(t,tx);return catalog;}};
  return {service:new AiPersonalAgentsService(prisma,new WorkspaceContextService(prisma),plugins,config),state:()=>state,calls,skills,catalog,deny:()=>{deny=true;},off:()=>{plugin=false;},fault:()=>{fault=true;}};
}

test('DTO rejects privilege/tool fields, unsupported formats, duplicates, malformed refs and bounds',()=>{
  assert.equal(dto.createPersonalAgentDto(initial).enabled,false);assert.equal(dto.createPersonalAgentDto({...initial,modelCode:'text--model-'}).modelCode,'text--model-');
  for(const key of ['ownerId','workspaceId','memberId','projectId','credentialRef','baseUrl','tools','published','script','run','skillCodes'])assert.throws(()=>dto.createPersonalAgentDto({...initial,[key]:'forged'}),status(400));
  for(const patch of [{name:'x'.repeat(101)},{name:' x '},{code:'x'},{code:'A-b'},{instructions:'x'.repeat(8001)},{instructions:'\0'},{enabled:'true'},{modelRevision:0},{catalogVersion:2147483648},{inputFields:[]},{inputFields:['constructor']},{inputFields:['x','x']},{outputFormat:'tool'},{outputFields:[]},{skillBindings:[{skillId:'skill-a',revision:1,versionId:'foreign'}]},{skillBindings:[{skillId:'skill-a',revision:0}]},{skillBindings:Array(9).fill({skillId:'skill-a',revision:1})},{skillBindings:[{skillId:'skill-a',revision:1},{skillId:'skill-a',revision:2}]}])assert.throws(()=>dto.createPersonalAgentDto({...initial,...patch}),status(400));
  assert.equal(dto.createPersonalAgentDto({...initial,code:'a'.repeat(63),name:'n'.repeat(100),instructions:'中'.repeat(8000),inputFields:['a'.repeat(48)]}).name.length,100);
  for(const q of [{limit:'51'},{limit:['2']},{limit:'01'},{afterId:'../id'},{ownerId:'forged'}])assert.throws(()=>dto.personalAgentPage(q),status(400));
  assert.equal(dto.personalAgentPage({limit:'50'}).limit,50);assert.throws(()=>dto.personalAgentVersionPage({beforeRevision:'0'}),status(400));
  assert.throws(()=>dto.updatePersonalAgentDto(edit({expectedRevision:'1'})),status(400));
});
test('safe model options projection, enabled TEXT only, no catalog/provider secrets',async()=>{
  const f=fixture(),options=await f.service.modelOptions('member','space',{});assert.deepEqual(options,{catalogVersion:1,items:[{code:'text-model',name:'Text',revision:1,capability:'text'}]});
  f.catalog.catalog.providers[0].enabled=false;assert.deepEqual((await f.service.modelOptions('member','space',{})).items,[]);
  assert.throws(()=>f.service.modelOptions('member','space',{keys:true}),status(400));assert.equal(f.state().audits.length,0);
});
test('create/replay binds exact immutable IDs in caller order; lifecycle/membership/quota/catalog precede writes',async()=>{
  const f=fixture(),a=await f.service.create('member','space',initial,'correlation-159');assert.equal(a.enabled,false);
  assert.deepEqual(a.skillBindings,[{skillId:'skill-b',skillVersionId:'skill-b-v1',revision:1},{skillId:'skill-a',skillVersionId:'skill-a-v1',revision:1}]);
  assert.deepEqual(await f.service.create('member','space',initial),a);assert.equal(f.state().assets.length,1);assert.equal(f.state().versions.length,1);assert.equal(f.state().bindings.length,2);assert.equal(f.state().versions[0].skill_binding_count,2);assert.equal(f.state().audits.length,1);
  for(const patch of [{instructions:'changed'},{skillBindings:[...initial.skillBindings].reverse()},{enabled:true}])await assert.rejects(f.service.create('member','space',{...initial,...patch}),status(409));
  const texts=f.calls.map(c=>c.text),index=fragment=>texts.findIndex(q=>q.includes(fragment));
  assert.ok(index('lifecycle')<index('FROM public.client_workspace_membership'));assert.ok(index('FROM public.client_workspace_membership')<index('INSERT INTO public.ai_personal_agent '));
  const locks=f.calls.filter(c=>c.text.startsWith('SELECT pg_advisory')).map(c=>c.v[0]);assert.match(locks[0],/^aij-client-workspace-membership:/);assert.match(locks[1],/^ai-personal-agents:/);
  assert.deepEqual(f.calls.filter(c=>c.text.includes('FROM public.ai_personal_skill s')).slice(0,2).map(c=>c.v[0]),['skill-a','skill-b']);
  assert.deepEqual(f.state().audits[0].requestSummary,{correlationId:'correlation-159'});assert.deepEqual(Object.keys(f.state().audits[0].afterData).sort(),['action','agentId','revision']);assert.equal(JSON.stringify(f.state().audits).includes(initial.instructions),false);
});
test('CAS/no-op/bounded history keeps private Skill version pins after current Skill edit/deletion',async()=>{
  const f=fixture(),a=await f.service.create('member','space',initial);await f.service.update('member','space',a.id,edit());assert.equal(f.state().versions.length,1);
  const b=await f.service.update('member','space',a.id,edit({name:'Edited'}));assert.equal(b.revision,2);await assert.rejects(f.service.update('member','space',a.id,edit()),status(409));
  f.skills.push({...f.skills[0],id:'skill-a-v2',revision:2});f.skills[0].deleted=true;
  const history=await f.service.versions('member','space',a.id,{limit:'1'});assert.equal(history.nextCursor,2);assert.equal(history.items[0].skillBindings[1].skillVersionId,'skill-a-v1');assert.equal(history.items[0].skillBindings[1].instructions,undefined);
  assert.equal((await f.service.versions('member','space',a.id,{beforeRevision:'2'})).items[0].name,initial.name);
  assert.equal((await f.service.get('member','space',a.id)).skillBindings[1].revision,1);assert.equal((await f.service.list('member','space',{})).items[0].instructions,undefined);
  await assert.rejects(f.service.update('member','space',a.id,edit({expectedRevision:2})),status(404));
  assert.equal(f.state().versions.length,2);
});
test('private ownership, foreign/missing Skill revisions and lifecycle/permission/model disable deny writes',async()=>{
  const f=fixture(),a=await f.service.create('member','space',initial),before=JSON.stringify(f.state());
  for(const [m,w]of [['other','space'],['member','other']])for(const op of [()=>f.service.get(m,w,a.id),()=>f.service.versions(m,w,a.id,{}),()=>f.service.update(m,w,a.id,edit()),()=>f.service.delete(m,w,a.id,{expectedRevision:1})])await assert.rejects(op(),status(404));
  for(const ref of [{skillId:'foreign-skill',revision:1},{skillId:'skill-a',revision:99},{skillId:'unknown',revision:1}])await assert.rejects(f.service.create('member','space',{...initial,code:'foreign',skillBindings:[ref]}),status(404));
  for(const patch of [{modelCode:'image-model'},{modelCode:'disabled-model'},{modelRevision:2},{catalogVersion:2}])await assert.rejects(f.service.create('member','space',{...initial,...patch}),status(409));
  f.catalog.catalog.providers[0].enabled=false;await assert.rejects(f.service.create('member','space',initial),status(409));f.catalog.catalog.providers[0].enabled=true;
  assert.equal(JSON.stringify(f.state()),before);f.deny();await assert.rejects(f.service.get('member','space',a.id),status(403));await assert.rejects(f.service.create('member','space',initial),status(403));
  const g=fixture();g.off();await assert.rejects(g.service.modelOptions('member','space',{}),status(404));assert.equal(g.state().assets.length,0);
});
test('stable tombstone denies history and resurrection, atomic audit rollback for create/update/delete',async()=>{
  const f=fixture(),a=await f.service.create('member','space',initial);await assert.rejects(f.service.delete('member','space',a.id,{expectedRevision:2}),status(409));
  const result=await f.service.delete('member','space',a.id,{expectedRevision:1});assert.deepEqual(await f.service.delete('member','space',a.id,{expectedRevision:99}),result);
  for(const op of [()=>f.service.get('member','space',a.id),()=>f.service.versions('member','space',a.id,{}),()=>f.service.update('member','space',a.id,edit())])await assert.rejects(op(),status(404));await assert.rejects(f.service.create('member','space',initial),status(409));assert.equal(f.state().versions.length,1);assert.equal(f.state().bindings.length,2);
  const g=fixture();g.fault();await assert.rejects(g.service.create('member','space',initial),status(503));assert.deepEqual(g.state(),{assets:[],versions:[],bindings:[],audits:[]});
  const h=fixture(),x=await h.service.create('member','space',initial),before=JSON.stringify(h.state());h.fault();await assert.rejects(h.service.update('member','space',x.id,edit({name:'new'})),status(503));await assert.rejects(h.service.delete('member','space',x.id,{expectedRevision:1}),status(503));assert.equal(JSON.stringify(h.state()),before);
});
test('serialized offline fixture exercises simultaneous create/CAS and active quota boundary',async()=>{
  const f=fixture(),a=await Promise.all([f.service.create('member','space',initial),f.service.create('member','space',initial)]);assert.equal(a[0].id,a[1].id);
  const edits=await Promise.allSettled(['one','two'].map(name=>f.service.update('member','space',a[0].id,edit({name}))));assert.equal(edits.filter(e=>e.status==='fulfilled').length,1);assert.equal(edits.find(e=>e.status==='rejected').reason.getStatus(),409);
  for(let i=1;i<99;i++)await f.service.create('member','space',{...initial,code:'quota-'+i});
  const results=await Promise.allSettled(['last-one','last-two'].map(code=>f.service.create('member','space',{...initial,code})));assert.equal(results.filter(e=>e.status==='fulfilled').length,1);assert.equal(f.state().assets.length,100);
});
test('controller verifies context/origin/query/permissions and pre-auth no-store',()=>{
  let called=0;const spy=new Proxy({}, {get:()=> (m,w)=>{called++;assert.equal(m,'verified');assert.equal(w,'verified-space');}}),c=new AiPersonalAgentsController(spy,{getOrThrow:()=> 'http://localhost:3655'}),r={client:{id:'verified'},workspaceContext:{workspaceId:'verified-space'},headers:{origin:'http://localhost:3655','x-aij-workspace-id':'forged'}};
  c.create(r,initial,{});c.update(r,'id',edit(),{});c.delete(r,'id',{expectedRevision:1},{});c.get(r,'id',{});c.versions(r,'id',{});c.list(r,{});c.modelOptions(r,{});assert.equal(called,7);
  for(const origin of [undefined,'https://foreign.invalid'])assert.throws(()=>c.create({...r,headers:{origin}},initial,{}),status(403));assert.throws(()=>c.delete({...r,headers:{...r.headers,'sec-fetch-site':'cross-site'}},'id',{},{}),status(403));assert.throws(()=>c.create(r,initial,{ownerId:'forged'}),status(400));
  assert.ok(Reflect.getMetadata('__guards__',AiPersonalAgentsController).includes(WorkspaceContextGuard));for(const method of ['list','get','versions','modelOptions'])assert.deepEqual(Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY,c[method]),[P.aiAssetsRead]);
  for(const method of ['create','update','delete'])assert.deepEqual(Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY,c[method]),[P.aiAssetsManage]);
  let header;new PersonalAgentNoStoreGuard().canActivate({switchToHttp:()=>({getResponse:()=>({setHeader:(...v)=>{header=v;}})})});assert.deepEqual(header,['Cache-Control','private, no-store']);
});
test('SDK actual module validates narrow requests and reuses actual ClientApi cookie/workspace transport',async()=>{
  const module=loadSource('packages/sdk/src/personal-agents.ts',{}, {Object,TextEncoder,URLSearchParams}),contracts=loadSource('packages/contracts/src/index.ts');
  const requests=[];let responseStatus=200;const sdk=loadSource('packages/sdk/src/index.ts',{'@aij/contracts':contracts,'./knowledge-citations.js':loadSource('packages/sdk/src/knowledge-citations.ts'),'./personal-script-execution.js':loadSource('packages/sdk/src/personal-script-execution.ts'),'./client-binary-response.js':loadSource('packages/sdk/src/client-binary-response.ts'),'./personal-document-exports.js':loadSource('packages/sdk/src/personal-document-exports.ts',{'./client-binary-response.js':loadSource('packages/sdk/src/client-binary-response.ts')},{Object,TextEncoder,URLSearchParams}),'./personal-workflow-execution.js':loadSource('packages/sdk/src/personal-workflow-execution.ts',{}, {Object,TextEncoder,URLSearchParams}),'./external-services.js':loadSource('packages/sdk/src/external-services.ts',{}, {Object,TextEncoder,URLSearchParams}),'./knowledge-web-imports.js':loadSource('packages/sdk/src/knowledge-web-imports.ts',{}, {Object,TextEncoder,URLSearchParams}),'./personal-documents.js':loadSource('packages/sdk/src/personal-documents.ts',{}, {Object,TextEncoder,TextDecoder,URLSearchParams}),'./personal-agent-publications.js':loadSource('packages/sdk/src/personal-agent-publications.ts',{}, {Object}),'./personal-workflows.js':loadSource('packages/sdk/src/personal-workflows.ts',{}, {Object,TextEncoder,URLSearchParams}),'./personal-agent-run-previews.js':loadSource('packages/sdk/src/personal-agent-run-previews.ts'),'./personal-memories.js':loadSource('packages/sdk/src/personal-memories.ts',{}, {Object,TextEncoder,TextDecoder}),'./personal-agent-runs.js':loadSource('packages/sdk/src/personal-agent-runs.ts'),'./personal-agents.js':module,'./personal-skills.js':loadSource('packages/sdk/src/personal-skills.ts',{}, {URLSearchParams,TextEncoder}),'./ai-run-recovery.js':loadSource('packages/sdk/src/ai-run-recovery.ts')}, {Headers,FormData,AbortSignal,fetch:async(url,options)=>{requests.push({url,options});return {ok:responseStatus===200,status:responseStatus,json:async()=>({success:true,message:'ok',data:{id:'result'}})};}});
  const client=module.createPersonalAgentsClient(sdk.createClientApi(()=> 'http://fixture.invalid/api'));
  await client.create('space',initial);assert.equal(requests[0].url,'http://fixture.invalid/api/client/ai/personal-agents');assert.equal(requests[0].options.credentials,'include');assert.equal(requests[0].options.cache,'no-store');assert.equal(requests[0].options.headers.get('x-aij-workspace-id'),'space');assert.equal(JSON.parse(requests[0].options.body).enabled,false);
  await client.modelOptions('space');await client.versions('space','agent',{limit:1,beforeRevision:2});assert.match(requests.at(-1).url,/versions\?limit=1&beforeRevision=2/);await client.list('space',{limit:50});await client.update('space','agent',edit());await client.delete('space','agent',1);
  for(const op of [()=>client.create('space',{...initial,tools:[]}),()=>client.create('space',{...initial,skillBindings:[{skillId:'x',revision:0}]}),()=>client.list('space',{limit:51}),()=>client.get('space','../x')])assert.throws(op);
  responseStatus=409;await assert.rejects(client.get('space','agent'),e=>e instanceof sdk.ClientRequestFailure&&e.status===409);
});
test('SQL/schema scopes and history retention; no model execution imports or unsafe SQL',()=>{
  const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8'),sql=read('apps/api/prisma/migrations/20261105030000_ai_personal_agents/migration.sql'),schema=read('docs/execution/AF-159-schema.prisma'),source=read('apps/api/src/plugins/aij-ai/ai-personal-agents.service.ts');
  assert.equal((sql.match(/CREATE UNIQUE INDEX "ai_personal_skill/g)||[]).length,1);
  for(const fragment of ['FOREIGN KEY ("agent_version_id","workspace_id","member_id")','FOREIGN KEY ("skill_version_id","workspace_id","member_id")','BEFORE UPDATE OR DELETE OR TRUNCATE ON "ai_personal_agent_version"','BEFORE UPDATE OR DELETE OR TRUNCATE ON "ai_personal_agent_skill_binding"','OLD.deleted_at IS NOT NULL','position BETWEEN 0 AND 7','DEFERRABLE INITIALLY DEFERRED','NEW.position>=n'])assert.ok(sql.includes(fragment));
  assert.ok(schema.includes('@@unique([id, workspaceId, memberId], map: "ai_personal_skill_version_id_scope_key")'));assert.equal(source.includes('RawUnsafe'),false);assert.equal((source.match(/\$transaction\(/g)||[]).length,1);assert.equal(/ai-center-(run|provider)|ai-execution|async-runtime/.test(source),false);
});

test('all currently supported enabled text vendor choices can be saved, including Aliyun',async()=>{
  for(const vendor of ['openai','deepseek','aliyun','compatible']){
    const f=fixture();f.catalog.catalog.providers[0].vendor=vendor;
    const choice=await f.service.modelOptions('member','space',{});assert.equal(choice.items[0].code,initial.modelCode);
    const saved=await f.service.create('member','space',initial);assert.equal(saved.modelCode,choice.items[0].code);
  }
});
