// Offline actual-source tests. Explicit in-memory SQL/permission fixture; never DB or HTTP evidence.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../apps/api/package.json',import.meta.url));
require('ts-node').register({project:fileURLToPath(new URL('../../apps/api/tsconfig.json',import.meta.url)),transpileOnly:true});
require('reflect-metadata');
const dto=require('../../apps/api/src/plugins/aij-ai/ai-personal-memories.dto.ts');
const {AiPersonalMemoriesService}=require('../../apps/api/src/plugins/aij-ai/ai-personal-memories.service.ts');
const {AiPersonalMemoriesController,PersonalMemoryNoStoreGuard,personalMemoryNoStore}=require('../../apps/api/src/plugins/aij-ai/ai-personal-memories.controller.ts');
const {WorkspaceContextService}=require('../../apps/api/src/client-workspaces/workspace-context.service.ts');
const {PluginRuntimeAccessService}=require('../../apps/api/src/plugin-runtime/plugin-runtime-access.service.ts');
const {CLIENT_WORKSPACE_PERMISSION:P}=require('../../apps/api/src/client-workspaces/client-workspace-permissions.ts');
const status=n=>e=>e.getStatus?.()===n;
const input=(more={})=>({code:'explicit-preference',title:'Private title sentinel',content:'Private memory text sentinel',kind:'preference',...more});
const edit=(more={})=>{const b=input(more);delete b.code;return {...b,expectedRevision:more.expectedRevision??1};};
function fixture() {
  const f={state:{memories:[],grants:[],audits:[]},queries:[],active:true,project:true,plugin:true,auditFault:false,agents:[{id:'agent-a',member:'member',space:'space',deleted:false,enabled:false},{id:'agent-b',member:'member',space:'space',deleted:false,enabled:true},{id:'foreign',member:'other',space:'space',deleted:false},{id:'other-space',member:'member',space:'other',deleted:false},{id:'tombstone',member:'member',space:'space',deleted:true}]};
  let queue=Promise.resolve();
  const copy=r=>structuredClone(r);
  const query=async(strings,...v)=>{
    const q=strings.join('?').replace(/\s+/g,' ').trim();f.queries.push({q,v});
    assert.ok(!q.includes('sentinel'),'SQL must bind submitted content');
    if(q.includes('FROM public.project_profile'))return f.project?[{id:'project'}]:[];
    if(q.includes('FROM public.plugin_installation'))return f.plugin?[{id:'plugin'}]:[];
    if(q.includes('FROM public.client_workspace_membership'))return f.active?[{id:'membership'}]:[];
    if(q.includes('FROM public.ai_personal_agent '))return copy(f.agents.filter(a=>a.id===v[0]&&a.space===v[1]&&a.member===v[2]&&!a.deleted));
    if(q.startsWith('SELECT agent_id'))return f.state.grants.filter(g=>g.memory_id===v[0]&&g.workspace_id===v[1]&&g.member_id===v[2]).map(g=>({agent_id:g.agent_id})).sort((a,b)=>a.agent_id.localeCompare(b.agent_id));
    if(q.startsWith('SELECT count(*)'))return [{count:BigInt(f.state.memories.filter(r=>r.workspace_id===v[0]&&r.member_id===v[1]&&!r.deleted_at).length)}];
    if(q.startsWith('SELECT * FROM public.ai_personal_memory'))return copy(f.state.memories.filter(r=>q.includes('code=?')?r.workspace_id===v[0]&&r.member_id===v[1]&&r.code===v[2]:r.id===v[0]&&r.workspace_id===v[1]&&r.member_id===v[2]));
    if(q.startsWith('SELECT id,code,title'))return copy(f.state.memories.filter(r=>r.workspace_id===v[0]&&r.member_id===v[1]&&!r.deleted_at&&r.id>v[2]).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,v[3]));
    if(q.startsWith('INSERT INTO public.ai_personal_memory ')){
      const [id,workspace_id,member_id,code,title,content,kind,enabled,initial_digest]=v,now=new Date();
      const row={id,workspace_id,member_id,code,title,content,kind,enabled,initial_digest,revision:1,created_at:now,updated_at:now,deleted_at:null};f.state.memories.push(row);return copy([row]);
    }
    if(q.startsWith('UPDATE public.ai_personal_memory SET title=NULL')){
      const [id,w,m,revision]=v,r=f.state.memories.find(r=>r.id===id&&r.workspace_id===w&&r.member_id===m&&r.revision===revision&&!r.deleted_at);
      if(!r)return [];Object.assign(r,{title:null,content:null,kind:null,enabled:null,initial_digest:null,deleted_at:new Date(),updated_at:new Date(),revision:r.revision+1});return copy([r]);
    }
    if(q.startsWith('UPDATE public.ai_personal_memory SET title=')){
      const [title,content,kind,enabled,id,w,m,revision]=v,r=f.state.memories.find(r=>r.id===id&&r.workspace_id===w&&r.member_id===m&&r.revision===revision&&!r.deleted_at);
      if(!r)return [];Object.assign(r,{title,content,kind,enabled,revision:r.revision+1,updated_at:new Date()});return copy([r]);
    }
    throw new Error('Unhandled offline SQL: '+q);
  };
  const tx={projectProfile:{findFirst:async()=>f.project?{id:'project'}:null},pluginInstallation:{findUnique:async()=>({status:f.plugin?'enabled':'disabled'})},$queryRaw:query,
    $executeRaw:async(strings,...v)=>{
      const q=strings.join('?').replace(/\s+/g,' ').trim();f.queries.push({q,v});
      if(q.startsWith('SELECT pg_advisory_xact_lock'))return 1;
      if(q.startsWith('DELETE FROM public.ai_personal_memory_agent_grant')){f.state.grants=f.state.grants.filter(g=>!(g.memory_id===v[0]&&g.workspace_id===v[1]&&g.member_id===v[2]));return 1;}
      if(q.startsWith('INSERT INTO public.ai_personal_memory_agent_grant')){const [id,memory_id,workspace_id,member_id,agent_id]=v;f.state.grants.push({id,memory_id,workspace_id,member_id,agent_id});return 1;}
      throw new Error('Unhandled offline execute: '+q);
    },auditLog:{create:async({data})=>{if(f.auditFault)throw new Error(input().content);f.state.audits.push(copy(data));return data;}}};
  const prisma={$transaction:async op=>{const prior=queue;let release;queue=new Promise(r=>{release=r;});await prior;const snapshot=copy(f.state);try{return await op(tx);}catch(e){f.state=snapshot;throw e;}finally{release();}}};
  const plugins=new PluginRuntimeAccessService(prisma,{getOrThrow:k=>({projectId:'aij-foundation',environment:'test'})[k]});
  f.service=new AiPersonalMemoriesService(prisma,new WorkspaceContextService(prisma),plugins);return f;
}

