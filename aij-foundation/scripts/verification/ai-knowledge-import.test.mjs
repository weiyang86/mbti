import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {createRemainingClientFixture} from "./remaining-client-fixture.mjs";
import {createClientApi} from "../../packages/sdk/dist/index.mjs";
import {createKnowledgeDocumentsApi} from "../../apps/web/app/components/client-knowledge-api.ts";
test('AF-119 UTF-8 knowledge files import into authenticated Workspace snapshots',{timeout:360000},async t=>{
  const f=await createRemainingClientFixture('AF-119');const[alpha,beta]=f.workspaces;const[cookie,foreign]=f.cookies;const options={cookie,workspaceId:alpha.id};const path='client/ai/knowledge/documents/import';let document;
  const form=(filename='synthetic.txt',content='Synthetic aurora guide content',type='text/plain',code='synthetic-import')=>{const value=new FormData();value.append('documentCode',code);value.append('title','Synthetic import');value.append('file',new Blob([content],{type}),filename);return value;};
  try{
    await t.test('valid bytes become one Workspace document with source checksum and no raw FileAsset',async()=>{
      document=(await f.request('POST',path,{...options,form:form(),status:201})).data;
      const row=await f.prisma.aiKnowledgeDocument.findUniqueOrThrow({where:{id:document.id}});assert.equal(row.workspaceId,alpha.id);assert.equal(row.sourceFilename,'synthetic.txt');assert.equal(row.content,'Synthetic aurora guide content');assert.equal(row.sourceChecksum,createHash('sha256').update(row.content).digest('hex'));
      assert.equal(await f.prisma.fileAsset.count(),0);
      const audit=await f.prisma.auditLog.findFirstOrThrow({where:{action:'ai_knowledge_document_imported',resourceId:document.id}});assert.equal(JSON.stringify(audit).includes(row.content),false);
      await f.request('POST',path,{...options,form:form(),status:409});
    });
    await t.test('actual Web SDK multipart consumer preserves browser boundary and imports Markdown',async()=>{
      const original=globalThis.fetch;globalThis.fetch=(url,init={})=>{const headers=new Headers(init.headers);headers.set('cookie',cookie);headers.set('origin',process.env.WEB_URL);return original(url,{...init,headers});};
      try{const api=createKnowledgeDocumentsApi(createClientApi(()=>f.baseUrl));const result=await api.importFile(alpha.id,new File(['Synthetic markdown aurora guide'],'guide.md',{type:'text/markdown'}));assert.ok(result.id);const listed=await api.list(alpha.id);assert.equal(listed.items.some(x=>x.sourceFilename==='guide.md'),true);}finally{globalThis.fetch=original;}
    });
    await t.test('binary, wrong format, invalid UTF-8, empty, oversized and extra fields reject without documents',async()=>{
      const before=await f.prisma.aiKnowledgeDocument.count();
      for(const value of [form('x.pdf','%PDF-1.0','application/pdf','bad-pdf'),form('x.txt',Buffer.from([0xff,0xfe]),'text/plain','bad-utf8'),form('x.txt','\0binary','text/plain','bad-binary'),form('x.txt','  ','text/plain','bad-empty')])await f.request('POST',path,{...options,form:value,status:400});
      await f.request('POST',path,{...options,form:form('large.txt','x'.repeat(51201),'text/plain','bad-large'),status:413});
      const extra=form();extra.append('workspaceId',beta.id);await f.request('POST',path,{...options,form:extra,status:400});
      assert.equal(await f.prisma.aiKnowledgeDocument.count(),before);
    });
    await t.test('anonymous, nonmember, origin and cross-workspace reads reject',async()=>{
      await f.request('POST',path,{workspaceId:alpha.id,form:form(),status:401});
      await f.request('POST',path,{cookie:foreign,workspaceId:alpha.id,form:form(),status:403});
      await f.request('POST',path,{...options,origin:'https://foreign.invalid',form:form(),status:403});
      const foreignList=await f.request('GET','client/ai/knowledge/documents',{cookie:foreign,workspaceId:beta.id});assert.equal(foreignList.data.total,0);
    });
    await t.test('imported content uses existing stop and restore semantics for retrieval',async()=>{
      const query=()=>f.request('POST','client/ai/knowledge/query',{...options,body:{query:'aurora guide'}});
      const before=await query();assert.ok(before.data.citations.some(x=>x.documentId===document.id));
      let row=await f.prisma.aiKnowledgeDocument.findUniqueOrThrow({where:{id:document.id}});
      const stopped=await f.request('PATCH',`client/ai/knowledge/documents/${document.id}`,{...options,body:{status:'inactive',expectedUpdatedAt:row.updatedAt.toISOString()}});
      assert.equal((await query()).data.citations.some(x=>x.documentId===document.id),false);
      await f.request('PATCH',`client/ai/knowledge/documents/${document.id}`,{...options,body:{status:'active',expectedUpdatedAt:stopped.data.updatedAt}});
      assert.equal((await query()).data.citations.some(x=>x.documentId===document.id),true);
    });
  }finally{await f.close();}
});
