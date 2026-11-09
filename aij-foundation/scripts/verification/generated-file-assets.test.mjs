import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, realpath, rm, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import ts from "typescript";
const root = fileURLToPath(new URL("../../", import.meta.url));
const loaded = new Map();
function load(path) {
  const filename = resolve(root, path);
  if (loaded.has(filename)) return loaded.get(filename).exports;
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { fileName: filename, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: true } });
  assert.deepEqual(compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error), []);
  const module = { exports: {} }; loaded.set(filename, module);
  const requireFile = createRequire(filename);
  const req = name => name.startsWith(".") && existsSync(resolve(dirname(filename), name + ".ts")) ? load(resolve(dirname(filename), name + ".ts")) : requireFile(name);
  new Script(`(function(require,module,exports,__filename,__dirname){${compiled.outputText}\n})`, { filename })
    .runInThisContext()(req, module, module.exports, filename, dirname(filename));
  return module.exports;
}
const requireApi = createRequire(resolve(root, "apps/api/package.json"));
requireApi("reflect-metadata");
const { GeneratedFileAssetsService, GeneratedFileError } = load("apps/api/src/files/generated-file-assets.service.ts");
const { LocalStorageAdapter } = load("apps/api/src/files/local-storage.adapter.ts");
const { FileContentService } = load("apps/api/src/files/file-content.service.ts");
const { StorageReaderRouter } = load("apps/api/src/files/storage-reader-router.ts");
const storageProjectId = "aij-foundation";
const scope = { projectId: "20102010-2010-4010-8010-201020102010", workspaceId: "workspace-201", memberId: "member-201", pluginCode: "aij-ai" };
const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
function spec(bytes = pdf, format = "pdf") { return { format, mimeType: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  bytes, checksum: createHash("sha256").update(bytes).digest("hex"), originalName: "测试." + format, downloadUrl: "/api/client/document-exports/generated/content" }; }
const error = code => e => e instanceof GeneratedFileError && e.code === code && e.message === "Generated file " + code && !e.cause;
// Transaction collaborator simulates pending commit/rollback and lock lifetime, NOT PostgreSQL.
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "aij-af201-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const storageRoot = join(dir, storageProjectId, "test/files");
  const values = { projectId: storageProjectId, environment: "test", repositoryRoot: dir, storageRoot };
  const storage = new LocalStorageAdapter({ getOrThrow: k => values[k] });
  const content = new FileContentService(new StorageReaderRouter([["local", storage]]));
  const rows = new Map(), locks = new Map(), fences = new Map();
  const state = { unknown: false, removeFails: false, createFails: false, lostResponse: false };
  const match = (a, w) => w.OR ? w.OR.some(q => match(a, q)) : Object.entries(w).every(([k,v]) => a[k] === v);
  function tx() {
    const pending = new Map(), pendingFences = new Map(), release = [], held = new Set();
    return { pending, pendingFences, release, fileAsset: {
      create: async ({ data }) => { if (state.createFails) throw Error("private database details"); const row = { ...data, createdAt: new Date(), updatedAt: new Date() }; pending.set(row.id,row); return row; },
      findUnique: async ({where}) => pending.get(where.id) ?? rows.get(where.id) ?? null,
      findFirst: async ({where}) => [...pending.values(),...rows.values()].find(a => match(a,where)) ?? null
    }, $executeRaw: async (query, id, key) => {
      assert.match(query.join('?'), /INSERT INTO public.generated_file_cleanup_fence/);
      pendingFences.set(id, { asset_id: id, object_key: key }); return 1;
    }, $queryRaw: async (_query, key, objectKey) => {
      if (_query.join('?').includes('FROM public.generated_file_cleanup_fence')) return [...fences.values(), ...pendingFences.values()].filter(f => f.asset_id === key || f.object_key === objectKey);
      if (held.has(key)) return [{locked:1}];
      const prior = locks.get(key) ?? Promise.resolve(); let unlock;
      const own = new Promise(r => { unlock = r; }); const tail = prior.then(() => own); locks.set(key,tail);
      await prior; held.add(key); release.push(unlock); return [{locked:1}];
    } };
  }
  const db = { $transaction: async callback => {
    if (state.unknown) throw Error("private connection details");
    const client = tx();
    try { const result = await callback(client); for (const [k,v] of client.pending) rows.set(k,v); for (const [k,v] of client.pendingFences) fences.set(k,v); if (state.lostResponse) throw Error("response lost"); return result; }
    finally { client.release.forEach(f => f()); }
  }, $executeRaw: async (query, id, key) => {
    assert.match(query.join('?'), /UPDATE public.generated_file_cleanup_fence SET removed_at/);
    assert.equal(fences.get(id)?.object_key, key); fences.get(id).removed_at = new Date(); return 1;
  } };
  const originalRemove = storage.remove.bind(storage);
  storage.remove = async key => { if (state.removeFails) throw Error("private disk path"); return originalRemove(key); };
  const service = new GeneratedFileAssetsService(db,storage,content);
  return { service, db, rows, state, storage, storageRoot, other: () => new GeneratedFileAssetsService(db,storage,content),
    objects: async () => readdir(join(storageRoot,"objects")), transaction: db.$transaction };
}
test("real local bytes, private metadata, commit/confirm and exact scoped read", async t => {
  const f = await fixture(t), ticket = await f.service.stage(scope,spec());
  assert.deepEqual(Object.keys(ticket),["assetId"]); assert.ok(Object.isFrozen(ticket));
  assert.equal(JSON.stringify(ticket).includes("objects"),false);
  const meta = await f.transaction(tx => f.service.commitInTransaction(tx,ticket));
  assert.equal(meta.assetId,ticket.assetId); assert.equal("objectKey" in meta,false); assert.equal("path" in meta,false);
  const row = f.rows.get(ticket.assetId);
  assert.equal(row.ownerType,"user"); assert.equal(row.ownerId,scope.memberId); assert.equal(row.uploaderId,scope.memberId);
  assert.notEqual(row.objectKey,ticket.assetId); assert.equal(row.storageType,"local");
  const read = await f.transaction(tx => f.service.readInTransaction(tx,ticket.assetId,scope));
  assert.deepEqual(read.bytes,pdf); assert.equal(read.checksum,spec().checksum);
  await f.service.confirm(ticket);
  await assert.rejects(f.service.discard(ticket),error("INVALID_TICKET")); assert.equal((await f.objects()).length,1);
});
test("rollback cleanup; forged/cross-instance/repeated tickets rejected",async t => {
  const f = await fixture(t), ticket = await f.service.stage(scope,spec());
  await assert.rejects(f.service.discard({assetId:ticket.assetId}),error("INVALID_TICKET"));
  await assert.rejects(f.other().discard(ticket),error("INVALID_TICKET"));
  await assert.rejects(f.service.confirm(ticket),error("INVALID_TICKET"));
  await assert.rejects(f.transaction(async tx => { await f.service.commitInTransaction(tx,ticket); throw Error("rollback"); }),/rollback/);
  await assert.rejects(f.transaction(tx => f.service.commitInTransaction(tx,ticket)),error("INVALID_TICKET"));
  await assert.rejects(f.service.confirm(ticket),error("UNAVAILABLE"));
  assert.deepEqual(await f.service.discard(ticket),{removed:true,retainedBecauseCommitted:false});
  assert.deepEqual(await f.objects(),[]); await assert.rejects(f.service.discard(ticket),error("INVALID_TICKET"));
});
test("committed/response lost/inactive metadata is retained; unknown database and failed cleanup preserve ability to retry",async t => {
  const f = await fixture(t), ticket = await f.service.stage(scope,spec());
  f.state.lostResponse = true;
  await assert.rejects(f.transaction(tx => f.service.commitInTransaction(tx,ticket)),/response lost/);
  f.state.lostResponse = false; f.rows.get(ticket.assetId).status = "deleted";
  assert.deepEqual(await f.service.discard(ticket),{removed:false,retainedBecauseCommitted:true});
  const second = await f.service.stage(scope,spec());
  f.state.unknown = true; await assert.rejects(f.service.discard(second),error("UNAVAILABLE")); assert.equal((await f.objects()).length,2);
  f.state.unknown = false; f.state.removeFails = true;
  await assert.rejects(f.service.discard(second),error("UNAVAILABLE")); assert.equal((await f.objects()).length,2);
  f.state.removeFails = false; assert.equal((await f.service.discard(second)).removed,true);
});
test("pending transaction cannot race cleanup; cleanup waits for committed outcome",async t => {
  const f = await fixture(t), ticket = await f.service.stage(scope,spec());
  let ready, finish; const started = new Promise(r => { ready=r; }), ending = new Promise(r => { finish=r; });
  const commit = f.transaction(async tx => { await f.service.commitInTransaction(tx,ticket); ready(); await ending; });
  await started;
  let settled = false; const cleanup = f.service.discard(ticket).then(r => { settled=true; return r; });
  await new Promise(r => setImmediate(r)); assert.equal(settled,false); assert.equal((await f.objects()).length,1);
  finish(); await commit; assert.equal((await cleanup).retainedBecauseCommitted,true);
});
test("create failure retained until explicit safe discard; matching key under different id retained",async t => {
  const f = await fixture(t), ticket = await f.service.stage(scope,spec());
  f.state.createFails = true;
  await assert.rejects(f.transaction(tx => f.service.commitInTransaction(tx,ticket)),error("UNAVAILABLE"));
  assert.equal((await f.objects()).length,1);
  const key = (await f.objects())[0]; f.rows.set("different",{id:"different",objectKey:key});
  assert.equal((await f.service.discard(ticket)).retainedBecauseCommitted,true);
});
test("scope, deletion, corruption, storage type and unsafe metadata refusals",async t => {
  const f = await fixture(t), ticket = await f.service.stage(scope,spec());
  await f.transaction(tx => f.service.commitInTransaction(tx,ticket));
  for (const change of [{workspaceId:"else"},{projectId:"else"},{memberId:"else"}]) {
    await assert.rejects(f.transaction(tx => f.service.readInTransaction(tx,ticket.assetId,{...scope,...change})),error("NOT_FOUND"));
  }
  const row = f.rows.get(ticket.assetId), original = {...row};
  for (const change of [{status:"deleted"},{deletedAt:new Date()},{pluginCode:null},{ownerType:"admin"},{uploaderId:"else"}]) {
    Object.assign(row,original,change); await assert.rejects(f.transaction(tx => f.service.readInTransaction(tx,ticket.assetId,scope)),error("NOT_FOUND"));
  }
  for (const change of [{checksum:"0".repeat(64)},{size:MAX+1},{storageType:"qiniu:test:v1"},{originalName:"../x.pdf"},{mimeType:"text/plain"}]) {
    Object.assign(row,original,change); await assert.rejects(f.transaction(tx => f.service.readInTransaction(tx,ticket.assetId,scope)),error("UNAVAILABLE"));
  }
  Object.assign(row,original); await writeFile(join(f.storageRoot,"objects",row.objectKey),Buffer.from("corrupt"));
  await assert.rejects(f.transaction(tx => f.service.readInTransaction(tx,ticket.assetId,scope)),error("UNAVAILABLE"));
});
const MAX=5*1024*1024;
test("JSON original bytes and opaque one-use prepared reads; malformed private output never staged", async t => {
  const f = await fixture(t), bytes = Buffer.from(' \n{"value":[1,true,null,"合成"]}\t');
  const jsonSpec = value => ({ format: 'json', mimeType: 'application/json', bytes: value, checksum: createHash('sha256').update(value).digest('hex'),
    originalName: 'script-11111111-1111-4111-8111-111111111111.json', downloadUrl: '/api/client/script-executions/runs/synthetic/content' });
  for (const invalid of ['{"a":1,"\\u0061":2}', '{"nested":{"k":1,"k":2}}', '{"constructor":1}', '"\\ud800"', '1e999', '1 2', '\ufeff{}', '[]'.repeat(32769)]) {
    await assert.rejects(f.service.stage(scope, jsonSpec(Buffer.from(invalid))), error('INVALID_INPUT'));
  }
  await assert.rejects(f.service.stage(scope, { ...jsonSpec(bytes), originalName: 'plain.json' }), error('INVALID_INPUT'));
  const ticket = await f.service.stage(scope, jsonSpec(bytes));
  await f.transaction(tx => f.service.commitInTransaction(tx, ticket)); await f.service.confirm(ticket);
  const read = await f.transaction(tx => f.service.prepareReadInTransaction(tx, ticket.assetId, scope));
  assert.equal(JSON.stringify(read), '{}');
  await assert.rejects(f.other().readPrepared(read), error('INVALID_TICKET'));
  assert.deepEqual(await f.service.readPrepared(read), bytes);
  await assert.rejects(f.service.readPrepared(read), error('INVALID_TICKET'));
});
test("input validation refuses before I/O, snapshots caller bytes, successful DOCX basic envelope",async t => {
  const f = await fixture(t);
  for (const change of [{format:"txt"},{mimeType:"text/plain"},{bytes:new Uint8Array(pdf)},{bytes:Buffer.alloc(0)},{bytes:Buffer.alloc(MAX+1)},
    {checksum:"0".repeat(64)},{originalName:"../x.pdf"},{originalName:"CON.pdf"},{originalName:"x\r.pdf"},{downloadUrl:"//evil/x"},
    {downloadUrl:"/api/client/../x"},{downloadUrl:"/api/client/%2e%2e/x"},{downloadUrl:"https://example.com/api/client/x"},{downloadUrl:"/api/client/x?body=secret"}]) {
    await assert.rejects(f.service.stage(scope,{...spec(),...change}),error("INVALID_INPUT"));
  }
  for (const invalid of [{...scope,workspaceId:null},{...scope,pluginCode:"qingqi"},{...scope,memberId:""}]) await assert.rejects(f.service.stage(invalid,spec()),error("INVALID_INPUT"));
  await assert.rejects(f.service.stage(scope,spec(Buffer.from("invalid PDF"))),error("INVALID_INPUT"));
  assert.equal(existsSync(join(f.storageRoot,"objects")),false);
  const {Document,Packer,Paragraph} = requireApi("docx");
  const bytes = await Packer.toBuffer(new Document({sections:[{children:[new Paragraph("Synthetic AF201")]}]}));
  const staging = f.service.stage(scope,spec(bytes,"docx")); bytes.fill(0);
  const ticket = await staging;
  await f.transaction(tx => f.service.commitInTransaction(tx,ticket));
  assert.ok((await f.transaction(tx => f.service.readInTransaction(tx,ticket.assetId,scope))).bytes.length>0);
  await f.service.confirm(ticket);
});


