import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import ts from 'typescript';
const require=createRequire(new URL('../../apps/api/package.json',import.meta.url));
require('ts-node').register({project:resolve('apps/api/tsconfig.json'),transpileOnly:true});require('reflect-metadata');
const {validateWorkflowGraph,parseWorkflowJson}=require('../../apps/api/src/plugins/aij-ai/ai-personal-workflows-graph.ts');
const dto=require('../../apps/api/src/plugins/aij-ai/ai-personal-workflows.dto.ts');
const {AiPersonalWorkflowsService}=require('../../apps/api/src/plugins/aij-ai/ai-personal-workflows.service.ts');
const {AiPersonalWorkflowsController,PersonalWorkflowNoStoreGuard,personalWorkflowPrivateMiddleware,personalWorkflowJsonVerify}=require('../../apps/api/src/plugins/aij-ai/ai-personal-workflows.controller.ts');
const {WorkspaceContextService}=require('../../apps/api/src/client-workspaces/workspace-context.service.ts');
const {WorkspaceContextGuard}=require('../../apps/api/src/client-workspaces/workspace-context.guard.ts');
const P=require('../../apps/api/src/client-workspaces/client-workspace-permissions.ts').CLIENT_WORKSPACE_PERMISSION;
const {CLIENT_WORKSPACE_PERMISSIONS_KEY}=require('../../apps/api/src/client-workspaces/client-workspace-permission.decorator.ts');
const status=n=>e=>e.getStatus?.()===n;
export const edge=(from,to,port='next',input='in')=>({from,port,to,input});
export function nestedGraph(){return {schemaVersion:1,inputKeys:['question'],nodes:[
  {id:'start',type:'start'}, {id:'condition',type:'condition',predicate:{key:'question',op:'eq',valueType:'string',value:'yes'},joinId:'conditionJoin'},
  {id:'parallel',type:'parallel',branches:['left','right'],joinId:'parallelJoin'},
  {id:'agent',type:'agent',agentId:'agent-a',revision:1},
  {id:'loop',type:'loop',maxIterations:20,body:{nodes:[{id:'bodyStart',type:'start'},{id:'approval',type:'human-approval',label:'Private label sentinel'},{id:'bodyEnd',type:'end'}],edges:[edge('bodyStart','approval'),edge('approval','bodyEnd')]}},
  {id:'parallelJoin',type:'join',forkId:'parallel'}, {id:'conditionJoin',type:'join',forkId:'condition'},{id:'end',type:'end'}],
  edges:[edge('start','condition'),edge('condition','parallel','true'),edge('condition','conditionJoin','false','false'),edge('parallel','agent','left'),edge('parallel','loop','right'),edge('agent','parallelJoin','next','left'),edge('loop','parallelJoin','next','right'),edge('parallelJoin','conditionJoin','next','true'),edge('conditionJoin','end')]};}
const initial=()=>({code:'private-workflow',name:'Private workflow name sentinel',graph:nestedGraph()});
const edit=(extra={})=>({name:initial().name,graph:nestedGraph(),expectedRevision:1,...extra});
const clone=structuredClone;

