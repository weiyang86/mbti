// Offline actual source/DTO/SDK/state tests; SQL fixture is NOT PostgreSQL evidence.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
const require=createRequire(new URL('../../apps/api/package.json',import.meta.url));
require('ts-node').register({project:fileURLToPath(new URL('../../apps/api/tsconfig.json',import.meta.url)),transpileOnly:true,
  compilerOptions:{jsx:'react-jsx'},moduleTypes:{'**/packages/sdk/src/**':'cjs'}});
require('reflect-metadata');
const dto=require('../../apps/api/src/documents/personal-documents.dto.ts');
const {PersonalDocumentsService,DOCUMENT_PERMISSION:P}=require('../../apps/api/src/documents/personal-documents.service.ts');
const {PersonalDocumentsController,PersonalDocumentNoStoreGuard,personalDocumentNoStore}=require('../../apps/api/src/documents/personal-documents.controller.ts');
const {WorkspaceContextService}=require('../../apps/api/src/client-workspaces/workspace-context.service.ts');
const {PluginRuntimeAccessService}=require('../../apps/api/src/plugin-runtime/plugin-runtime-access.service.ts');
const {createPersonalDocumentsClient}=require('../../packages/sdk/src/personal-documents.ts');
const {createDocumentManagerStore}=require('../../apps/web/app/components/client-document-manager.tsx');
const {createDocumentAccess}=require('../../apps/web/app/components/client-document-access.ts');
const {personalDocumentJsonVerify}=require('../../apps/api/src/documents/personal-documents.controller.ts');
const id='12345678-1234-4234-8234-123456789abc';
const other='12345678-1234-4234-8234-123456789abd';
const status=n=>e=>e.getStatus?.()===n;
const input=(extra={})=>({code:'private-note',name:'私有文档 sentinel',body:'正文 sentinel\r\n\tUnicode🙂',...extra});
const edit=(extra={})=>({expectedRevision:1,name:input().name,body:input().body,...extra});
test('root wire parser rejects duplicate escaped/prototype keys and malformed UTF8 before data is lost',()=>{
  for(const raw of ['{"body":"a","body":"b"}','{"body":"a","bo\\u0064y":"b"}','{"__proto__":{}}','{','['])assert.throws(()=>personalDocumentJsonVerify(Buffer.from(raw)),status(400));
  assert.throws(()=>personalDocumentJsonVerify(Buffer.from([0x7b,0x22,0xc0,0xaf,0x22,0x3a,0x31,0x7d])),status(400));
  personalDocumentJsonVerify(Buffer.from(JSON.stringify(input({body:'\t'.repeat(65536)}))));
});
test('real public SDK transport fence refuses late role/session/space replies and preflight denial without releasing private data',async()=>{
  const scope={workspaceId:'space',memberId:'member',roleId:'owner',sessionKey:'session',validationKey:'owner',permissions:['workspace.documents.read','workspace.documents.manage']};
  const head={id:'12345678-1234-4234-8234-123456789abc',code:'private-note',name:'Private',body:'PRIVATE_LATE_BODY',revision:1,createdAt:'2026-11-06T00:00:00.000Z',updatedAt:'2026-11-06T00:00:00.000Z'};
  for(const changed of [{...scope,roleId:'reader'},{...scope,sessionKey:'newsession'},{...scope,workspaceId:'elsewhere'}]){
    let calls=0,verifications=0,denied=0;const access=createDocumentAccess(async()=>{calls++;return head;});access.setScope(scope);
    access.setHandlers(async()=>++verifications===1?scope:changed,()=>{denied++;access.clear();});
    await assert.rejects(access.api.get('space',head.id),e=>e.status===403);assert.equal(calls,1);assert.equal(denied,1);assert.equal(access.getScope(),null);
  }
  let calls=0;const access=createDocumentAccess(async()=>{calls++;return head;});access.setScope(scope);access.setHandlers(async()=>{throw{status:403};},()=>access.clear());
  await assert.rejects(access.api.get('space',head.id),e=>e.status===403);assert.equal(calls,0);
});
test('transport unknown mutation has one actual request; explicit generation fence blocks even same-scope late result',async()=>{
  const scope={workspaceId:'space',memberId:'member',roleId:'owner',sessionKey:'session',validationKey:'owner',permissions:['workspace.documents.read','workspace.documents.manage']};
  let calls=0,checks=0,access;access=createDocumentAccess(async()=>{calls++;throw{status:503};});access.setScope(scope);access.setHandlers(async()=>{checks++;return scope;},()=>{});
  await assert.rejects(access.api.create('space',input()),e=>e.status===503);assert.equal(calls,1);assert.equal(checks,2);
  access=createDocumentAccess(async()=>{access.clear();access.setScope(scope);return{};});access.setScope(scope);access.setHandlers(async()=>scope,()=>{});
  await assert.rejects(access.api.get('space','12345678-1234-4234-8234-123456789abc'),e=>e.status===403);
});
test('post-commit access loss stays unknown; suspended identity retains only reconciliation metadata until verified',async()=>{
  const scope={workspaceId:'space',memberId:'member',roleId:'owner',sessionKey:'session',validationKey:'owner',permissions:['workspace.documents.read','workspace.documents.manage']};
  let checks=0,calls=0;const access=createDocumentAccess(async()=>{calls++;return{};});access.setScope(scope);access.setHandlers(async()=>++checks===1?scope:{...scope,roleId:'reader'},()=>access.clear());
  await assert.rejects(access.api.create('space',input()),e=>e.status===503);assert.equal(calls,1);
  let release;const pending=new Promise(resolve=>{release=resolve;});const store=createDocumentManagerStore({create:()=>pending});store.setScope(scope);store.create();store.draft('code','private-note');store.draft('name','Private');store.draft('body','PRIVATE_DRAFT');const save=store.save();
  store.setScope(null);assert.equal(store.getSnapshot().body,'');assert.equal(store.getSnapshot().recovery.kind,'create');
  store.setScope({...scope,roleId:'reader',permissions:['workspace.documents.read']});release({});await save;
  assert.equal(store.getSnapshot().body,'');assert.equal(store.getSnapshot().recovery.checked,false);
  store.setScope({...scope,sessionKey:'different-session'});assert.equal(store.getSnapshot().recovery,null);
});
function fixture(){
  const f={state:{heads:[],versions:[],audits:[]},queries:[],active:true,project:true,plugin:true,readonly:false,auditFault:false};
  const copy=r=>structuredClone(r);let queue=Promise.resolve();
  const query=async(strings,...v)=>{
    const q=strings.join('?').replace(/\s+/g,' ').trim();f.queries.push({q,v});assert.equal(q.includes('sentinel'),false);
    if(q.includes('FROM public.project_profile'))return f.project?[{id:'project'}]:[];
    if(q.includes('FROM public.plugin_installation'))return f.plugin?[{id:'plugin'}]:[];
    if(q.includes('FROM public.client_workspace_membership'))return f.active&&!(f.readonly&&v[2]===P.manage)?[{id:'membership'}]:[];
    if(q.startsWith('SELECT count(*)'))return [{count:BigInt(f.state.heads.filter(r=>r.workspace_id===v[0]&&r.member_id===v[1]&&!r.deleted_at).length)}];
    if(q.startsWith('SELECT * FROM public.personal_document '))return copy(f.state.heads.filter(r=>q.includes('code=?')?r.workspace_id===v[0]&&r.member_id===v[1]&&r.code===v[2]:r.id===v[0]&&r.workspace_id===v[1]&&r.member_id===v[2]));
    if(q.startsWith('SELECT id FROM public.personal_document '))return copy(f.state.heads.filter(r=>r.id===v[0]&&r.workspace_id===v[1]&&r.member_id===v[2]&&!r.deleted_at).map(r=>({id:r.id})));
    if(q.startsWith('SELECT id,code,name'))return copy(f.state.heads.filter(r=>r.workspace_id===v[0]&&r.member_id===v[1]&&!r.deleted_at&&r.id>v[2]).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,v[3]));
    if(q.startsWith('INSERT INTO public.personal_document ')){const [id,workspace_id,member_id,code,name,body]=v,now=new Date();const r={id,workspace_id,member_id,code,name,body,revision:1,created_at:now,updated_at:now,deleted_at:null};f.state.heads.push(r);return copy([r]);}
    if(q.startsWith('UPDATE public.personal_document ')){
      const deleting=q.includes('SET deleted_at='),[name,body]=v,[doc,w,m,revision]=deleting?v:v.slice(2);const r=f.state.heads.find(r=>r.id===doc&&r.workspace_id===w&&r.member_id===m&&r.revision===revision&&!r.deleted_at);if(!r)return [];
      if(deleting)r.deleted_at=new Date();else Object.assign(r,{name,body,revision:r.revision+1});r.updated_at=new Date();return copy([r]);
    }
    if(q.includes('FROM public.personal_document_version')){
      const rows=f.state.versions.filter(r=>r.document_id===v[0]&&r.workspace_id===v[1]&&r.member_id===v[2]);
      if(q.startsWith('SELECT name,body'))return copy(rows.filter(r=>r.revision===1));
      if(q.includes('revision <'))return copy(rows.filter(r=>r.revision<v[3]).sort((a,b)=>b.revision-a.revision).slice(0,v[4]));
      return copy(rows.filter(r=>r.revision===v[3]));
    }
    throw new Error('Unhandled SQL '+q);
  };
  const tx={projectProfile:{findFirst:async()=>f.project?{id:'project'}:null},pluginInstallation:{findUnique:async()=>({status:f.plugin?'enabled':'disabled'})},$queryRaw:query,
    $executeRaw:async(strings,...v)=>{const q=strings.join('?').replace(/\s+/g,' ').trim();f.queries.push({q,v});if(q.startsWith('SELECT pg_advisory_xact_lock'))return 1;
      if(q.startsWith('INSERT INTO public.personal_document_version ')){const [id,document_id,workspace_id,member_id,revision,name,body,created_at]=v;f.state.versions.push({id,document_id,workspace_id,member_id,revision,name,body,created_at});return 1;}throw new Error('Unhandled execute '+q);},
    auditLog:{create:async({data})=>{if(f.auditFault)throw new Error(input().body);f.state.audits.push(copy(data));return data;}}};
  const prisma={$transaction:async op=>{const prior=queue;let release;queue=new Promise(r=>{release=r;});await prior;const before=copy(f.state);try{return await op(tx);}catch(e){f.state=before;throw e;}finally{release();}}};
  f.service=new PersonalDocumentsService(prisma,new WorkspaceContextService(prisma),new PluginRuntimeAccessService(prisma,{getOrThrow:k=>({projectId:'aij-foundation',environment:'test'})[k]}));return f;
}
test('strict DTO validates exact text, UTF8 boundary, names, UUIDs, cursors, byte/control/prototype/ref forgery',()=>{
  assert.deepEqual(dto.createDocumentDto(input()),input());for(const body of ['', '\r\n\t🙂中文', '\uFEFFtext', 'a'.repeat(65536),'🙂'.repeat(16384)])assert.equal(dto.createDocumentDto(input({body})).body,body);
  for(const body of ['a'.repeat(65537),'🙂'.repeat(16385),'x\0y','\u0001','\u000B','\u007F','\u0085','\uD800','\uDC00'])assert.throws(()=>dto.createDocumentDto(input({body})),status(400));
  for(const name of ['', ' ', ' name','name ', '\tname','\u200B','n\n', 'x'.repeat(161),'\uD800'])assert.throws(()=>dto.createDocumentDto(input({name})),status(400));
  assert.equal(dto.createDocumentDto(input({name:'🙂'.repeat(160)})).name.length,320);
  for(const code of ['a','A-long','-bad','bad-','bad--code','a'.repeat(64)])assert.throws(()=>dto.createDocumentDto(input({code})),status(400));
  for(const key of ['memberId','workspaceId','projectId','organizationId','source','versions','restore','__proto__','constructor'])assert.throws(()=>dto.createDocumentDto({...input(),[key]:'forged'}),status(400));
  for(const raw of [[],null,Object.create({}),{...input(),body:{}},Object.defineProperty(input(),'name',{get(){throw Error('getter ran');}}),Object.assign(input(),{[Symbol('x')]:true})])assert.throws(()=>dto.createDocumentDto(raw));
  for(const raw of [{limit:'0'},{limit:'51'},{limit:['2']},{afterId:'not-uuid'},{body:'bad'}])assert.throws(()=>dto.documentPage(raw),status(400));
  for(const raw of [{beforeRevision:'0'},{beforeRevision:'201'},{beforeRevision:'01'},{afterId:id}])assert.throws(()=>dto.documentPage(raw,true),status(400));
  for(const rev of [0,201,1.5,'1',null])assert.throws(()=>dto.deleteDocumentDto({expectedRevision:rev}),status(400));
  for(const key of ['memberId','body','name'])assert.throws(()=>dto.deleteDocumentDto({expectedRevision:1,[key]:'x'}),status(400));
  assert.equal(dto.documentId(id.toUpperCase()),id);assert.throws(()=>dto.documentId('00000000-0000-0000-0000-000000000000'),status(400));
});
test('actual service save/replay/noop/metadata/history/softdelete and bounded history, audit excludes all private text',async()=>{
  const f=fixture(),s=f.service;const made=await s.create('member','space',input());assert.equal(made.revision,1);assert.equal(f.state.versions.length,1);
  assert.deepEqual(await s.create('member','space',input()),made);assert.deepEqual(await s.update('member','space',made.id,edit()),made);assert.equal(f.state.audits.length,1);
  const changed=await s.update('member','space',made.id,edit({body:'second body sentinel'}));assert.equal(changed.revision,2);assert.equal(f.state.versions.length,2);
  assert.deepEqual(await s.create('member','space',input()),changed);await assert.rejects(s.create('member','space',input({body:'different'})),status(409));
  await assert.rejects(s.update('member','space',made.id,edit()),status(409));
  const p=await s.list('member','space',{limit:'1'});assert.equal(Object.hasOwn(p.items[0],'body'),false);
  const h=await s.versions('member','space',made.id,{limit:'1'});assert.equal(h.items[0].revision,2);assert.equal(h.nextCursor,2);assert.equal(Object.hasOwn(h.items[0],'body'),false);
  assert.equal((await s.versions('member','space',made.id,{beforeRevision:'2'})).items[0].revision,1);assert.equal((await s.getVersion('member','space',made.id,'1')).body,input().body);
  const summaryQueries=f.queries.filter(({q})=>q.startsWith('SELECT id,code')||q.startsWith('SELECT document_id,revision,name,created_at'));assert.equal(summaryQueries.length,3);for(const {q}of summaryQueries)assert.equal(q.includes('body'),false);
  for(const audit of f.state.audits){for(const secret of [input().name,input().body,input().code,'second body sentinel'])assert.equal(JSON.stringify(audit).includes(secret),false);assert.deepEqual(Object.keys(audit.afterData).sort(),['action','revision']);}
  const before=structuredClone(f.state.versions);assert.deepEqual(await s.delete('member','space',made.id,{expectedRevision:2}),{id:made.id,revision:2,deleted:true});assert.deepEqual(f.state.versions,before);
  for(const op of [()=>s.get('member','space',made.id),()=>s.versions('member','space',made.id,{}),()=>s.getVersion('member','space',made.id,'1'),()=>s.delete('member','space',made.id,{expectedRevision:2})])await assert.rejects(op(),status(404));
  await assert.rejects(s.create('member','space',input()),status(409));
});
test('owner/member/workspace/lifecycle/readonly refusal, audit rollback, lock order, CAS and quota fixture races',async()=>{
  const f=fixture(),s=f.service,r=await s.create('member','space',input());
  for(const [m,w]of [['other','space'],['member','other']]){assert.deepEqual((await s.list(m,w,{})).items,[]);for(const op of [()=>s.get(m,w,r.id),()=>s.update(m,w,r.id,edit()),()=>s.delete(m,w,r.id,{expectedRevision:1}),()=>s.versions(m,w,r.id,{}),()=>s.getVersion(m,w,r.id,'1')])await assert.rejects(op(),status(404));}
  for(const [flag,code]of [['active',403],['project',503],['plugin',404],['readonly',403]]){const before=structuredClone(f.state);f[flag]=!f[flag];await assert.rejects(s.update('member','space',r.id,edit({body:'denied'})),status(code));assert.deepEqual(f.state,before);f[flag]=!f[flag];}
  f.auditFault=true;const before=structuredClone(f.state);await assert.rejects(s.update('member','space',r.id,edit({body:'rollback'})),e=>status(503)(e)&&!e.message.includes('sentinel'));assert.deepEqual(f.state,before);f.auditFault=false;
  const cas=await Promise.allSettled(['first','second'].map(body=>s.update('member','space',r.id,edit({body}))));assert.equal(cas.filter(r=>r.status==='fulfilled').length,1);assert.equal(cas.find(r=>r.status==='rejected').reason.getStatus(),409);assert.equal(f.state.versions.length,2);
  const lockQueries=f.queries.map(q=>q.q);const membership=lockQueries.findIndex(q=>q.includes('FROM public.client_workspace_membership')),quota=lockQueries.findIndex((q,i)=>i>membership&&q.includes('pg_advisory_xact_lock')),owned=lockQueries.findIndex(q=>q.startsWith('SELECT * FROM public.personal_document'));assert.ok(membership<quota&&quota<owned);
  f.state.heads[0].revision=200;const atCap=structuredClone(f.state);assert.equal((await s.update('member','space',r.id,{expectedRevision:200,name:f.state.heads[0].name,body:f.state.heads[0].body})).revision,200);await assert.rejects(s.update('member','space',r.id,{expectedRevision:200,name:'new',body:''}),status(409));assert.deepEqual(f.state,atCap);
  for(let i=1;i<99;i++)f.state.heads.push({...f.state.heads[0],id:other,code:'fixture-'+i});
  const race=await Promise.allSettled(['quota-a','quota-b'].map(code=>s.create('member','space',input({code}))));assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.state.heads.length,100);
});
test('controller derives identity, rejects origin/query and emits no-store before authorization',()=>{
  const headers={};personalDocumentNoStore({}, {setHeader:(k,v)=>headers[k]=v},()=>{});assert.equal(headers['Cache-Control'],'private, no-store');
  new PersonalDocumentNoStoreGuard().canActivate({switchToHttp:()=>({getResponse:()=>({setHeader:(k,v)=>headers[k]=v})})});
  const c=new PersonalDocumentsController({create:(...a)=>a},{getOrThrow:()=> 'http://localhost:3655'}),r={client:{id:'verified'},workspaceContext:{workspaceId:'verified-space'},headers:{origin:'http://localhost:3655'}};
  assert.deepEqual(c.create(r,input(),{}),['verified','verified-space',input()]);assert.throws(()=>c.create({...r,headers:{origin:'http://foreign'}},input(),{}),status(403));assert.throws(()=>c.create(r,input(),{memberId:'forged'}),status(400));assert.throws(()=>c.create({...r,client:null},input(),{}),status(403));
});
const head=(extra={})=>({id,code:'private-note',name:'Name',body:'Text',revision:1,createdAt:'2026-11-06T00:00:00.000Z',updatedAt:'2026-11-06T00:00:00.000Z',...extra});
test('SDK validates requests/responses and identity, emits one scoped no-store call, never retries unknown writes',async()=>{
  const calls=[];let response=head(),error=null;const client=createPersonalDocumentsClient(async(p,o)=>{calls.push({p,o});if(error)throw error;return response;});
  assert.deepEqual(await client.create('space',input()),head());assert.equal(calls.length,1);assert.equal(calls[0].p,'/client/documents');assert.equal(calls[0].o.workspaceId,'space');assert.equal(calls[0].o.cache,'no-store');assert.deepEqual(JSON.parse(calls[0].o.body),input());
  for(const patch of [{body:123},{body:'\uD800'},{revision:201},{id:other},{createdAt:'bad'},{updatedAt:'2026-01-01T00:00:00.000Z'},{source:'leak'}]){response=head(patch);await assert.rejects(client.get('space',id),TypeError);}
  const summary={...head()};delete summary.body;response={items:[summary],nextCursor:null};assert.equal((await client.list('space')).items.length,1);
  for(const invalid of [{items:[head()],nextCursor:null},{items:[summary,summary],nextCursor:null},{items:[summary],nextCursor:other}]){response=invalid;await assert.rejects(client.list('space'),TypeError);}
  response={items:[{documentId:id,revision:1,name:'Name',createdAt:head().createdAt}],nextCursor:null};assert.equal((await client.versions('space',id)).items.length,1);
  response={items:[{documentId:other,revision:1,name:'Name',createdAt:head().createdAt}],nextCursor:null};await assert.rejects(client.versions('space',id),TypeError);
  response={documentId:id,revision:1,name:'Name',body:'old',createdAt:head().createdAt};assert.equal((await client.getVersion('space',id,1)).body,'old');await assert.rejects(client.getVersion('space',id,2),TypeError);
  const n=calls.length;for(const op of [()=>client.create('space',input({body:'\0'})),()=>client.get('space','bad'),()=>client.list('space',{limit:51}),()=>client.update('space',id,edit({expectedRevision:0})),()=>client.delete('space',id,201)])await assert.rejects(op(),TypeError);assert.equal(calls.length,n);await assert.rejects(client.create('space',input({body:'\0'})),e=>e instanceof TypeError&&e.status===400);
  error=new Error('network');await assert.rejects(client.create('space',input()));assert.equal(calls.length,n+1);
});
const scope=(extra={})=>({workspaceId:'space',memberId:'member',sessionKey:'opaque-session',roleId:'owner',validationKey:'fresh',permissions:[P.read,P.manage],...extra});
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function stateFixture(){const calls=[];let next=head();const api=Object.fromEntries(['create','get','update','delete','list','versions','getVersion'].map(k=>[k,async(...args)=>{calls.push({k,args});return typeof next==='function'?next(k,args):next;}]));return{calls,store:createDocumentManagerStore(api),set:v=>{next=v;}};}
test('UI store preserves conflict draft and blocks unknown writes until explicit read+ack with fresh CAS',async()=>{
  const f=stateFixture(),s=f.store;s.setScope(scope());await s.open(id);s.draft('body','my draft');f.set(()=>{throw{status:400};});await s.save();assert.equal(s.getSnapshot().recovery,null);assert.equal(s.getSnapshot().body,'my draft');f.set(()=>{throw{status:409};});await s.save();assert.equal(s.getSnapshot().body,'my draft');assert.equal(s.getSnapshot().conflict,true);const n=f.calls.length;await s.save();assert.equal(f.calls.length,n);
  f.set(head({revision:2,body:'current'}));await s.open(id);assert.equal(s.getSnapshot().body,'current');s.draft('body','next');f.set(()=>{throw new Error('unknown');});await s.save();assert.equal(s.getSnapshot().recovery.kind,'update');await s.save();assert.equal(f.calls.length,n+2);
  s.acknowledge();assert.ok(s.getSnapshot().recovery);f.set(head({revision:3,body:'committed'}));await s.checkUnknown();assert.equal(s.getSnapshot().recovery.checked,true);await s.revalidate(async()=>scope());assert.equal(s.getSnapshot().recovery.checked,false,'fresh validation requires a fresh deliberate read');await s.checkUnknown();s.acknowledge();assert.equal(s.getSnapshot().recovery,null);s.draft('body','fresh');f.set(head({revision:4,body:'fresh'}));await s.save();assert.equal(f.calls.at(-1).args[2].expectedRevision,3);
});
test('UI scope/role/session/focus/hidden/unmount fences pending bodies, and interrupted writes never replay',async()=>{
  const f=stateFixture(),s=f.store;s.setScope(scope());const d=defer();f.set(()=>d.promise);const pending=s.open(id);s.setScope(scope({memberId:'other'}));d.resolve(head());await pending;assert.equal(s.getSnapshot().detail,null);assert.equal(s.getSnapshot().body,'');
  f.set(head());s.setScope(scope());await s.open(id);s.draft('body','secret');const write=defer();f.set(()=>write.promise);const p=s.save();s.conceal();assert.equal(s.getSnapshot().scope,null);assert.equal(s.getSnapshot().body,'');write.resolve(head({revision:2}));await p;assert.ok(s.getSnapshot().recovery);const count=f.calls.length;await s.revalidate(async()=>scope({validationKey:'new',roleId:'new-role'}));await s.save();assert.equal(f.calls.length,count);assert.ok(s.getSnapshot().recovery);
  const rv=defer();const validation=s.revalidate(()=>rv.promise);s.setScope(scope({sessionKey:'new-session'}));rv.resolve(scope());await validation;assert.equal(s.getSnapshot().scope.sessionKey,'new-session');assert.equal(s.getSnapshot().recovery,null);
  f.set(head());await s.open(id);s.clear();assert.equal(s.getSnapshot().detail,null);assert.equal(s.getSnapshot().body,'');assert.deepEqual(s.getSnapshot().history,[]);
});
test('UI history is deliberate and readonly, create/delete unknown reconciliation uses reads only, readonly cannot mutate',async()=>{
  const f=stateFixture(),s=f.store;s.setScope(scope({permissions:[P.read]}));await s.open(id);const n=f.calls.length;s.create();s.draft('body','forged');await s.save();await s.remove();assert.equal(f.calls.length,n);assert.equal(s.getSnapshot().body,'Text');
  f.set({items:[{documentId:id,revision:1,name:'Old',createdAt:head().createdAt}],nextCursor:null});await s.history();assert.equal(f.calls.at(-1).k,'versions');f.set({documentId:id,revision:1,name:'Old',body:'historical',createdAt:head().createdAt});await s.version(1);assert.equal(s.getSnapshot().body,'Text');assert.equal(s.getSnapshot().historical.body,'historical');
  s.setScope(scope());const oldDelete=s.deleteConfirmation();await s.open(id);const beforeOld=f.calls.length;await oldDelete();assert.equal(f.calls.length,beforeOld,'old confirmation cannot delete current selection');s.create();s.draft('code','new-code');s.draft('name','Name');s.draft('body','Draft');f.set(()=>{throw new Error('unknown');});await s.save();assert.equal(s.getSnapshot().recovery.kind,'create');f.set(k=>k==='list'?{items:[{...head(),code:'new-code'}],nextCursor:null}:head({code:'new-code'}));await s.checkUnknown();assert.deepEqual(f.calls.slice(-2).map(x=>x.k),['list','get']);s.acknowledge();
  f.set(()=>{throw new Error('unknown');});await s.remove();assert.equal(s.getSnapshot().recovery.kind,'delete');f.set(()=>{throw{status:404};});await s.checkUnknown();s.acknowledge();assert.equal(s.getSnapshot().detail,null);
});
test('source boundaries: module is real, UI type-only SDK injection, no body caching/logging/unsafe markup or provider ledger',()=>{
  const service=readFileSync(new URL('../../apps/api/src/documents/personal-documents.service.ts',import.meta.url),'utf8');for(const forbidden of ['AiKnowledgeDocument','FileAsset','console.','aiAgentRun','runtimeJob','aiExecutionTrace'])assert.equal(service.includes(forbidden),false);
  const ui=readFileSync(new URL('../../apps/web/app/components/client-document-manager.tsx',import.meta.url),'utf8');for(const forbidden of ['localStorage','sessionStorage','dangerouslySetInnerHTML','console.','window.history','URLSearchParams'])assert.equal(ui.includes(forbidden),false);assert.match(ui,/import type .*PersonalDocumentsPort/);assert.match(ui,/useLayoutEffect/);assert.match(ui,/visibilitychange/);
  // Keep verifying the original registration while allowing additional document capabilities.
  const {DocumentsModule}=require('../../apps/api/src/documents/personal-documents.module.ts');
  const {MODULE_METADATA}=require('@nestjs/common/constants');
  assert.ok(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS,DocumentsModule).includes(PersonalDocumentsController));
  assert.ok(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,DocumentsModule).includes(PersonalDocumentsService));
});
