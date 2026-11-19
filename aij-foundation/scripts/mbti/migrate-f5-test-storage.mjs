// Guarded test-only layout compatibility for the brief F5 flat-adapter preview.
// Copies immutable bytes via the ORIGINAL adapter; NEVER logs raw values/keys or deletes sources.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { root, testContext } from "./test-context.mjs";
const { db, env, ownerRoot } = await testContext();
const require = createRequire(resolve(root, "apps/api/package.json"));
const { ConfigService } = require("@nestjs/config");
const { LocalStorageAdapter } = require(resolve(root, "apps/api/dist/files/local-storage.adapter.js"));
const storageRoot = resolve(ownerRoot, env.LOCAL_STORAGE_ROOT);
const config = storageRoot => new ConfigService({ projectId: "mbti-foundation", environment: "test", repositoryRoot: ownerRoot, storageRoot });
const old = new LocalStorageAdapter(config(storageRoot));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const same = (row, bytes) => bytes.length === row.size && hash(bytes) === row.checksum;
const report = { status: "candidate / needs_human_review", environment: "test", copied: 0, already_compatible: 0, references_unchanged: false, all_integrity_passed: false, original_objects_retained: true };
try {
 const owners = (await db.query('SELECT "ownerId" FROM "MbtiPrivateContacts" WHERE "objectKey" IS NOT NULL ORDER BY "ownerId"')).rows;
 for (const {ownerId} of owners) {
  await db.query("BEGIN");
  try {
   await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["mbti-social-owner:"+ownerId]);
   const row=(await db.query('SELECT * FROM "MbtiPrivateContacts" WHERE "ownerId"=$1 FOR UPDATE',[ownerId])).rows[0];
   if(!row?.objectKey) {await db.query("COMMIT");continue;}
   const target=new LocalStorageAdapter(config(resolve(storageRoot,"mbti-contacts",hash(Buffer.from(ownerId)))));
   if(await target.exists(row.objectKey)) {
    if(!same(row,await target.read(row.objectKey)))throw new Error("integrity");
    // If legacy exists, verify it as well; never overwrite an already-present destination.
    if(await old.exists(row.objectKey))if(!same(row,await old.read(row.objectKey)))throw new Error("integrity");
    report.already_compatible++;
   } else {
    const bytes=await old.read(row.objectKey);
    if(!same(row,bytes))throw new Error("integrity");
    // Check exact contact document shape without echoing a value or accepting malformed legacy data.
    const data=JSON.parse(bytes.toString("utf8"));
    if(!data||typeof data!=="object"||Array.isArray(data)||Object.entries(data).some(([k,v])=>!["wechat","qq","phone"].includes(k)||typeof v!=="string"))throw new Error("shape");
    await target.write(row.objectKey,bytes);
    if(!same(row,await target.read(row.objectKey)))throw new Error("integrity");
    report.copied++;
   }
   const after=(await db.query('SELECT * FROM "MbtiPrivateContacts" WHERE "ownerId"=$1',[ownerId])).rows[0];
   if(JSON.stringify(row)!==JSON.stringify(after))throw new Error("references changed");
   await db.query("COMMIT");
  } catch {await db.query("ROLLBACK");throw new Error("compatibility verification failed");}
 }
 report.references_unchanged=true;report.all_integrity_passed=true;report.outcome="passed";
 console.log(`PASS F5 test layout compatibility: copied=${report.copied} already_compatible=${report.already_compatible} references_unchanged=true integrity=true originals_retained=true; keys/values suppressed`);
} catch {report.outcome="failed";console.error("FAIL F5 test layout compatibility; original references retained, sensitive details suppressed");process.exitCode=1;}
finally {const dir=resolve(root,".artifacts");mkdirSync(dir,{recursive:true,mode:0o700});const path=resolve(dir,"mbti-f5-layout-evidence.json");writeFileSync(path,JSON.stringify(report,null,2)+"\n",{mode:0o600});chmodSync(path,0o600);await db.end();}
