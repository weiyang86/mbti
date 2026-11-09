import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import test from 'node:test';
const require=createRequire(resolve('apps/api/package.json'));
require('reflect-metadata');
const source=process.env.AIJ_AF153_TEST_SOURCE==='true';
if(source)require('ts-node').register({project:resolve('apps/api/tsconfig.json'),transpileOnly:true});
const load=path=>require(resolve(`apps/api/${source?'src':'dist'}/${path}.${source?'ts':'js'}`));
const {Module}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core');
const {QiniuStorageAdapter,qiniuHash}=load('files/qiniu-storage.adapter');
const {StorageReaderRouter}=load('files/storage-reader-router');
const {STORAGE_READER}=load('files/storage-reader.port');
const {FileContentService,FileContentError}=load('files/file-content.service');
const options={productId:'aij-foundation',environment:'test',bucket:'synthetic-bucket',privateBucket:true,region:'z0',uploadOrigin:'https://up-z0.qiniup.com',managementOrigin:'https://rs-z0.qiniuapi.com',downloadOrigin:'https://files.example.com',allowedHosts:['up-z0.qiniup.com','rs-z0.qiniuapi.com','files.example.com']};
test(`${source?'source':'compiled'} Qiniu can be explicitly composed through the real Nest read port and content integrity owner`,async()=>{
 const bytes=Buffer.from('AF147 synthetic compiled storage'),key='314b8a4e-6bd1-4bb7-9eb9-3f5843ae50fc',requests=[];
 const credentials={accessKey:'SyntheticAccessKey147',secretKey:'SyntheticSecretKey147'};
 const transport={send:async input=>{
  requests.push({method:input.method,host:new URL(input.url).hostname});
  if(new URL(input.url).hostname==='rs-z0.qiniuapi.com')return {status:200,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify({fsize:bytes.length,hash:qiniuHash(bytes)}))};
  assert.equal(new URL(input.url).hostname,'files.example.com');assert.ok(new URL(input.url).searchParams.has('token'));
  return {status:200,headers:{'content-type':'application/octet-stream'},body:bytes};
 }};
 class ExplicitStorageHost{}
 Module({providers:[{provide:QiniuStorageAdapter,useFactory:()=>new QiniuStorageAdapter(options,async()=>credentials,{transport})},{provide:STORAGE_READER,useExisting:QiniuStorageAdapter},{provide:StorageReaderRouter,useFactory:reader=>new StorageReaderRouter([["qiniu:synthetic:v1",reader]]),inject:[STORAGE_READER]},FileContentService]})(ExplicitStorageHost);
 const app=await NestFactory.createApplicationContext(ExplicitStorageHost,{logger:false,abortOnError:false});
 try{
  const adapter=app.get(QiniuStorageAdapter);assert.equal(app.get(STORAGE_READER),adapter);
  const asset={storageType:"qiniu:synthetic:v1",objectKey:key,size:bytes.length,checksum:createHash('sha256').update(bytes).digest('hex')};
  assert.deepEqual(await app.get(FileContentService).read(asset),bytes);
  await assert.rejects(app.get(FileContentService).read({...asset,storageType:"local"}),e=>e instanceof FileContentError&&e.code==='unavailable');
  await assert.rejects(app.get(FileContentService).read({...asset,storageType:"qiniu:synthetic:v2"}),e=>e instanceof FileContentError&&e.code==='unavailable');
  assert.equal(requests.length,2);assert.ok(requests.every(r=>r.method==='GET'));
  await assert.rejects(app.get(FileContentService).read({...asset,checksum:'0'.repeat(64)}),e=>e instanceof FileContentError&&e.code==='corrupt');
 }finally{await app.close();}
});

// Keep the explicit protocol composition above, and verify the deployment path
// through the actual module as well. Default execution loads compiled API output.
test('actual FilesModule composes deployment profiles while STORAGE_READER remains the one local adapter',async()=>{
 const {FilesModule}=load('files/files.module');
 const {LocalStorageAdapter}=load('files/local-storage.adapter');
 const {SecretRefPort}=load('secret-center/secret-ref');
 const {ConfigModule}=require('@nestjs/config');
 const {Global}=require('@nestjs/common');
 const bytes=Buffer.from('AF153 actual compiled module'),key='414b8a4e-6bd1-4bb7-9eb9-3f5843ae50fc';
 const {productId,environment,...profileOptions}=options;
 const refs={accessKeyRef:'env://AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_AK',secretKeyRef:'env://AIJ_SECRET_AIJ_FOUNDATION_TEST_QINIU_SK'};
 const profile={...profileOptions,id:'qiniu:synthetic:v1',...refs};
 const resolved=[],requests=[];
 class Secrets{}
 Global()(Secrets);Module({providers:[{provide:SecretRefPort,useValue:{resolveTrusted:async ref=>{resolved.push(ref);return ref===refs.accessKeyRef?'SyntheticAccessKey153':'SyntheticSecretKey153';}}}],exports:[SecretRefPort]})(Secrets);
 class Host{}
 Module({imports:[ConfigModule.forRoot({isGlobal:true,ignoreEnvFile:true,load:[()=>({projectId:productId,environment,nodeEnv:'test',namespace:'aij_foundation_test',repositoryRoot:resolve('.'),storageRoot:resolve('.artifacts/af153/compiled/aij-foundation/test/storage'),AIJ_STORAGE_READ_PROFILES:JSON.stringify([profile])})]}),Secrets,FilesModule.withTestTransport(()=>({send:async input=>{
  requests.push(input.method);
  return new URL(input.url).hostname==='rs-z0.qiniuapi.com'?{status:200,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify({fsize:bytes.length,hash:qiniuHash(bytes)}))}:{status:200,headers:{},body:bytes};
 }}))]})(Host);
 const app=await NestFactory.createApplicationContext(Host,{logger:false,abortOnError:false});
 try{
  assert.equal(app.get(STORAGE_READER),app.get(LocalStorageAdapter));
  assert.equal(app.get(StorageReaderRouter).resolve('local'),app.get(LocalStorageAdapter));
  const content=app.get(FileContentService);
  assert.deepEqual(await content.read({storageType:profile.id,objectKey:key,size:bytes.length,checksum:createHash('sha256').update(bytes).digest('hex')}),bytes);
  assert.deepEqual(resolved,[refs.accessKeyRef,refs.secretKeyRef,refs.accessKeyRef,refs.secretKeyRef]);
  assert.deepEqual(requests,['GET','GET']);
  await assert.rejects(content.read({storageType:'qiniu:synthetic:v2'}),e=>e instanceof FileContentError&&e.code==='unavailable');
  assert.equal(requests.length,2);
 }finally{await app.close();}
});