// A query driver exercises the ACTUAL service and transaction callback; it is not PG proof.
function fixture(){
  let state={assets:[],versions:[],bindings:[],audits:[]},tail=Promise.resolve(),deny=false,plugin=true,fault=false;
  const calls=[],agents=[{id:'agent-a',workspace:'space',member:'member',deleted:false,enabled:false}],versions=[{id:'agent-a-v1',agent_id:'agent-a',revision:1,workspace:'space',member:'member'}];
  const sql=(parts,v)=>{assert.ok(Array.isArray(parts.raw));const text=parts.join('?').replace(/\s+/g,' ').trim();assert.ok(!text.includes(initial().name));calls.push({text,v});return text;};
  const tx={
    async $executeRaw(parts,...v){const q=sql(parts,v);
      if(q.startsWith('SELECT pg_advisory'))return 1;
      if(q.startsWith('INSERT INTO public.ai_personal_workflow_version')){const [id,workflow_id,workspace_id,member_id,code,name,graph,graph_digest,content_digest,revision,created_at,agent_binding_count]=v;state.versions.push({id,workflow_id,workspace_id,member_id,code,name,graph:JSON.parse(graph),graph_digest,content_digest,revision,created_at,agent_binding_count});return 1;}
      if(q.startsWith('INSERT INTO public.ai_personal_workflow_agent_binding')){const [id,workflow_version_id,workspace_id,member_id,node_id,agent_version_id]=v;state.bindings.push({id,workflow_version_id,workspace_id,member_id,node_id,agent_version_id});return 1;}
      assert.fail('Unexpected execute '+q);
    },
    async $queryRaw(parts,...v){const q=sql(parts,v);
      if(q.includes('FROM public.project_profile'))return [{id:'project'}];
      if(q.includes('FROM public.plugin_installation'))return plugin?[{id:'plugin'}]:[];
      if(q.includes('FROM public.client_workspace_membership')){assert.ok(q.includes('FOR SHARE OF u, w, m, r, g, p'));assert.ok([P.aiAssetsRead,P.aiAssetsManage].includes(v[2]));return deny?[]:[{id:'membership'}];}
      if(q.includes('FROM public.ai_personal_agent_version WHERE'))return versions.filter(r=>r.agent_id===v[0]&&r.workspace===v[1]&&r.member===v[2]&&r.revision===v[3]);
      if(q.includes('FROM public.ai_personal_agent WHERE')){assert.ok(q.includes('FOR SHARE'));return agents.filter(a=>a.id===v[0]&&a.workspace===v[1]&&a.member===v[2]&&!a.deleted);}
      if(q.includes('FROM public.ai_personal_workflow_agent_binding b'))return state.bindings.filter(b=>b.workflow_version_id===v[0]&&b.workspace_id===v[1]&&b.member_id===v[2]).map(b=>({...b,...versions.find(r=>r.id===b.agent_version_id)}));
      if(q.includes('FROM public.ai_personal_workflow_version')){let rows=state.versions.filter(r=>r.workflow_id===v[0]&&r.workspace_id===v[1]&&r.member_id===v[2]);return q.includes('revision <')?rows.filter(r=>r.revision<v[3]).sort((a,b)=>b.revision-a.revision).slice(0,v[4]):rows.filter(r=>r.revision===v[3]);}
      if(q.startsWith('INSERT INTO public.ai_personal_workflow ')){const [id,workspace_id,member_id,code,name,graph,graph_digest,content_digest,initial_digest]=v,now=new Date();const row={id,workspace_id,member_id,code,name,graph:JSON.parse(graph),graph_digest,content_digest,initial_digest,revision:1,created_at:now,updated_at:now,deleted_at:null};state.assets.push(row);return [row];}
      if(q.startsWith('SELECT count'))return [{count:BigInt(state.assets.filter(r=>r.workspace_id===v[0]&&r.member_id===v[1]&&!r.deleted_at).length)}];
      if(q.startsWith('SELECT * FROM public.ai_personal_workflow WHERE id='))return state.assets.filter(r=>r.id===v[0]&&r.workspace_id===v[1]&&r.member_id===v[2]);
      if(q.includes('FROM public.ai_personal_workflow WHERE workspace_id=')){let rows=state.assets.filter(r=>r.workspace_id===v[0]&&r.member_id===v[1]);return q.includes('code=')?rows.filter(r=>r.code===v[2]):rows.filter(r=>!r.deleted_at&&r.id>v[2]).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,v[3]);}
      if(q.startsWith('UPDATE public.ai_personal_workflow')){const editing=q.includes('SET name='),o=editing?4:0;const row=state.assets.find(r=>r.id===v[o]&&r.workspace_id===v[o+1]&&r.member_id===v[o+2]&&r.revision===v[o+3]&&!r.deleted_at);if(!row)return [];row.updated_at=new Date();if(editing){[row.name,,row.graph_digest,row.content_digest]=v;row.graph=JSON.parse(v[1]);row.revision++;}else row.deleted_at=new Date();return [row];}
      assert.fail('Unexpected query '+q);
    },auditLog:{async create({data}){if(fault)throw new Error('Private fault sentinel');state.audits.push(data);return data;}}
  };
  const prisma={async $transaction(fn){let release;const previous=tail;tail=new Promise(r=>{release=r;});await previous;const before=clone(state);try{return clone(await fn(tx));}catch(e){state=before;throw e;}finally{release();}}};
  const plugins={async projectId(t){assert.equal(t,tx);return 'project';},async assertEnabledInTransaction(t){assert.equal(t,tx);calls.push({text:'lifecycle'});}};
  return {service:new AiPersonalWorkflowsService(prisma,new WorkspaceContextService(prisma),plugins),state:()=>state,calls,agents,versions,deny:()=>{deny=true;},off:()=>{plugin=false;},fault:()=>{fault=true;}};
}

