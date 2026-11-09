import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
const require=createRequire(join(process.cwd(),'apps/api/package.json'));
const { DeepSeekProvider, DEEPSEEK_ENDPOINT }=require('../../apps/api/dist/plugins/aij-ai/deepseek-provider.js');
test('AF-117 DeepSeek adapter uses actual loopback HTTP protocol without paid requests',async t=>{
  const flags={AI_DEEPSEEK_LIVE_ENABLED:'true',AI_DEEPSEEK_UPSTREAM_CONFIRMED:'true',AI_DEEPSEEK_DATA_CLASS:'synthetic-or-deidentified'};
  const config={get:k=>flags[k]};let mode='ok',requests=0,reservations=0,settlements=0,lastBody;
  const policy={projectId:'synthetic-project',modelCode:'deepseek-flash',maxOutputTokens:2048};
  const budget={policy:()=>policy,reserve:async(_scope,id)=>{reservations++;return{id,policy};},settle:async(_id,_p,input,output)=>{assert.equal(input,40);assert.equal(output,12);settlements++;}};
  const server=createServer(async(req,res)=>{
    requests++;assert.equal(req.headers.authorization,'Bearer synthetic-secret-123456789');
    const chunks=[];for await(const c of req)chunks.push(c);lastBody=JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader('content-type','application/json');
    if(mode==='error'){res.statusCode=429;res.end('synthetic private provider error');return;}
    if(mode==='redirect'){res.writeHead(307,{location:'https://example.invalid/credential-exfiltration'});res.end();return;}
    if(mode==='slow'){setTimeout(()=>res.end('{}'),200);return;}
    if(mode==='oversize'){res.end(JSON.stringify({text:'x'.repeat(140000)}));return;}
    const output=mode==='malformed'?'bad json':JSON.stringify({answer:'Synthetic answer user@example.test'});
    res.end(JSON.stringify({model:mode==='model'?'unregistered-model':'deepseek-flash',choices:[{finish_reason:mode==='truncated'?'length':'stop',message:{content:output}}],usage:mode==='usage'?{prompt_tokens:0}:{prompt_tokens:40,completion_tokens:12,total_tokens:52,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:40}}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
  const transport=async(endpoint,options)=>{assert.equal(endpoint,DEEPSEEK_ENDPOINT);return fetch(url,options);};
  const provider=new DeepSeekProvider(config,budget,transport);
  const request={projectId:'synthetic-project',modelCode:'deepseek-flash',capabilityCode:'text.generate',traceId:'synthetic-trace',payload:{query:'Contact user@example.test 13800138000',evidence:[{documentId:'internal-document',title:'Synthetic',excerpt:'Only synthetic knowledge sk-abcdefgh123456789'}]}};
  try{
    await t.test('three explicit gates, trusted project and allowlist reject before network or reservation',async()=>{
      for(const k of Object.keys(flags)){const old=flags[k];delete flags[k];await assert.rejects(provider.invoke(request,'synthetic-secret-123456789'));flags[k]=old;}
      await assert.rejects(provider.invoke({...request,projectId:'foreign-project'},'synthetic-secret-123456789'));
      await assert.rejects(provider.invoke({...request,payload:{...request.payload,workspaceId:'foreign'}},'synthetic-secret-123456789'));
      assert.equal(requests,0);assert.equal(reservations,0);
    });
    await t.test('fixed protocol, masked payload, bounded output and token-only cost result',async()=>{
      const result=await provider.invoke(request,'synthetic-secret-123456789');assert.equal(result.output.answer,'Synthetic answer [EMAIL]');
      assert.equal(lastBody.max_tokens,2048);assert.deepEqual(lastBody.thinking,{type:'disabled'});assert.equal(lastBody.stream,false);
      const sent=JSON.stringify(lastBody);for(const s of ['user@example.test','13800138000','sk-abcdefgh123456789','internal-document'])assert.equal(sent.includes(s),false);
      assert.equal(result.usage.costAmountNanos,undefined);assert.equal(settlements,1);
    });
    await t.test('provider errors, redirects, malformed/truncated/oversized and invalid usage remain reserved with safe errors',async()=>{
      for(mode of ['error','redirect','malformed','truncated','model','oversize','usage'])await assert.rejects(provider.invoke(request,'synthetic-secret-123456789'),e=>e.message==='AI external provider request failed');
      assert.equal(settlements,1);
    });
    await t.test('abort cancels transport and keeps ambiguous invocation reservation',async()=>{
      mode='slow';const c=new AbortController();const call=provider.invoke({...request,signal:c.signal},'synthetic-secret-123456789');setTimeout(()=>c.abort(),30);await assert.rejects(call);assert.equal(settlements,1);
    });
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
