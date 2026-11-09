import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readDatabaseEnvironment, withDatabase } from '../database/connection.mjs';
const folder='.artifacts/auto-ai-program-20261105/AF-190/';
const read=p=>JSON.parse(readFileSync(p,'utf8')),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const latest=read(folder+'latest-live.json');assert.equal(hash(latest.path),latest.sha256);const proof=read(latest.path),native=read(folder+'native-runtime.json');
assert.equal(proof.task,'AF-190');assert.equal(proof.status,'EVIDENCE_RECORDED_FORMAL_REPORT_IS_AUTHORITY');assert.equal(proof.applicationPools,0);assert.equal(proof.upstreamCalls,0);assert.equal(proof.executionLedgersUnchanged,true);assert.equal(proof.heldRevocations,true);
assert.equal(native.status,'CLOSED');assert.equal(native.leaseId,proof.acceptanceId);
const actual=read(native.evidence);assert.equal(actual.status,'ACTUAL_NATIVE_PASSED');assert.equal(actual.leaseId,proof.acceptanceId);assert.ok(actual.nativeActions>100);
assert.equal(actual.buildId,readFileSync('apps/web/.next-af190/BUILD_ID','utf8').trim());
for(const name of ['productionWeb','desktopCreateSaveHistory','mobile390','casConflictDraftRetained','oldScopeFenced','readOnly','unknownReadAck','keyboardLabelsFocus','noPrivateCache'])assert.equal(proof.browser[name],true,name);
for(const entries of [proof.sourceHashes,proof.compiledHashes,proof.nativeReceiptHashes]){assert.ok(Object.keys(entries).length>15);for(const [p,expected]of Object.entries(entries))assert.equal(hash(p),expected,p);}
const pngs=proof.browser.artifacts.filter(p=>p.endsWith('.png'));assert.ok(pngs.length>=6);for(const p of pngs){assert.ok(statSync(p).size>100);assert.equal(readFileSync(p).subarray(0,8).toString('hex'),'89504e470d0a1a0a');}
const db=readDatabaseEnvironment('test',process.env,proof.acceptanceId);await withDatabase('test',db,async c=>{
  const row=(await c.query("SELECT current_database() AS database,(SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend') AS pools")).rows[0];assert.equal(row.database,proof.database);assert.equal(row.pools,0);
  assert.deepEqual((await c.query("SELECT migration_name,checksum FROM public._prisma_migrations WHERE migration_name='20261106030000_personal_documents' AND finished_at IS NOT NULL AND rolled_back_at IS NULL")).rows[0],proof.appliedMigration);
  for(const table of ['ai_agent_run','runtime_job','ai_execution_trace'])assert.equal((await c.query('SELECT count(*)::int AS n FROM public.'+table)).rows[0].n,0);
},{acceptanceId:proof.acceptanceId});
console.log(JSON.stringify({status:'PASS',task:'AF-190',leaseId:proof.acceptanceId,sources:Object.keys(proof.sourceHashes).length,compiled:Object.keys(proof.compiledHashes).length,nativeActions:actual.nativeActions,screenshots:pngs.length,allPools0:true,documentHidden:'NOT_PROVEN',ownerAcceptance:'PENDING'}));