test("pending rollback cleanup waits, then removes; unknown confirmation keeps recovery capability",async t => {
  const f = await fixture(t), ticket = await f.service.stage(scope,spec());
  let ready, finish; const started = new Promise(r => { ready=r; }), ending = new Promise(r => { finish=r; });
  const pending = f.transaction(async tx => { await f.service.commitInTransaction(tx,ticket); ready(); await ending; throw Error("rollback"); });
  await started; const rollback = assert.rejects(pending,/rollback/);
  let settled=false; const cleanup = f.service.discard(ticket).then(r => { settled=true; return r; });
  await new Promise(r => setImmediate(r)); assert.equal(settled,false);
  finish(); await rollback; assert.equal((await cleanup).removed,true); assert.deepEqual(await f.objects(),[]);
  const second = await f.service.stage(scope,spec());
  await f.transaction(tx => f.service.commitInTransaction(tx,second));
  f.state.unknown=true; await assert.rejects(f.service.confirm(second),error("UNAVAILABLE"));
  f.state.unknown=false; await f.service.confirm(second);
  await assert.rejects(f.service.confirm(second),error("INVALID_TICKET"));
});

test("in-flight ticket operations refuse concurrent reuse; missing object safely refuses read",async t => {
  const f = await fixture(t), ticket = await f.service.stage(scope,spec());
  const committing = f.transaction(tx => f.service.commitInTransaction(tx,ticket));
  await assert.rejects(f.service.discard(ticket),error("INVALID_TICKET"));
  await assert.rejects(f.service.confirm(ticket),error("INVALID_TICKET"));
  await committing;
  await f.storage.remove(f.rows.get(ticket.assetId).objectKey);
  await assert.rejects(f.transaction(tx => f.service.readInTransaction(tx,ticket.assetId,scope)),error("UNAVAILABLE"));
});


