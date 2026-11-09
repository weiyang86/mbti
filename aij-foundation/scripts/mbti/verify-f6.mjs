// Only own synthetic cohort writes; original credentials live in ignored 0600 state.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { root, testContext } from "./test-context.mjs";
const phase = process.argv[2] || "prepare";
assert.ok(["prepare", "restart"].includes(phase));
const base = "http://192.168.0.200:4156/api/v1";
const { db, env } = await testContext();
const directory = resolve(root, ".artifacts"); mkdirSync(directory, { recursive: true, mode: 0o700 });
const statePath = resolve(directory, "mbti-f6-http-state.json");
const s = phase === "restart" ? JSON.parse(readFileSync(statePath, "utf8")) : { tokens: {}, owners: {}, cards: {}, snapshots: {} };
const report = { status: "candidate / needs_human_review", phase, base,
  revision: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(), checks: [], assertions: [],
  blocked: ["real participation/exit counts", "real radius/boundary filtering", "bidirectional block in aggregation", "small sample and location authorization withdrawal"] };
function ok(label, condition) { assert.ok(condition, label); report.assertions.push({ label, passed: true }); }
async function req(actor, method, path, body, expected = 200, label = path, raw = false) {
  const headers = { ...(s.tokens[actor] ? { "X-Guest-Token": s.tokens[actor] } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) };
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const text = await response.text(); let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = {}; }
  const passed = response.status === expected;
  report.checks.push({ id: `${phase === "prepare" ? "P" : "R"}${String(report.checks.length + 1).padStart(3, "0")}`,
    actor, method, path: path.replace(/card_[A-Za-z0-9_-]+/g, "{card_id}").replace(/contact_[A-Za-z0-9_-]+/g, "{contact_request_id}").replace(/exchange_[A-Za-z0-9_-]+/g, "{exchange_id}"), label, status: response.status, expected, passed,
    no_store: response.headers.get("cache-control") === "no-store", ...(data?.code ? { code: data.code } : {}) });
  assert.ok(passed, `${label}: status ${response.status}, expected ${expected}`);
  if (path !== "/auth/guest") ok("HTTP no-store", response.headers.get("cache-control") === "no-store");
  if (expected >= 400) ok("error exact code/message", !!data?.code && typeof data.message === "string" && Object.keys(data).sort().join(",") === "code,message");
  if (path.startsWith("/radar/") && expected === 200) {
    ok("radar exact projection without personal data", path.startsWith("/radar/participation")
      ? Object.keys(data).join(",") === "enrolled" && typeof data.enrolled === "boolean"
      : Object.keys(data).sort().join(",") === "count,reason,status" && data.count === null && data.status === "unavailable" && ["not_enrolled", "location_source_not_configured"].includes(data.reason));
  }
  return data;
}
const get = (a, p, e = 200, l = p) => req(a, "GET", p, undefined, e, l);
const choice = (a, enrolled, e = 200) => req(a, "PUT", "/radar/participation", { enrolled }, e, "explicit own participation");
const card = (a, body) => req(a, "PUT", "/cards/me", body);
async function guest(a) {
  s.tokens[a] = (await req("none", "POST", "/auth/guest", undefined, 201, "independent guest " + a)).guest_token;
  s.owners[a] = (await db.query('SELECT id FROM "MbtiGuest" WHERE "tokenHash"=$1', [createHash("sha256").update(s.tokens[a]).digest("hex")])).rows[0].id;
}
const enrolled = async (a, value) => ok("committed own choice matches", (await get(a, "/radar/participation")).enrolled === value);
async function unavailable(a, reason, suffix = "") {
  ok("explicit unavailable reason", (await get(a, "/radar/same-type" + suffix)).reason === reason);
}
async function snapshot(a) {
  const owner = s.owners[a];
  // Auxiliary integrity read, never an endpoint/cohort aggregation.
  return (await db.query(`SELECT row_to_json(c) card,
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM "MbtiResult" r WHERE r."ownerId"=$1) results,
    (SELECT row_to_json(p) FROM "MbtiPrivateContacts" p WHERE p."ownerId"=$1) contacts
    FROM "MbtiCard" c WHERE c."ownerId"=$1`, [owner])).rows[0];
}
async function noLazy(a) {
  const cardRows = await db.query('SELECT id FROM "MbtiCard" WHERE "ownerId"=$1', [s.owners[a]]);
  const participation = await db.query('SELECT "ownerId" FROM "MbtiRadarParticipation" WHERE "ownerId"=$1', [s.owners[a]]);
  ok("GET creates neither card nor participation", cardRows.rows.length === 0 && participation.rows.length === 0);
}
try {
  if (phase === "restart") {
    for (const [a, value] of [["A", true], ["B", false], ["C", false]]) {
      await enrolled(a, value);
      if (a !== "C") ok("original card/history/contact metadata unchanged", JSON.stringify(await snapshot(a)) === JSON.stringify(s.snapshots[a]));
    }
    await noLazy("C");
    await unavailable("A", "location_source_not_configured");
    await unavailable("B", "not_enrolled");
    ok("new-cohort F5 grant survives restart", (await get("X", "/contact-requests/" + s.contactRequest + "/granted")).channels[0].value === s.contact);
    await get("Y", "/contact-requests/" + s.contactRequest + "/granted", 404);
    await get("C", "/contact-requests/" + s.contactRequest + "/granted", 404);
    ok("new-cohort F5 own private value survives restart", (await get("Y", "/contacts/me")).wechat === s.contact);
  } else {
    for (const a of ["A", "B", "C"]) { await guest(a); await enrolled(a, false); await noLazy(a); }
    for (const a of ["A", "B"]) {
      ok("no-card join rejected", (await choice(a, true, 422)).code === "RADAR_TYPE_REQUIRED");
      await noLazy(a);
      await choice(a, false); await enrolled(a, false);
    }
    // A latest result does not supply an absent card's type.
    await req("C", "POST", "/results", { source: "self_select", type_code: "INFP" }, 201, "latest result without card");
    ok("same-type does not infer from query/latest result", (await get("C", "/radar/same-type?type_code=INFP", 422)).code === "RADAR_TYPE_REQUIRED");
    await noLazy("C");
    // GET cards/me is intentionally invoked only for B to create its existing empty-type card.
    s.cards.B = (await get("B", "/cards/me")).id;
    ok("empty-type card join rejected", (await choice("B", true, 422)).code === "RADAR_TYPE_REQUIRED");
    await choice("B", false);
    for (const a of ["A", "B"]) {
      s.cards[a] = (await card(a, { type_code: "INFP", discoverable: false,
        visibility: { name: false, interests: false, declaration: false, manual: false } })).id;
      s.snapshots[a] = await snapshot(a);
      await unavailable(a, "not_enrolled");
      ok("private legal card can explicitly join", (await choice(a, true)).enrolled === true);
      ok("join leaves card/history/contacts unchanged", JSON.stringify(await snapshot(a)) === JSON.stringify(s.snapshots[a]));
    }
    await enrolled("C", false);
    const before = (await db.query('SELECT * FROM "MbtiRadarParticipation" WHERE "ownerId"=$1', [s.owners.A])).rows[0];
    await Promise.all(Array.from({ length: 8 }, () => choice("A", true)));
    const after = (await db.query('SELECT * FROM "MbtiRadarParticipation" WHERE "ownerId"=$1', [s.owners.A])).rows;
    ok("same-value concurrent PUT unique row and stable timestamps", after.length === 1 && JSON.stringify(before) === JSON.stringify(after[0]));
    // Deterministic real HTTP lock ordering: hold owner lock, queue true then false, release.
    const inspector = new pg.Client({ connectionString: env.TEST_DATABASE_URL }); await inspector.connect();
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["mbti-social-owner:" + s.owners.B]);
    const pid = (await db.query("SELECT pg_backend_pid() pid")).rows[0].pid;
    async function waiting(n) {
      for (let i = 0; i < 200; i++) {
        const rows = (await inspector.query(`SELECT w.pid FROM pg_locks w JOIN pg_locks held
          ON w.locktype=held.locktype AND w.classid=held.classid AND w.objid=held.objid AND w.objsubid=held.objsubid
          WHERE held.pid=$1 AND held.locktype='advisory' AND held.granted AND NOT w.granted`, [pid])).rows;
        if (rows.length === n) return;
        await new Promise(done => setTimeout(done, 10));
      }
      throw new Error("ordered HTTP requests did not wait on shared owner lock");
    }
    try {
      const first = choice("B", true); await waiting(1);
      const second = choice("B", false); await waiting(2);
      await db.query("COMMIT");
      ok("ordered concurrent responses are committed facts", (await first).enrolled === true && (await second).enrolled === false);
    } finally { await db.query("ROLLBACK"); await inspector.end(); }
    await enrolled("B", false);
    ok("ordered writes retain one owner row", (await db.query('SELECT "ownerId" FROM "MbtiRadarParticipation" WHERE "ownerId"=$1', [s.owners.B])).rows.length === 1);
    await enrolled("A", true); await enrolled("C", false);
    for (const body of [{}, { enrolled: "true" }, { enrolled: 1 }, { enrolled: null }, { enrolled: [] }, { enrolled: {} }, [],
      ...["ownerId", "owner_id", "guest_id", "buddy_id", "type_code", "radius_m", "location", "latitude", "longitude", "contact"].map(key => ({ enrolled: true, [key]: "synthetic" }))]) {
      ok("strict body rejection", (await req("B", "PUT", "/radar/participation", body, 422)).code === "INVALID_RADAR_INPUT");
    }
    for (const raw of ["null", "true", "1", '"true"', '{"enrolled":', '{"enrolled":true,}']) {
      ok("strict JSON400", (await req("A", "PUT", "/radar/participation", raw, 400, "strict JSON", true)).code === "INVALID_JSON");
    }
    for (const query of ["ownerId=synthetic", "owner_id=synthetic", "enrolled=true", "enrolled=true&enrolled=false", "radius_m=500", "__proto__=x"]) {
      for (const method of ["GET", "PUT"]) ok("participation no query", (await req("B", method, "/radar/participation?" + query,
        method === "PUT" ? { enrolled: true } : undefined, 422)).code === "INVALID_RADAR_INPUT");
    }
    const invalidQueries = ["radius_m=", "radius_m=0", "radius_m=-500", "radius_m=500.0", "radius_m=5e2", "radius_m=NaN", "radius_m=0500", "radius_m=501", "radius_m=+500", "radius_m=500&radius_m=500", "radius_m[]=500", "radius_m[x]=500", "type_code=", "type_code=infp", "type_code=XXXX", "type_code=INFP&type_code=INFP", "type_code[]=INFP", "location=x", "latitude=1", "ownerId=x", "__proto__=x"];
    for (const query of invalidQueries) ok("query structure before absent own type", (await get("C", "/radar/same-type?" + query, 422)).code === "INVALID_RADAR_INPUT");
    ok("missing own type before mismatch", (await get("C", "/radar/same-type?type_code=ESTJ", 422)).code === "RADAR_TYPE_REQUIRED");
    ok("mismatch before participation", (await get("B", "/radar/same-type?type_code=ESTJ", 422)).code === "RADAR_TYPE_MISMATCH");
    for (const a of ["A", "B"]) for (const suffix of ["", "?type_code=INFP", "?radius_m=500", "?radius_m=1000", "?radius_m=3000", "?type_code=INFP&radius_m=500"]) {
      await unavailable(a, a === "A" ? "location_source_not_configured" : "not_enrolled", suffix);
    }
    await card("A", { type_code: "ESTJ" });
    ok("old query invalid after current card change", (await get("A", "/radar/same-type?type_code=INFP", 422)).code === "RADAR_TYPE_MISMATCH");
    await unavailable("A", "location_source_not_configured", "?type_code=ESTJ");
    await unavailable("A", "location_source_not_configured");
    // Synthetic only: both block directions, both participation choices, every candidate tier.
    // This is unavailable/privacy evidence, NOT proof of filtering a real aggregation.
    for (const [from, to] of [["A", "B"], ["B", "A"]]) {
      await req(from, "POST", "/buddies/" + s.cards[to] + "/block", undefined);
      for (const value of [true, false]) {
        await choice("A", value);
        for (const radius of [500, 1000, 3000]) await unavailable("A", value ? "location_source_not_configured" : "not_enrolled", "?radius_m=" + radius);
      }
      await req(from, "DELETE", "/buddies/" + s.cards[to] + "/block", undefined, 204);
    }
    await choice("A", true); await choice("B", false);
    await guest("expired");
    await db.query('UPDATE "MbtiGuest" SET "expiresAt"=NOW()-INTERVAL \'1 second\' WHERE id=$1', [s.owners.expired]);
    s.tokens.invalid = randomBytes(48).toString("base64url"); s.tokens.malformed = "bad";
    for (const a of ["none", "invalid", "malformed", "expired"]) for (const [method, path, body] of [
      ["GET", "/radar/participation?ownerId=x", undefined], ["PUT", "/radar/participation", { enrolled: true }], ["GET", "/radar/same-type?radius_m=0", undefined]
    ]) ok("guard before query/type", (await req(a, method, path, body, 401)).code === "GUEST_UNAUTHORIZED");
    // Minimal F4/F5 live registration/read regression on a separate new cohort.
    for (const a of ["X", "Y"]) {
      await guest(a); s.cards[a] = (await card(a, { type_code: "INFP", discoverable: true })).id;
      ok("empty own contacts on new cohort", Object.keys(await get(a, "/contacts/me")).length === 0);
    }
    s.contact = "f6_" + randomBytes(8).toString("hex");
    await req("Y", "PUT", "/contacts/me", { wechat: s.contact });
    const exchange = await req("X", "POST", "/card-exchanges", { buddy_id: s.cards.Y }, 201);
    await req("Y", "POST", "/card-exchanges/" + exchange.id + "/respond", { action: "accept" });
    const contact = await req("X", "POST", "/contact-requests", { buddy_id: s.cards.Y, channels: ["wechat"] }, 201);
    s.contactRequest = contact.id;
    await req("Y", "POST", "/contact-requests/" + contact.id + "/respond", { action: "accept" });
    const metadata = (await db.query('SELECT * FROM "MbtiPrivateContacts" WHERE "ownerId"=$1', [s.owners.Y])).rows[0];
    for (const value of [true, false]) {
      await choice("X", value); await unavailable("X", value ? "location_source_not_configured" : "not_enrolled");
      const grant = await get("X", "/contact-requests/" + contact.id + "/granted");
      ok("F6 choice preserves exact F5 directional grant", grant.channels.length === 1 && grant.channels[0].channel === "wechat" && grant.channels[0].value === s.contact);
    }
    await get("Y", "/contact-requests/" + contact.id + "/granted", 404);
    await get("C", "/contact-requests/" + contact.id + "/granted", 404);
    ok("F6 leaves F5 private reference/epoch/time unchanged", JSON.stringify(metadata) === JSON.stringify((await db.query('SELECT * FROM "MbtiPrivateContacts" WHERE "ownerId"=$1', [s.owners.Y])).rows[0]));
    ok("F4 accepted exchange still readable", (await get("Y", "/card-exchanges")).items.some(item => item.id === exchange.id && item.status === "accepted"));
    ok("F5 request list still readable", (await get("Y", "/contact-requests")).items.some(item => item.id === contact.id && item.status === "accepted"));
    for (const origin of ["http://127.0.0.1:4155", "http://192.168.0.200:4155", "https://evil.invalid"]) {
      const r = await fetch(base + "/radar/participation", { method: "OPTIONS", headers: { Origin: origin,
        "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type,x-guest-token" } });
      ok("CORS exact permitted origins", r.status === 204 && r.headers.get("access-control-allow-origin") === (origin.includes("evil") ? null : origin));
    }
    for (const a of ["A", "B"]) {
      s.snapshots[a] = await snapshot(a);
      ok("private card remains private with four visibility false", !s.snapshots[a].card.discoverable &&
        ["visibilityName", "visibilityInterests", "visibilityDeclaration", "visibilityManual"].every(key => s.snapshots[a].card[key] === false));
    }
    await enrolled("A", true); await enrolled("B", false); await enrolled("C", false); await noLazy("C");
    writeFileSync(statePath, JSON.stringify(s), { mode: 0o600 }); chmodSync(statePath, 0o600);
  }
  const path = resolve(directory, `mbti-f6-${phase}-evidence.json`);
  writeFileSync(path, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`PASS F6 ${phase}: ${report.checks.length} real HTTP, ${report.assertions.length} assertions; sanitized evidence ${path}; real aggregation blocked`);
} finally { await db.end(); }
