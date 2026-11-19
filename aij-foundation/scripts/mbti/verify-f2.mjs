// Real Nest/Prisma/PostgreSQL checks. Never operates on the development database.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import runtimeEnvironment from "../runtime-environment.cjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ownerRoot = resolve(process.env.MBTI_LOCAL_OWNER_ROOT || root);
const env = parseEnv(readFileSync(resolve(ownerRoot, ".local-data/mbti-foundation/test/.env"), "utf8"));
assert.equal(env.PROJECT_ID, "mbti-foundation"); assert.equal(env.APP_ENV, "test");
assert.deepEqual(runtimeEnvironment.resolveRuntimeEnvironment(env).databaseTarget,
  { host: "127.0.0.1", port: 55437, database: "mbti_foundation_test", user: "mbti_foundation_test" });
const db = new pg.Client({ connectionString: env.TEST_DATABASE_URL });
const base = "http://127.0.0.1:4156/api/v1";
const statePath = resolve(root, ".artifacts/mbti-f2-restart.json");
const mode = process.argv[2] || "verify";
assert.ok(["verify", "prepare-restart", "verify-restart"].includes(mode));
let checks = 0;
async function call(method, path, expected, token, body, extraHeaders = {}) {
  const response = await fetch(base + path, { method, headers: { ...extraHeaders,
    ...(token ? { "X-Guest-Token": token } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" })
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok([expected].flat().includes(response.status), `${method} ${path}: ${response.status}`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (response.status === 204) assert.equal(text, "");
  if (response.status >= 400) {
    assert.equal(typeof data.code, "string"); assert.equal(typeof data.message, "string");
    assert.ok(!("data" in data));
  }
  checks++;
  return { status: response.status, data };
}
async function image(url, expected = 200) {
  const response = await fetch(url); // No identity headers, cookies or redirects from private APIs.
  assert.equal(response.status, expected);
  assert.equal(response.headers.get("cache-control"), "no-store");
  checks++;
  if (expected !== 200) { assert.equal((await response.json()).code, "NOT_FOUND"); return; }
  assert.equal(response.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), "sandbox; default-src 'none'");
  assert.equal(response.headers.get("set-cookie"), null);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(Number(response.headers.get("content-length")), bytes.length);
  assert.ok(bytes.length > 1000 && bytes.length < 65536);
  assert.match(bytes.toString(), /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.doesNotMatch(bytes.toString(), /<script|foreignObject|href=|<image|onload=/i);
  return bytes;
}
const comparePath = (a, b) => "/results/compare?" + new URLSearchParams({ baseline_id: a, target_id: b });
await db.connect();
try {
  assert.deepEqual((await db.query('SELECT current_database() AS db,current_user AS role')).rows[0],
    { db: "mbti_foundation_test", role: "mbti_foundation_test" });
  const marker = (await db.query('SELECT project,environment,root FROM mbti_local_control."_mbti_project_identity" WHERE singleton=true')).rows[0];
  assert.deepEqual(marker, { project: "mbti-foundation", environment: "test", root: ownerRoot });
  if (mode === "verify-restart") {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.deepEqual((await call("GET", "/results/" + state.quiz.id, 200, state.a)).data, state.quiz);
    assert.deepEqual((await call("GET", "/results/" + state.self.id, 200, state.a)).data, state.self);
    await call("GET", "/results/" + state.quiz.id, 404, state.b);
    await call("GET", "/results/" + state.deletedId, 404, state.a);
    await call("POST", `/quiz/sessions/${state.quiz.session_id}/submit`, 409, state.a);
    const draft = (await call("PUT", `/quiz/sessions/${state.draftId}/answers`, 200, state.a, { answers: [] })).data;
    assert.equal(draft.answers.length, 2);
    assert.equal(createHash("sha256").update(await image(state.asset)).digest("hex"), state.imageHash);
    await image(state.deletedAsset, 404);
    const ids = (await call("GET", "/results", 200, state.a)).data.items.map(item => item.id);
    assert.ok(ids.includes(state.quiz.id) && ids.includes(state.self.id) && !ids.includes(state.deletedId));
    console.log(`PASS F2 restart checks=${checks}; same guests, quiz/self-select snapshots, two-answer draft, image bytes and revoked/deleted state survived`);
  } else {
    const guest = async () => (await call("POST", "/auth/guest", 201)).data.guest_token;
    const a = await guest(), b = await guest();
    for (const [method, path] of [["POST", "/results"], ["DELETE", "/results/missing"], ["GET", "/results/compare"], ["GET", "/types"], ["POST", "/share/preview"]]) await call(method, path, 401);
    const listed = (await call("GET", "/types", 200, a)).data.items;
    assert.equal(listed.length, 16); assert.equal(new Set(listed.map(item => item.type_code)).size, 16);
    for (const item of listed) { assert.match(item.type_code, /^[EI][SN][TF][JP]$/); assert.match(item.name_zh, /[\u4e00-\u9fff]/); assert.ok(item.tagline); }
    const takeQuiz = async (filename, index) => {
      const bank = JSON.parse(readFileSync(resolve(root, "scripts/mbti", filename), "utf8"));
      const session = (await call("POST", "/quiz/sessions", 201, a, { question_bank_version: bank.question_bank_version })).data;
      await call("PUT", `/quiz/sessions/${session.id}/answers`, 200, a, { answers: bank.questions.map(q => ({ question_id: q.id, option_id: q.options[index].id })) });
      return (await call("POST", `/quiz/sessions/${session.id}/submit`, 201, a, { life_stage: "private-stage", recent_status: "private-status" })).data;
    };
    const first = await takeQuiz("quiz-prototype-1.json", 0), second = await takeQuiz("quiz-prototype-1.json", 1);
    const old = await takeQuiz("quiz-teach-1.json", 0);
    assert.equal(first.type_code, "ESTJ"); assert.equal(second.type_code, "INFP");
    const compared = (await call("GET", comparePath(first.id, second.id), 200, a)).data;
    assert.equal(compared.type_changed, true);
    assert.deepEqual(compared.dimension_deltas, { E: -3, I: 3, S: -3, N: 3, T: -3, F: 3, J: -3, P: 3 });
    await call("GET", comparePath(first.id, old.id), 422, a);
    await call("GET", comparePath(old.id, first.id), 422, a);
    await call("GET", comparePath(first.id, second.id), 404, b);
    await call("GET", "/results/compare", 422, a);
    await call("GET", "/results/compare?baseline_id=x&baseline_id=y&target_id=z", 422, a);
    await call("GET", "/results/not-a-result", 404, a);
    const chosen = (await call("POST", "/results", 201, a, { source: "self_select", type_code: "INFP", life_stage: "private-stage", recent_status: "contact-canary-13800000000",
      dimension_counts: { E: 3 }, session_id: first.session_id, question_bank_version: first.question_bank_version, ownerId: "injected" })).data;
    assert.equal(chosen.source, "self_select"); assert.equal(chosen.question_bank_version, "self-select-v1");
    assert.ok(!("dimension_counts" in chosen) && !("session_id" in chosen));
    const stored = (await db.query('SELECT "sessionId","dimensionCounts" FROM "MbtiResult" WHERE id=$1', [chosen.id])).rows[0];
    assert.deepEqual(stored, { sessionId: null, dimensionCounts: null });
    for (const input of [{ type_code: "XXXX", source: "self_select" }, { type_code: "INFP", source: "quiz" }, { type_code: "infp", source: "self_select" }]) await call("POST", "/results", 422, a, input);
    await call("GET", comparePath(chosen.id, first.id), 422, a);
    // Own incomparable snapshot + somebody else's snapshot must produce 404 in BOTH positions.
    const ownB = (await call("POST", "/results", 201, b, { source: "self_select", type_code: "INTJ" })).data;
    for (const [left, right] of [[ownB.id, first.id], [first.id, ownB.id]]) await call("GET", comparePath(left, right), 404, b);
    for (const id of [first.id, chosen.id]) {
      await call("DELETE", "/results/" + id, 404, b);
      await call("POST", "/share/preview", 404, b, { result_id: id, scene: "invalid" });
    }
    for (const scene of ["invalid", "__proto__", {}, []]) await call("POST", "/share/preview", 422, a, { result_id: chosen.id, scene });
    await call("POST", "/share/preview", 422, a, { result_id: chosen.id, template_id: "<script>alert(1)</script>" });
    let asset, imageHash;
    for (const scene of ["moments", "avatar", "meet_card"]) {
      const share = (await call("POST", "/share/preview", 200, a, { result_id: chosen.id, scene }, { Host: "untrusted.invalid" })).data;
      assert.equal(share.status, "ready"); assert.equal(new URL(share.preview_url).hostname, "192.168.0.200");
      const bytes = await image(share.preview_url), text = bytes.toString();
      assert.match(text, /INFP/); assert.match(text, /调停者/);
      assert.match(text, new RegExp(`height="${scene === "avatar" ? 1080 : 1440}"`));
      for (const privateValue of [a, b, first.id, chosen.id, first.session_id, first.question_bank_version, "private-stage", "contact-canary", "13800000000", "question_id", "option_id", "dimension_counts", "ownerId", "tokenHash", "guest_token"]) assert.ok(!text.includes(privateValue) && !share.preview_url.includes(privateValue));
      const key = new URL(share.preview_url).pathname.split("/").pop().slice(0, -4);
      assert.deepEqual((await db.query('SELECT bytes FROM "MbtiShareAsset" WHERE key=$1', [key])).rows[0].bytes, bytes);
      await assert.rejects(db.query('UPDATE "MbtiShareAsset" SET bytes=bytes WHERE key=$1', [key]));
      if (!asset) { asset = share.preview_url; imageHash = createHash("sha256").update(bytes).digest("hex"); }
    }
    await call("GET", "/share/assets/" + first.id + ".svg", 404);
    await call("GET", "/share/assets/" + "0".repeat(64) + ".svg", 404);
    await call("GET", "/results?asset=" + new URL(asset).pathname.split("/").pop(), 401);
    // Inject a REAL PostgreSQL storage rejection only for this script's own result.
    assert.match(chosen.id, /^[a-f0-9-]{36}$/);
    const fault = "mbti_f2_test_" + randomBytes(8).toString("hex");
    try {
      await db.query(`CREATE FUNCTION ${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."resultId"='${chosen.id}' THEN RAISE EXCEPTION 'test share storage unavailable'; END IF; RETURN NEW; END $$`);
      await db.query(`CREATE TRIGGER ${fault} BEFORE INSERT ON "MbtiShareAsset" FOR EACH ROW EXECUTE FUNCTION ${fault}()`);
      const failed = (await call("POST", "/share/preview", 503, a, { result_id: chosen.id })).data;
      assert.equal(failed.code, "SHARE_PREVIEW_UNAVAILABLE"); assert.deepEqual(Object.keys(failed).sort(), ["code", "message"]);
    } finally {
      await db.query(`DROP TRIGGER IF EXISTS ${fault} ON "MbtiShareAsset"`);
      await db.query(`DROP FUNCTION IF EXISTS ${fault}()`);
    }
    const retry = (await call("POST", "/share/preview", 200, a, { result_id: chosen.id })).data;
    await image(retry.preview_url);
    const deletedAsset = (await call("POST", "/share/preview", 200, a, { result_id: old.id })).data.preview_url;
    await call("DELETE", "/results/" + old.id, 204, a);
    await call("GET", "/results/" + old.id, 404, a);
    await call("DELETE", "/results/" + old.id, 404, a);
    await call("POST", "/share/preview", 404, a, { result_id: old.id });
    await call("POST", `/quiz/sessions/${old.session_id}/submit`, 409, a);
    await call("GET", comparePath(first.id, old.id), 404, a);
    await image(deletedAsset, 404);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "MbtiShareAsset" WHERE "resultId"=$1', [old.id])).rows[0].n, 0);
    const remaining = (await call("GET", "/results", 200, a)).data.items;
    assert.deepEqual(new Set(remaining.map(item => item.id)), new Set([first.id, second.id, chosen.id]));
    assert.ok(!("dimension_counts" in remaining.find(item => item.id === chosen.id)));
    const draft = (await call("POST", "/quiz/sessions", 201, a)).data;
    await call("PUT", `/quiz/sessions/${draft.id}/answers`, 200, a, { answers: [{ question_id: "q1", option_id: "e" }, { question_id: "q2", option_id: "s" }] });
    if (mode === "prepare-restart") {
      mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
      writeFileSync(statePath, JSON.stringify({ a, b, quiz: first, self: chosen, deletedId: old.id, draftId: draft.id, asset, deletedAsset, imageHash }), { mode: 0o600 });
    }
    console.log(`PASS F2 checks=${checks}; cross-version 422, ownership-before-comparability 404, no fabricated self-select counts, 3 real SVG scenes, privacy, 503 storage failure/retry, quiz delete and asset revocation; result IDs ${first.id}/${second.id}`);
  }
} finally { await db.end(); }