test("core profile IDs remain opaque and distinct from runtime storage slug",async t => {
  const f = await fixture(t);
  for (const projectId of [scope.projectId, "cm9ab201exampleprofile0001", "Core_Profile-201", "a".repeat(128)]) {
    const current = {...scope,projectId};
    const ticket = await f.service.stage(current,spec());
    await f.transaction(tx => f.service.commitInTransaction(tx,ticket));
    const row = f.rows.get(ticket.assetId);
    assert.equal(row.projectId,projectId);
    assert.notEqual(row.projectId,storageProjectId);
    assert.deepEqual((await f.transaction(tx => f.service.readInTransaction(tx,ticket.assetId,current))).bytes,pdf);
    for (const wrong of [storageProjectId, projectId + "x"]) {
      if (wrong.length <= 128) await assert.rejects(f.transaction(tx => f.service.readInTransaction(tx,ticket.assetId,{...current,projectId:wrong})),error("NOT_FOUND"));
    }
    await f.service.confirm(ticket);
  }
});

test("unsafe or unbounded core project IDs refuse before filesystem I/O",async t => {
  const f = await fixture(t);
  for (const projectId of [null,undefined,201,"","a".repeat(129),"../profile","a/b","a\\b","a.b","a b","a\n","a\u0000","a\u007f","a\u009f","a\u202e","项目","https://example.com"]) {
    const invalid = {...scope,projectId};
    await assert.rejects(f.service.stage(invalid,spec()),error("INVALID_INPUT"));
    await assert.rejects(f.transaction(tx => f.service.readInTransaction(tx,"20102010-2010-4010-8010-201020102010",invalid)),error("INVALID_INPUT"));
  }
  assert.equal(existsSync(join(f.storageRoot,"objects")),false);
});

test("filename codepoint guards reject all former unsafe character ranges",async t => {
  const f = await fixture(t);
  for (const point of [0,31,127,159,0x202a,0x202e,0x2066,0x2069]) {
    await assert.rejects(f.service.stage(scope,{...spec(),originalName:"file"+String.fromCodePoint(point)+".pdf"}),error("INVALID_INPUT"));
  }
  assert.equal(existsSync(join(f.storageRoot,"objects")),false);
});