test('DTO bounds, defaults, canonical grants, body/query forgery and enum validation',()=>{
  assert.deepEqual(dto.createPersonalMemoryDto(input()).agentIds,[]);assert.equal(dto.createPersonalMemoryDto(input()).enabled,false);
  assert.deepEqual(dto.createPersonalMemoryDto(input({agentIds:['b','a']})).agentIds,['a','b']);
  for(const kind of ['preference','confirmed_fact','task_summary'])assert.equal(dto.createPersonalMemoryDto(input({kind})).kind,kind);
  for(const field of ['memberId','userId','workspaceId','source','system','global','secret','tools','script','inferred','restore'])assert.throws(()=>dto.createPersonalMemoryDto(input({[field]:'forged'})),status(400));
  for(const b of [{enabled:'true'},{enabled:undefined},{agentIds:undefined},{agentIds:new Array(1)},{agentIds:['a','a']},{agentIds:Array.from({length:17},(_,i)=>'a'+i)},{kind:'fact'},{title:'x'.repeat(101)},{content:'x'.repeat(4001)},{content:'  '},{title:'\0'},{content:'\ud800'},{content:[]},{code:'UPPER'},{code:'a'.repeat(64)}])assert.throws(()=>dto.createPersonalMemoryDto(input(b)),status(400));
  assert.equal(dto.createPersonalMemoryDto(input({content:'字'.repeat(4000),title:'字'.repeat(100)})).content.length,4000);
  assert.throws(()=>dto.updatePersonalMemoryDto({...edit(),code:'immutable'}),status(400));
  for(const v of [0,-1,1.5,2147483648,'1'])assert.throws(()=>dto.deletePersonalMemoryDto({expectedRevision:v}),status(400));
  assert.deepEqual(dto.personalMemoryPage({limit:'50',afterId:'abc'}),{limit:50,afterId:'abc'});
  for(const q of [{limit:'51'},{limit:['2']},{limit:2},{limit:'01'},{afterId:'../'},{userId:'other'},{content:'text'}])assert.throws(()=>dto.personalMemoryPage(q),status(400));
});
test('actual source create/replay/CAS/noop/list/atomic revocation/erasure without plaintext history',async()=>{
  const f=fixture(),s=f.service,original=input({enabled:true,agentIds:['agent-b','agent-a']});
  const created=await s.create('member','space',original);assert.equal(created.revision,1);assert.equal(created.enabled,true);
  assert.deepEqual(created.agentIds,['agent-a','agent-b']);assert.equal(f.state.audits.length,1);
  assert.deepEqual(await s.create('member','space',original),created);assert.equal(f.state.audits.length,1);
  await assert.rejects(s.create('member','space',{...original,content:'different'}),status(409));
  const noop=await s.update('member','space',created.id,edit({enabled:true,agentIds:['agent-a','agent-b']}));assert.equal(noop.revision,1);assert.equal(f.state.audits.length,1);
  const changed=await s.update('member','space',created.id,edit({title:'New private title',content:'New body sentinel'}));assert.equal(changed.revision,2);assert.deepEqual(changed.agentIds,[]);assert.equal(changed.enabled,false);assert.equal(f.state.grants.length,0);
  assert.deepEqual(await s.create('member','space',original),changed,'initial replay returns current content without restoring grants');
  await assert.rejects(s.update('member','space',created.id,edit()),status(409));
  const list=await s.list('member','space',{});assert.equal(Object.hasOwn(list.items[0],'content'),false);assert.equal(Object.hasOwn(list.items[0],'agentIds'),false);assert.equal(list.nextCursor,null);
  assert.ok(f.queries.some(q=>q.q.startsWith('SELECT id,code,title')&&!q.q.includes('content')));
  for(const audit of f.state.audits){const json=JSON.stringify(audit);for(const secret of [original.title,original.content,'New private title','New body sentinel','agent-a','explicit-preference'])assert.equal(json.includes(secret),false);assert.equal(audit.requestSummary,undefined);}
  const gone=await s.delete('member','space',created.id,{expectedRevision:2});assert.deepEqual(gone,{id:created.id,revision:3,deleted:true});
  assert.deepEqual(await s.delete('member','space',created.id,{expectedRevision:1}),gone);
  assert.deepEqual(f.state.grants,[]);const row=f.state.memories[0];for(const key of ['title','content','kind','enabled','initial_digest'])assert.equal(row[key],null);
  assert.equal(JSON.stringify(f.state).includes('sentinel'),false);
  await assert.rejects(s.create('member','space',original),status(409));await assert.rejects(s.get('member','space',created.id),status(404));
});
test('owner isolation, inactive Agent refs, lifecycle and membership refusal leave no durable delta',async()=>{
  const f=fixture(),s=f.service,r=await s.create('member','space',input());
  const unchanged=async op=>{const before=structuredClone(f.state);await op();assert.deepEqual(f.state,before);};
  for(const [m,w]of [['other','space'],['member','other']]){
    assert.deepEqual((await s.list(m,w,{})).items,[]);
    for(const op of [()=>s.get(m,w,r.id),()=>s.update(m,w,r.id,edit()),()=>s.delete(m,w,r.id,{expectedRevision:1})])await unchanged(()=>assert.rejects(op(),status(404)));
  }
  for(const agent of ['foreign','other-space','tombstone','missing'])await unchanged(()=>assert.rejects(s.create('member','space',input({code:'bad-'+agent,agentIds:[agent]})),status(404)));
  for(const [flag,code]of [['active',403],['project',503],['plugin',404]]){f[flag]=false;try{await unchanged(()=>assert.rejects(s.get('member','space',r.id),status(code)));}finally{f[flag]=true;}}
  const sequence=f.queries.map(q=>q.q);assert.ok(sequence.findIndex(q=>q.includes('plugin-lifecycle')||q.includes('pg_advisory_xact_lock(hashtext('))<sequence.findIndex(q=>q.includes('client_workspace_membership')));
  assert.ok(sequence.some(q=>q.includes('FOR SHARE OF u, w, m, r, g, p')));assert.ok(f.queries.some(q=>q.v.includes('aij-client-workspace-membership:space')));
});
test('audit fault rolls back body, grants and deletion; safe error excludes fault content',async()=>{
  const f=fixture(),s=f.service,r=await s.create('member','space',input({agentIds:['agent-a']}));f.auditFault=true;
  for(const op of [()=>s.create('member','space',input({code:'audit-fault'})),()=>s.update('member','space',r.id,edit({content:'Changed sentinel',agentIds:['agent-b']})),()=>s.delete('member','space',r.id,{expectedRevision:1})]){
    const before=structuredClone(f.state);await assert.rejects(op(),e=>e.getStatus?.()===503&&!JSON.stringify(e.getResponse()).includes('sentinel'));assert.deepEqual(f.state,before);
  }
});
test('serialized fixture final quota and CAS races; this is NOT PostgreSQL lock proof',async()=>{
  const f=fixture(),s=f.service,r=await s.create('member','space',input());
  const race=await Promise.allSettled(['A','B'].map(title=>s.update('member','space',r.id,edit({title}))));assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected').reason.getStatus(),409);
  for(let i=1;i<199;i++)await s.create('member','space',input({code:'quota-'+i}));
  const last=await Promise.allSettled(['a','b'].map(x=>s.create('member','space',input({code:'quota-last-'+x}))));assert.equal(last.filter(r=>r.status==='fulfilled').length,1);assert.equal(last.find(r=>r.status==='rejected').reason.getStatus(),409);
  assert.equal(f.state.memories.filter(r=>!r.deleted_at).length,200);
});
test('actual controller permission metadata, no-store guard and Origin/context/query rejection',()=>{
  const headers={},guard=new PersonalMemoryNoStoreGuard();assert.equal(guard.canActivate({switchToHttp:()=>({getResponse:()=>({setHeader:(k,v)=>{headers[k]=v;}})})}),true);assert.match(headers['Cache-Control'],/no-store/);
  let advanced=false;personalMemoryNoStore({}, {setHeader:(k,v)=>{headers[k]=v;}}, ()=>{advanced=true;});assert.equal(advanced,true);assert.match(headers['Cache-Control'],/no-store/);
  const calls=[],service=Object.fromEntries(['create','get','list','update','delete'].map(k=>[k,(...args)=>calls.push([k,...args])]));
  const c=new AiPersonalMemoriesController(service,{getOrThrow:()=> 'http://127.0.0.1:3655'}),request={client:{id:'member'},workspaceContext:{workspaceId:'space'},headers:{origin:'http://127.0.0.1:3655'}};
  const {CLIENT_WORKSPACE_PERMISSIONS_KEY:key}=require('../../apps/api/src/client-workspaces/client-workspace-permission.decorator.ts');
  for(const method of ['create','update','delete','get','list'])assert.deepEqual(Reflect.getMetadata(key,c[method]),[method==='get'||method==='list'?P.aiAssetsRead:P.aiAssetsManage]);
  for(const bad of [{},{...request,headers:{}},{...request,headers:{origin:'https://evil.test'}},{...request,headers:{...request.headers,'sec-fetch-site':'cross-site'}}])assert.throws(()=>c.create(bad,input(),{}),status(403));
  assert.throws(()=>c.get(request,'id',{memberId:'other'}),status(400));c.create(request,input(),{});assert.equal(calls[0][1],'member');assert.equal(calls[0][2],'space');
});
test('actual SDK factory uses existing ClientApi and enforces input before transport',async()=>{
  const ts=require('typescript'),source=readFileSync(new URL('../../packages/sdk/src/personal-memories.ts',import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  const {createPersonalMemoriesClient}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  const calls=[],client=createPersonalMemoriesClient(async(path,options)=>{calls.push({path,options});return {id:'memory',revision:1};});
  await client.create('space',input({agentIds:['agent-b','agent-a']}));assert.equal(calls[0].path,'/client/ai/personal-memories');assert.equal(calls[0].options.workspaceId,'space');assert.deepEqual(JSON.parse(calls[0].options.body).agentIds,['agent-a','agent-b']);
  await client.list('space',{limit:50,afterId:'cursor'});assert.match(calls[1].path,/limit=50&afterId=cursor$/);
  await client.get('space','memory');await client.update('space','memory',edit());await client.delete('space','memory',1);
  assert.equal(calls[3].options.method,'PATCH');assert.equal(calls[4].options.method,'DELETE');
  await client.create('space',input({content:'\uFEFFexplicit memory'}));
  const before=calls.length;for(const op of [()=>client.create('space',input({enabled:'true'})),()=>client.create('space',input({userId:'forged'})),()=>client.get('space','../id'),()=>client.list('space',{limit:51}),()=>client.update('space','id',{...edit(),code:'immutable'}),()=>client.delete('space','id',0)])assert.throws(op,TypeError);assert.equal(calls.length,before);
  const failing=createPersonalMemoriesClient(async()=>{throw new Error('transport failure');});await assert.rejects(failing.get('space','id'),/transport failure/);
});
test('additive SQL/schema structure covers two scoped models, tombstones and erasure constraints',()=>{
  const sql=readFileSync(new URL('../../apps/api/prisma/migrations/20261105040000_ai_personal_memories/migration.sql',import.meta.url),'utf8'),schema=readFileSync(new URL('../../docs/execution/AF-163-schema.prisma',import.meta.url),'utf8');
  assert.equal((sql.match(/CREATE TABLE /g)||[]).length,2);assert.equal((schema.match(/^model /gm)||[]).length,2);
  for(const required of ['ai_personal_memory_owner_code_key','ai_personal_memory_id_scope_key','ai_personal_memory_grant_agent_scope_fkey','ai_personal_memory_grant_memory_scope_fkey','ai_personal_memory_content_check','ai_personal_memory_erasure_guard','DEFERRABLE INITIALLY DEFERRED','FOR SHARE','>=16','>=200','OLD.deleted_at IS NOT NULL','NEW.revision <> OLD.revision+1'])assert.ok(sql.includes(required),required);
  assert.doesNotMatch(sql,/CREATE TABLE.*(?:version|history|secret|job|trace)/i);
});
