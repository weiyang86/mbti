import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root='/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation';assert.equal(resolve(process.cwd()),root);
const git=f=>resolve(execFileSync('git',['rev-parse',f],{encoding:'utf8'}).trim());assert.equal(git('--git-dir'),git('--git-common-dir'));assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'dev');
const folder=join(root,'.artifacts/auto-ai-program-20261105/AF-170');mkdirSync(folder,{recursive:true});const owned=mkdtempSync(join(folder,'packed-')),packs=join(owned,'packs'),consumer=join(owned,'consumer');mkdirSync(packs);mkdirSync(consumer);execFileSync('git',['check-ignore','--quiet',owned]);
const dependencies={};
for(const name of ['contracts','sdk']){const before=new Set(readdirSync(packs));execFileSync('pnpm',['pack','--pack-destination',packs],{cwd:join(root,'packages',name),stdio:'pipe'});const made=readdirSync(packs).filter(f=>f.endsWith('.tgz')&&!f.startsWith('._')&&!before.has(f));assert.equal(made.length,1);const manifest=JSON.parse(execFileSync('tar',['-xOf',join(packs,made[0]),'package/package.json'],{encoding:'utf8'}));assert.equal(manifest.name,'@aij/'+name);assert.equal(manifest.private,true);assert.deepEqual(manifest.files,['dist']);if(name==='sdk')assert.equal(manifest.dependencies['@aij/contracts'],'0.1.0');dependencies['@aij/'+name]='file:../packs/'+made[0];}
writeFileSync(join(consumer,'package.json'),JSON.stringify({name:'aij-af170-packed-http-consumer',version:'0.0.0',private:true,type:'module',dependencies,pnpm:{overrides:{'@aij/contracts':dependencies['@aij/contracts']}}},null,2)+'\n');
execFileSync('pnpm',['--dir',consumer,'install','--offline','--ignore-workspace','--ignore-scripts','--lockfile=false','--store-dir',join(owned,'store')],{cwd:root,stdio:'pipe',timeout:120000});assert.ok(realpathSync(join(consumer,'node_modules/@aij/sdk')).startsWith(consumer+'/node_modules/'));
writeFileSync(join(folder,'packed-consumer.json'),JSON.stringify({task:'AF-170',consumer,dependencies,network:'offline',scripts:false},null,2)+'\n');
const esmTypes=`import {createPersonalWorkflowsClient,validatePersonalWorkflowDraft,type WorkflowGraph,type PersonalWorkflow} from '@aij/sdk';
const graph:WorkflowGraph={schemaVersion:1,inputKeys:[],nodes:[{id:'s',type:'start'},{id:'e',type:'end'}],edges:[{from:'s',port:'next',to:'e',input:'in'}]};
const client=createPersonalWorkflowsClient(async<T,>()=>({} as T));const saved:Promise<PersonalWorkflow>=client.create('space',{code:'wf-draft',name:'Draft',graph});void saved;validatePersonalWorkflowDraft(graph);
// @ts-expect-error no publishing in draft API
client.create('space',{code:'wf-draft',name:'Draft',graph,published:true});`;
const cjsTypes=`import sdk=require('@aij/sdk');const client=sdk.createPersonalWorkflowsClient(async<T,>()=>({} as T));const page:Promise<sdk.PersonalWorkflowPage<sdk.PersonalWorkflowSummary>>=client.list('space',{limit:1});void page;
// @ts-expect-error exact revision is numeric
client.delete('space','workflow','1');`;
writeFileSync(join(consumer,'af170-consumer.mts'),esmTypes);writeFileSync(join(consumer,'af170-consumer.cts'),cjsTypes);
process.env.AIJ_AF170_PACKED_CONSUMER=consumer;process.env.AIJ_AF170_ROOT_LIVE='1';
await import('./personal-workflows-live.test.mjs');