test('actual validator canonicalizes nested condition/parallel/loop/approval/disabled Agent reference deterministically',()=>{
  const g=nestedGraph(),v=validateWorkflowGraph(g);assert.equal(v.nodeCount,11);assert.equal(v.edgeCount,11);assert.equal(v.status,'DRAFT');assert.equal(v.structuralValidity,'VALID');
  assert.deepEqual(v.agentRefs,[{nodeId:'agent',agentId:'agent-a',revision:1}]);
  g.nodes.reverse();g.edges.reverse();g.nodes.find(n=>n.type==='parallel').branches.reverse();assert.equal(validateWorkflowGraph(g).canonical,v.canonical);assert.equal(validateWorkflowGraph(g).digest,v.digest);
  const before=clone(v.graph);g.nodes[0].label='caller mutation';assert.deepEqual(v.graph,before);
  const changed=clone(v.graph);changed.nodes.find(n=>n.id==='condition').predicate.value='no';assert.notEqual(validateWorkflowGraph(changed).digest,v.digest);
});
test('actual validator refuses malformed topology, branch crossing, unbounded loops and all unsafe schema extensions',()=>{
  const patches=[
    g=>g.nodes.push({...g.nodes[0]}),g=>g.nodes.push({id:'island',type:'human-approval'}),g=>g.edges.push({...g.edges[0]}),
    g=>g.edges[0].to='missing',g=>g.edges[0].input='evil',g=>g.edges[1].port='maybe',g=>g.edges[2].to='end',
    g=>g.edges[0].to='end',g=>g.edges.push(edge('end','start')),g=>g.nodes.find(n=>n.id==='parallelJoin').forkId='condition',
    g=>g.nodes.find(n=>n.id==='parallel').branches=['left','left'],g=>g.nodes.find(n=>n.id==='loop').maxIterations=21,
    g=>g.nodes.find(n=>n.id==='loop').maxIterations=0,g=>g.nodes.find(n=>n.id==='loop').body.edges.push(edge('bodyEnd','bodyStart')),
    g=>g.nodes.find(n=>n.id==='agent').type='script',g=>g.nodes.find(n=>n.id==='agent').agentVersionId='trusted',
    g=>g.nodes.find(n=>n.id==='condition').predicate.key='undeclared',g=>g.nodes.find(n=>n.id==='condition').predicate.valueType='number',
    g=>g.nodes.find(n=>n.id==='condition').predicate.expression='x()',g=>g.nodes.find(n=>n.id==='condition').predicate.value=Infinity,
    g=>g.nodes.find(n=>n.id==='condition').predicate.value='x'.repeat(201),g=>g.inputKeys=['constructor'],g=>g.inputKeys=['x','x'],
    g=>g.inputKeys=Array.from({length:21},(_,i)=>'x'+i),g=>g.nodes.find(n=>n.id==='loop').body.nodes[0].id='start',
    g=>g.nodes[0].id='__proto__',g=>g.nodes[0].label='x'.repeat(101),g=>g.schemaVersion=2,
    g=>{g.edges.find(e=>e.from==='agent').input='right';g.edges.find(e=>e.from==='loop').input='left';},
    g=>{g.nodes.find(n=>n.id==='condition').predicate={key:'question',op:'exists',value:true};},
    g=>g.nodes[0].url='https://tool.invalid',g=>g.nodes[0].label='\0',g=>g.nodes[0].label='\ud800',
    g=>Object.setPrototypeOf(g.nodes[0],{inherited:true}),g=>Object.defineProperty(g.nodes[0],'label',{get(){throw new Error('must not invoke');},enumerable:true}),
    g=>g.nodes[0][Symbol('hidden')]=true,g=>g.nodes[0].unknown=undefined,
    g=>g.edges.push(...Array(129).fill(edge('start','end'))),g=>g.nodes.push(...Array(65).fill({id:'x',type:'end'}))
  ];
  for(const patch of patches){const g=nestedGraph();patch(g);assert.throws(()=>validateWorkflowGraph(g),undefined,patch.toString());}
  for(const corrupt of [g=>{g.nodes.length++;},g=>{g.nodes[0]=null;},g=>{g.nodes[0]=Object.create(null);},g=>{g.inputKeys[Symbol('x')]='hidden';}]){const g=nestedGraph();corrupt(g);assert.throws(()=>validateWorkflowGraph(g));}
  const valid=nestedGraph();valid.nodes.find(n=>n.id==='condition').predicate={key:'question',op:'exists'};assert.equal(validateWorkflowGraph(valid).structuralValidity,'VALID');
});
test('global node/edge/depth bounds include loop bodies, safe labels allow Chinese and emoji',()=>{
  const max={schemaVersion:1,inputKeys:[],nodes:[{id:'s',type:'start'},...Array.from({length:62},(_,i)=>({id:'n'+i,type:'human-approval',label:'界'.repeat(100)})),{id:'e',type:'end'}],edges:[]};
  max.edges=max.nodes.slice(1).map((n,i)=>edge(max.nodes[i].id,n.id));assert.equal(validateWorkflowGraph(max).nodeCount,64);max.nodes.splice(1,0,{id:'extra',type:'human-approval'});assert.throws(()=>validateWorkflowGraph(max));
  const g={schemaVersion:1,inputKeys:[],nodes:[{id:'s',type:'start'},{id:'e',type:'end'}],edges:[edge('s','e')]};
  for(let i=0;i<3;i++){const old=clone({nodes:g.nodes,edges:g.edges});g.nodes=[{id:'s'+i,type:'start'},{id:'l'+i,type:'loop',maxIterations:1,body:old},{id:'e'+i,type:'end'}];g.edges=[edge('s'+i,'l'+i),edge('l'+i,'e'+i)];}
  g.nodes[0].label='中文😀';assert.equal(validateWorkflowGraph(g).nodeCount,11);
  const old=clone({nodes:g.nodes,edges:g.edges});g.nodes=[{id:'outerS',type:'start'},{id:'outerL',type:'loop',maxIterations:1,body:old},{id:'outerE',type:'end'}];g.edges=[edge('outerS','outerL'),edge('outerL','outerE')];assert.throws(()=>validateWorkflowGraph(g));
});
test('strict JSON duplicate/escaped/prototype keys and strict DTO/cursors reject before persistence',()=>{
  assert.deepEqual(parseWorkflowJson('{"a":[1,true,null,"x"]}'),{a:[1,true,null,'x']});
  for(const raw of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"nested":{"x":1,"x":2}}','{"__proto__":{}}','{"a":NaN}','{"a":1,}','[1,]','{} {}','"bad\nstring"','x'.repeat(98305)])assert.throws(()=>parseWorkflowJson(raw));
  assert.equal(dto.createPersonalWorkflowDto(initial()).status,'DRAFT');
  for(const key of ['memberId','workspaceId','published','enabled','run','agentBindings','versionId'])assert.throws(()=>dto.createPersonalWorkflowDto({...initial(),[key]:true}),status(400));
  for(const raw of [{limit:'21'},{limit:['1']},{afterId:'../x'},{limit:'01'},{ownerId:'x'}])assert.throws(()=>dto.personalWorkflowPage(raw),status(400));
  assert.equal(dto.personalWorkflowPage({limit:'20'}).limit,20);assert.throws(()=>dto.personalWorkflowPage({afterId:'x'},true),status(400));
  assert.throws(()=>dto.updatePersonalWorkflowDto(edit({expectedRevision:'1'})),status(400));assert.throws(()=>dto.deletePersonalWorkflowDto({expectedRevision:1,extra:true}),status(400));
});
test('actual service persists current+version+audit, ordered own Agent pins, noop/CAS and exact initial replay returns current',async()=>{
  const f=fixture(),first=await f.service.create('member','space',initial(),'af170-correlation');
  assert.deepEqual(first.agentBindings,[{nodeId:'agent',agentId:'agent-a',revision:1,agentVersionId:'agent-a-v1'}]);
  assert.equal(first.status,'DRAFT');assert.equal(f.state().versions.length,1);assert.equal(f.state().audits.length,1);
  const noOp=await f.service.update('member','space',first.id,edit());assert.equal(noOp.revision,1);assert.equal(f.state().audits.length,1);
  const updated=await f.service.update('member','space',first.id,edit({name:'Changed'}));assert.equal(updated.revision,2);
  const replay=await f.service.create('member','space',initial());assert.equal(replay.revision,2);assert.equal(replay.name,'Changed');
  await assert.rejects(f.service.update('member','space',first.id,edit()),status(409));await assert.rejects(f.service.create('member','space',{...initial(),name:'Other'}),status(409));
  assert.equal((await f.service.getVersion('member','space',first.id,'1')).name,initial().name);
  const page=await f.service.versions('member','space',first.id,{limit:'1'});assert.equal(page.nextCursor,2);assert.equal(page.items[0].graph,undefined);
  assert.equal((await f.service.list('member','space',{})).items[0].graph,undefined);
  assert.equal((await f.service.versions('member','space',first.id,{beforeRevision:'2'})).items[0].revision,1);
  assert.equal(f.state().assets.length,1);assert.equal(f.state().versions.length,2);assert.equal(f.state().bindings.length,2);assert.equal(f.state().audits.length,2);
  assert.deepEqual(Object.keys(f.state().audits[0].afterData).sort(),['action','revision','workflowId']);assert.ok(!JSON.stringify(f.state().audits).includes('sentinel'));
  const q=f.calls.map(c=>c.text);assert.ok(q.indexOf('lifecycle')<q.findIndex(q=>q.includes('FROM public.client_workspace_membership')));assert.ok(q.some(q=>q.includes('FOR SHARE OF p,o')));
  f.agents[0].deleted=true;assert.equal((await f.service.get('member','space',first.id)).agentBindings[0].agentVersionId,'agent-a-v1');await assert.rejects(f.service.update('member','space',first.id,edit({expectedRevision:2})),status(404));
  await f.service.delete('member','space',first.id,{expectedRevision:2});await assert.rejects(f.service.get('member','space',first.id),status(404));await assert.rejects(f.service.create('member','space',initial()),status(409));
  await assert.rejects(f.service.delete('member','space',first.id,{expectedRevision:1}),status(409));assert.equal((await f.service.delete('member','space',first.id,{expectedRevision:2})).deleted,true);
});
test('actual service refuses foreign owner/space/ref, lifecycle/permission and rolls back atomic audit failure',async()=>{
  const f=fixture(),a=await f.service.create('member','space',initial());
  for(const [m,w]of [['other','space'],['member','other']])for(const op of [()=>f.service.get(m,w,a.id),()=>f.service.getVersion(m,w,a.id,'1'),()=>f.service.versions(m,w,a.id,{}),()=>f.service.update(m,w,a.id,edit()),()=>f.service.delete(m,w,a.id,{expectedRevision:1})])await assert.rejects(op(),status(404));
  for(const patch of [{agentId:'foreign'},{revision:99}]){const g=nestedGraph();Object.assign(g.nodes.find(n=>n.type==='agent'),patch);await assert.rejects(f.service.create('member','space',{...initial(),code:'other',graph:g}),status(404));}
  const broken=fixture();broken.fault();await assert.rejects(broken.service.create('member','space',initial()),status(503));assert.deepEqual(broken.state(),{assets:[],versions:[],bindings:[],audits:[]});
  const denied=fixture();denied.deny();await assert.rejects(denied.service.create('member','space',initial()),status(403));assert.equal(denied.state().assets.length,0);
  const off=fixture();off.off();await assert.rejects(off.service.list('member','space',{}),status(404));
});
test('actual service quota and concurrent CAS are serialized by transaction; Agent lock order sorted',async()=>{
  const f=fixture(),a=await f.service.create('member','space',initial());
  const results=await Promise.allSettled(['a','b'].map(name=>f.service.update('member','space',a.id,edit({name}))));assert.deepEqual(results.map(r=>r.status).sort(),['fulfilled','rejected']);
  const last=clone(f.state().assets[0]);for(let i=1;i<100;i++)f.state().assets.push({...last,id:'quota-'+i,code:'quota-'+i});await assert.rejects(f.service.create('member','space',{...initial(),code:'over-limit'}),status(409));
  const locks=fixture();locks.agents.push({...locks.agents[0],id:'agent-b'});locks.versions.push({...locks.versions[0],id:'agent-b-v1',agent_id:'agent-b'});
  const g=nestedGraph();const body=g.nodes.find(n=>n.type==='loop').body;body.nodes.find(n=>n.type==='human-approval').type='agent';Object.assign(body.nodes.find(n=>n.id==='approval'),{agentId:'agent-b',revision:1});await locks.service.create('member','space',{...initial(),graph:g});
  assert.deepEqual(locks.calls.filter(c=>c.text.includes('FROM public.ai_personal_agent WHERE')).map(c=>c.v[0]),['agent-a','agent-b']);
});
test('controller actually guards every read/write, rejects Origin and emits private no-store before malformed JSON',async()=>{
  const c=AiPersonalWorkflowsController.prototype;
  assert.deepEqual(Reflect.getMetadata('__guards__',AiPersonalWorkflowsController),[PersonalWorkflowNoStoreGuard,WorkspaceContextGuard]);
  for(const method of ['list','get','versions','getVersion'])assert.deepEqual(Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY,c[method]),[P.aiAssetsRead]);
  for(const method of ['create','update','delete'])assert.deepEqual(Reflect.getMetadata(CLIENT_WORKSPACE_PERMISSIONS_KEY,c[method]),[P.aiAssetsManage]);
  const calls=[],controller=new AiPersonalWorkflowsController(new Proxy({},{get:(_,method)=>(...args)=>{calls.push({method,args});return 'ok';}}),{getOrThrow:()=> 'https://web.test'});
  const req={client:{id:'member'},workspaceContext:{workspaceId:'space'},headers:{origin:'https://web.test'},correlationId:'corr'};
  assert.equal(controller.create(req,initial(),{}),'ok');assert.equal(calls[0].args[0],'member');assert.equal(calls[0].args[1],'space');
  assert.throws(()=>controller.create({...req,headers:{origin:'https://evil.test'}},initial(),{}),status(403));assert.throws(()=>controller.create({...req,headers:{origin:'https://web.test','sec-fetch-site':'cross-site'}},initial(),{}),status(403));assert.throws(()=>controller.get(req,'id',{full:'1'}),status(400));assert.throws(()=>controller.list(req,{}, {graph:'hidden'}),status(400));
  const headers={};const response={setHeader:(k,v)=>headers[k]=v};personalWorkflowPrivateMiddleware({url:'/api/client/ai/personal-workflows'},response,()=>{});assert.equal(headers['Cache-Control'],'private, no-store');
  assert.throws(()=>personalWorkflowJsonVerify({url:'/api/client/ai/personal-workflows'},response,Buffer.from('{"a":1,"a":2}')),status(400));assert.throws(()=>personalWorkflowJsonVerify({url:'/api/client/ai/personal-workflows'},response,Buffer.alloc(98305)),status(413));
});
test('actual SDK source compiles strict declarations and callable ESM/CJS with same canonical graph and transport paths',async()=>{
  const file=resolve('packages/sdk/src/personal-workflows.ts'),out=resolve('.artifacts/af170-sdk');mkdirSync(out,{recursive:true});
  const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,skipLibCheck:true,declaration:true,emitDeclarationOnly:true,outDir:out,rootDir:resolve('packages/sdk/src'),types:[],lib:['lib.es2022.d.ts','lib.dom.d.ts']};
  const program=ts.createProgram([file],options),diags=[...ts.getPreEmitDiagnostics(program),...program.emit().diagnostics].filter(d=>d.category===ts.DiagnosticCategory.Error);assert.equal(diags.length,0,ts.formatDiagnosticsWithColorAndContext(diags,{getCurrentDirectory:()=>process.cwd(),getCanonicalFileName:x=>x,getNewLine:()=> '\n'}));
  const source=readFileSync(file,'utf8');for(const [module,ext]of [[ts.ModuleKind.ES2022,'mjs'],[ts.ModuleKind.CommonJS,'cjs']])writeFileSync(resolve(out,'personal-workflows.'+ext),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module,strict:true}}).outputText);
  for(const sdk of [await import(pathToFileURL(resolve(out,'personal-workflows.mjs'))),require(resolve(out,'personal-workflows.cjs'))]){
    assert.equal(sdk.validatePersonalWorkflowDraft(nestedGraph()).canonical,validateWorkflowGraph(nestedGraph()).canonical);
    for(const mutation of [g=>g.edges.push(g.edges[0]),g=>g.nodes[0].script='eval',g=>g.inputKeys=['constructor'],g=>g.nodes.find(n=>n.type==='parallel').branches=['left','left']]){const graph=nestedGraph();mutation(graph);assert.throws(()=>sdk.validatePersonalWorkflowDraft(graph));}
    const calls=[],client=sdk.createPersonalWorkflowsClient(async(path,options)=>{calls.push({path,options});return {status:'DRAFT'};});
    await client.create('space',initial());assert.deepEqual(JSON.parse(calls[0].options.body).graph,validateWorkflowGraph(nestedGraph()).graph);assert.equal(calls[0].options.workspaceId,'space');
    await client.list('space',{limit:20,afterId:'last'});assert.equal(calls.at(-1).path,'/client/ai/personal-workflows?limit=20&afterId=last');await client.get('space','workflow');await client.update('space','workflow',edit());await client.versions('space','workflow',{beforeRevision:2});await client.getVersion('space','workflow',1);await client.delete('space','workflow',2);
    assert.equal(calls.at(-1).options.method,'DELETE');assert.throws(()=>client.list('space',{limit:21}));assert.throws(()=>client.create('space',{...initial(),tools:[]}));assert.throws(()=>client.getVersion('space','workflow',0));
  }
});

