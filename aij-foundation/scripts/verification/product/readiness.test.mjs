// Product readiness adaptation of scripts/verification/readiness.test.mjs at
// 484e1f47c17a94a4ebcf23f3a4c9ebc4251084cb; retain all eight real HTTP/DB scenarios.
// Current migrations insert reference permissions: compare all rows to the migrated
// baseline instead of the historical assumption that every product table is empty.
import { snapshotProductRows } from "./row-snapshot.mjs";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../../database/migration.mjs";
import { profile, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../../database/connection.mjs";
import { assertPortAvailable } from "../../port-availability.mjs";
import { applicationSessions, readinessEnvironment, response, setTaskDatabaseConnections, waitReady } from "../readiness-support.mjs";

test("real Prisma/HTTP readiness, isolated database outage/recovery, identity and shutdown", { timeout: 55000 }, async (t) => {
  await assertPortAvailable(3656);
  const parent=join(repositoryRoot,".artifacts/product-verification/readiness");mkdirSync(parent,{recursive:true});const root=mkdtempSync(join(parent,"run-"));
  const save=(name,value)=>writeFileSync(join(root,name+".json"),JSON.stringify(value,null,2)+"\n");
  const protectedPaths=["apps/api/src/prisma/prisma.service.ts","apps/api/src/ready.controller.ts","scripts/runtime-environment.cjs","apps/api/prisma/schema.prisma","apps/api/prisma/migrations/20261019000000_initial/migration.sql",profile("test").secretFile,profile("test").stateFile];
  const hashes=()=>protectedPaths.map(p=>createHash("sha256").update(readFileSync(p)).digest("hex"));const before=hashes();
  const lease=await createAcceptance("test","AF-011");save("lease",lease);
  const original={...process.env};delete process.env.DATABASE_URL;delete process.env.TEST_DATABASE_URL;
  Object.assign(process.env,readinessEnvironment(lease.id));
  const require=createRequire(join(repositoryRoot,"apps/api/package.json"));
  const {createApplication}=require(join(repositoryRoot,"apps/api/dist/bootstrap.js"));
  const {PrismaService}=require(join(repositoryRoot,"apps/api/dist/prisma/prisma.service.js"));
  let app,prisma,baselineRows;
  const {Prisma}=require("@prisma/client");
  const snapshot=()=>withDatabase("test",readDatabaseEnvironment("test",process.env,lease.id),client=>snapshotProductRows(client,Prisma.dmmf.datamodel.models),{acceptanceId:lease.id});
  try {
    app=await createApplication();await app.listen(3656,"127.0.0.1");prisma=app.get(PrismaService);
    await t.test("unmigrated real database returns 503 while liveness is 200",async()=>{
      assert.equal(app.get(PrismaService),prisma);
      const ready=await response("ready",503),live=await response("health",200);
      assert.equal(ready.success,false);assert.equal(ready.data.reason,"MIGRATIONS_MISSING");assert.equal(live.data.scope,"process");assert.equal(live.data.database,"configured");save("unmigrated",{ready,live});
    });
    await t.test("apply actual initial, readiness becomes 200 with correlation",async()=>{
      const migration=await migrate({mode:"test",action:"deploy",acceptanceId:lease.id});assert.equal(migration.exitCode,0);
      baselineRows=await snapshot();save("migrated-rows-baseline",baselineRows);
      const ready=await response("ready",200);assert.equal(ready.data.reason,"READY");assert.equal(ready.data.scope,"database");save("migrated",{migration,ready});
    });
    await t.test("actual session role mismatch returns 503 without granting privileges or changing accounts",async()=>{
      await prisma.$executeRawUnsafe("SET ROLE pg_read_all_settings");
      try {const ready=await response("ready",503);assert.equal(ready.data.reason,"DATABASE_IDENTITY_MISMATCH");save("wrong-identity",ready);}
      finally {await prisma.$executeRawUnsafe("RESET ROLE");}
      await response("ready",200);
    });
    await t.test("close this pool and offline only this logical DB: ready503/live200, restore ready200",async()=>{
      await prisma.$disconnect();assert.deepEqual(await applicationSessions(lease.id),[]);
      const closed=await setTaskDatabaseConnections(lease.id,false);
      let ready,live;
      try {ready=await response("ready",503);live=await response("health",200);assert.equal(ready.data.reason,"DATABASE_UNAVAILABLE");assert.equal(live.data.status,"ok");}
      finally {await setTaskDatabaseConnections(lease.id,true);}
      const recovered=await waitReady();assert.equal(recovered.data.reason,"READY");save("outage-recovery",{closed,ready,live,recovered,containerStopped:false});
    });
    await t.test("app.close disconnects singleton pool and refuses new probes",async()=>{
      assert.equal((await applicationSessions(lease.id)).length,1);
      await app.close();app=undefined;
      assert.deepEqual(await applicationSessions(lease.id),[]);assert.equal((await prisma.readiness()).reason,"SHUTTING_DOWN");
      save("pool-closed",{sessions:[],closedProbe:await prisma.readiness()});await assertPortAvailable(3656);
    });
    await t.test("wrong real password gives sanitized 503 and process liveness remains available",async()=>{
      const values=readDatabaseEnvironment("test");const url=new URL(values.TEST_DATABASE_URL);const wrong=randomBytes(32).toString("hex");url.password=wrong;process.env.TEST_DATABASE_URL=url.href;
      app=await createApplication();await app.listen(3656,"127.0.0.1");
      const ready=await response("ready",503),live=await response("health",200);assert.equal(ready.data.reason,"DATABASE_UNAVAILABLE");
      const text=JSON.stringify({ready,live});assert.ok(!text.includes(wrong));assert.ok(!text.includes(decodeURIComponent(new URL(values.TEST_DATABASE_URL).password)));assert.doesNotMatch(text,/postgresql:|PrismaClient|password|stack|55433|aij_foundation_af011/);
      save("bad-credentials",{ready,live});await app.close();app=undefined;delete process.env.TEST_DATABASE_URL;assert.deepEqual(await applicationSessions(lease.id),[]);
    });
    await t.test("explicitly disabled database is not ready without acquiring a pool",async()=>{
      process.env.DATABASE_ENABLED="false";app=await createApplication();await app.listen(3656,"127.0.0.1");
      const ready=await response("ready",503),live=await response("health",200);assert.equal(ready.data.reason,"DATABASE_NOT_CONFIGURED");assert.equal(live.data.database,"not-configured");
      assert.deepEqual(await applicationSessions(lease.id),[]);save("disabled",{ready,live});await app.close();app=undefined;
    });
    await t.test("verification preserves source/credentials, every migrated row and zero API pools",async()=>{
      assert.deepEqual(hashes(),before);assert.deepEqual(await applicationSessions(lease.id),[]);
      assert.ok(baselineRows,"Full migrated baseline must have been captured");
      const afterRows=await snapshot();
      assert.deepEqual(afterRows,baselineRows,"Readiness probes must preserve every public table row and migration ledger");
      save("result",{database:lease.database,acceptanceId:lease.id,poolsClosed:true,sourceAndCredentialsUnchanged:true,productRowsPreserved:true,tableFingerprints:afterRows,logicalDatabaseRestored:true});
    });
  } finally {
    await setTaskDatabaseConnections(lease.id,true);
    if(app)await app.close();
    for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);
  }
});
