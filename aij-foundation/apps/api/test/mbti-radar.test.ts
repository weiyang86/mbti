import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { MbtiRadarService } from "../src/mbti/mbti-radar.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { MbtiSocialService } from "../src/mbti/mbti-social.service";

// Throw on every unimplemented DB method: unavailable must not query an aggregate/cohort.
function fixture() {
  const calls: string[] = [];
  let stored: { enrolled: boolean } | null = null;
  let type: string | undefined = "INFP";
  const tx = {
    mbtiCard: { async findUnique() { calls.push("card"); return type === undefined ? null : { typeCode: type }; } },
    mbtiRadarParticipation: {
      async findUnique() { calls.push("participation"); return stored; },
      async upsert({ create }: { create: { enrolled: boolean } }) { calls.push("write"); stored = { enrolled: create.enrolled }; return stored; }
    }
  };
  const db = { ...tx, async $transaction(work: (value: typeof tx) => Promise<unknown>) { const value = await work(tx); calls.push("commit"); return value; } };
  const social = { async lockOwners() { calls.push("lock"); } };
  return { radar: new MbtiRadarService(db as unknown as PrismaService, social as unknown as MbtiSocialService), calls,
    setType(value: string | undefined) { type = value; } };
}
function code(value: string) { return (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code === value; }

test("radar GET missing row is read only and same-type uses only own card/participation", async () => {
  const f = fixture();
  assert.deepEqual(await f.radar.participation("own", "/"), { enrolled: false });
  assert.deepEqual(f.calls, ["participation"]);
  assert.deepEqual(await f.radar.sameType("own", "/?radius_m=500"), { count: null, status: "unavailable", reason: "not_enrolled" });
  assert.deepEqual(f.calls, ["participation", "card", "participation", "commit"]);
});

test("radar validation order and raw duplicate/special query keys", async () => {
  const f = fixture(); f.setType(undefined);
  for (const query of ["radius_m=0", "radius_m=500&radius_m=500", "__proto__=x", "type_code[]=INFP", "type_code=infp"]) {
    await assert.rejects(f.radar.sameType("own", "/?" + query), code("INVALID_RADAR_INPUT"));
  }
  assert.deepEqual(f.calls, []);
  await assert.rejects(f.radar.sameType("own", "/?type_code=INFP"), code("RADAR_TYPE_REQUIRED"));
  f.setType("ESTJ");
  await assert.rejects(f.radar.sameType("own", "/?type_code=INFP"), code("RADAR_TYPE_MISMATCH"));
});

test("radar joins share owner lock, same-value PUT avoids rewriting, exit needs no type", async () => {
  const f = fixture();
  assert.deepEqual(await f.radar.update("own", "/", { enrolled: true }), { enrolled: true });
  assert.deepEqual(f.calls, ["lock", "card", "participation", "write", "commit"]);
  f.calls.length = 0;
  await f.radar.update("own", "/", { enrolled: true });
  assert.deepEqual(f.calls, ["lock", "card", "participation", "commit"]);
  f.setType(undefined); f.calls.length = 0;
  assert.deepEqual(await f.radar.update("own", "/", { enrolled: false }), { enrolled: false });
  assert.deepEqual(f.calls, ["lock", "participation", "write", "commit"]);
});

test("radar transaction/DB errors propagate instead of successful unavailable or uncommitted choice", async () => {
  const failure = new Error("synthetic database failure");
  const db = { async $transaction() { throw failure; }, mbtiRadarParticipation: { async findUnique() { throw failure; } } };
  const radar = new MbtiRadarService(db as unknown as PrismaService, {} as MbtiSocialService);
  await assert.rejects(radar.participation("own", "/"), error => error === failure);
  await assert.rejects(radar.sameType("own", "/"), error => error === failure);
  await assert.rejects(radar.update("own", "/", { enrolled: false }), error => error === failure);
});