test('owned ephemeral loopback JSON fixture rejects duplicate keys and real oversized payload with private no-store',async()=>{
  // No Nest/application/DB startup: only this synthetic HTTP parser fixture, always closed.
  const express=require('express'),parser=express.json({limit:98304,verify:personalWorkflowJsonVerify});
  const server=createServer((req,res)=>personalWorkflowPrivateMiddleware(req,res,()=>parser(req,res,error=>{
    res.setHeader('content-type','application/json');res.statusCode=error?.status??200;res.end(JSON.stringify({status:res.statusCode}));
  })));
  try{
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/api/client/ai/personal-workflows';
    for(const [body,expected]of [[JSON.stringify(initial()),200],['{"a":1,"a":2}',400],['{"a":1,"\\u0061":2}',400],['{"x":"'+'x'.repeat(100000)+'"}',413]]){
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',connection:'close'},body,signal:AbortSignal.timeout(3000)});assert.equal(response.status,expected);assert.equal(response.headers.get('cache-control'),'private, no-store');await response.arrayBuffer();
    }
    const upper=await fetch(url.replace('/api/client/ai/personal-workflows','/API/CLIENT/AI/PERSONAL-WORKFLOWS'),{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:'{"x":1,"x":2}'});assert.equal(upper.status,400);assert.equal(upper.headers.get('cache-control'),'private, no-store');await upper.arrayBuffer();
  }finally{await new Promise(r=>server.close(r));}
});
