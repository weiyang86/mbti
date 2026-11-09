// Real HTTP + PostgreSQL checks, always against the project's isolated test instance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import runtimeEnvironment from "../runtime-environment.cjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const env = parseEnv(readFileSync(resolve(process.env.MBTI_LOCAL_OWNER_ROOT || root, ".local-data/mbti-foundation/test/.env"), "utf8"));
assert.equal(env.PROJECT_ID, "mbti-foundation"); assert.equal(env.APP_ENV, "test");
const runtime = runtimeEnvironment.resolveRuntimeEnvironment(env);
assert.deepEqual(runtime.databaseTarget, { host: "127.0.0.1", port: 55437, database: "mbti_foundation_test", user: "mbti_foundation_test" });
const db = new pg.Client({ connectionString: env.TEST_DATABASE_URL });
const base = "http://127.0.0.1:4156/api/v1";
let checks = 0;
async function call(method, path, expected, token, body) {
  const response = await fetch(base + path, { method, headers: { ...(token ? { "X-Guest-Token": token } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  assert.ok([expected].flat().includes(response.status), `${method} ${path}: ${response.status}`);
  if (response.status >= 400) { assert.equal(typeof data.code, "string"); assert.equal(typeof data.message, "string"); }
  checks++;
  return { status: response.status, data };
}
await db.connect();
try {
  const identity = (await db.query('SELECT current_database() AS db,current_user AS role')).rows[0];
  assert.deepEqual(identity, { db: "mbti_foundation_test", role: "mbti_foundation_test" });
  const guest = async () => (await call("POST", "/auth/guest", 201)).data.guest_token;
  const a = await guest(), b = await guest(); assert.notEqual(a, b);
  const digest = createHash("sha256").update(a).digest("hex");
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "MbtiGuest" WHERE "tokenHash"=$1', [digest])).rows[0].n, 1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "MbtiGuest" WHERE "tokenHash"=$1', [a])).rows[0].n, 0);
  for (const [method, path] of [["GET", "/results"], ["GET", "/quiz/versions/current"], ["POST", "/quiz/sessions"], ["PUT", "/quiz/sessions/nope/answers"], ["POST", "/quiz/sessions/nope/submit"], ["GET", "/results/nope"]]) await call(method, path, 401);
  await call("GET", "/results", 401, "x".repeat(64));
  const malformed = await fetch(base + "/auth/guest", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400); assert.equal((await malformed.json()).code, "INVALID_JSON"); checks++;

  const bank = (await call("GET", "/quiz/versions/current", 200, a)).data;
  assert.deepEqual(bank, JSON.parse(readFileSync(resolve(root, "scripts/mbti/quiz-prototype-1.json"), "utf8")));
  const answer = index => bank.questions.map(q => ({ question_id: q.id, option_id: q.options[index].id }));
  const create = async version => (await call("POST", "/quiz/sessions", 201, a, { question_bank_version: version ?? bank.question_bank_version })).data.id;
  await call("POST", "/quiz/sessions", 422, a, { question_bank_version: "does-not-exist" });
  const old = await create("qb-v0.4-teach-1"); assert.ok(old);
  const sid = await create(); const path = `/quiz/sessions/${sid}`;
  await call("PUT", path + "/answers", 404, b, { answers: answer(0) });
  await call("POST", path + "/submit", 404, b);
  await call("POST", path + "/submit", 422, a);
  for (const answers of [[{ question_id: "q13", option_id: "e" }], [{ question_id: "__proto__", option_id: "constructor" }], [{ question_id: "q1", option_id: "i" }, { question_id: "q1", option_id: "e" }], [{ question_id: "q1", option_id: "s" }]]) await call("PUT", path + "/answers", 422, a, { answers });
  await call("PUT", path + "/answers", 200, a, { answers: answer(1).slice(0, 1) });
  const partial = (await call("PUT", path + "/answers", 200, a, { answers: answer(0).slice(1) })).data;
  assert.equal(partial.answers.length, 12); assert.equal(partial.answers[0].option_id, "i");
  await call("PUT", path + "/answers", 200, a, { answers: answer(0) });
  // Both HTTP requests compete; the committed transaction is the only snapshot writer.
  const raced = await Promise.all([call("POST", path + "/submit", [201, 409], a), call("POST", path + "/submit", [201, 409], a)]);
  assert.deepEqual(raced.map(r => r.status).sort(), [201, 409]);
  const result = raced.find(r => r.status === 201).data; assert.equal(result.type_code, "ESTJ");
  await call("PUT", path + "/answers", 409, a, { answers: answer(1) });
  assert.deepEqual((await call("GET", "/results/" + result.id, 200, a)).data, result);
  await call("GET", "/results/" + result.id, 404, b);
  assert.deepEqual((await call("GET", "/results", 200, b)).data, { items: [], next_cursor: null });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "MbtiResult" WHERE "sessionId"=$1', [sid])).rows[0].n, 1);
  assert.equal((await db.query('SELECT "status" FROM "MbtiQuizSession" WHERE id=$1', [sid])).rows[0].status, "submitted");
  // Direct database updates cannot alter a published bank, snapshot or submitted answers/session.
  for (const [sql, args] of [
    ['UPDATE "MbtiQuestionBank" SET payload=payload WHERE version=$1', [bank.question_bank_version]],
    ['UPDATE "MbtiResult" SET "typeCode"=\'INFP\' WHERE id=$1', [result.id]],
    ['UPDATE "MbtiAnswer" SET "optionId"=\'i\' WHERE "sessionId"=$1 AND "questionId"=\'q1\'', [sid]],
    ['UPDATE "MbtiQuizSession" SET status=\'in_progress\' WHERE id=$1', [sid]]
  ]) await assert.rejects(db.query(sql, args));
  const second = await create();
  await call("PUT", `/quiz/sessions/${second}/answers`, 200, a, { answers: answer(1) });
  const secondResult = (await call("POST", `/quiz/sessions/${second}/submit`, 201, a)).data;
  assert.equal(secondResult.type_code, "INFP"); assert.notEqual(result.id, secondResult.id);
  const firstPage = (await call("GET", "/results?limit=1", 200, a)).data;
  const secondPage = (await call("GET", "/results?limit=1&cursor=" + firstPage.next_cursor, 200, a)).data;
  assert.notEqual(firstPage.items[0].id, secondPage.items[0].id); assert.equal(secondPage.next_cursor, null);
  await call("GET", "/results?cursor=" + result.id, 422, b);
  for (const limit of ["0", "101", "1.5", "NaN", "1&limit=2"]) await call("GET", "/results?limit=" + limit, 422, a);
  // Save and submit compete on the same row. Snapshot must reflect the saved final database answers.
  const contested = await create(), contestedPath = `/quiz/sessions/${contested}`;
  await call("PUT", contestedPath + "/answers", 200, a, { answers: answer(0) });
  const [save, submit] = await Promise.all([call("PUT", contestedPath + "/answers", [200, 409], a, { answers: answer(1) }), call("POST", contestedPath + "/submit", 201, a)]);
  assert.equal(submit.data.type_code, save.status === 200 ? "INFP" : "ESTJ");
  const stored = (await db.query('SELECT "optionId" FROM "MbtiAnswer" WHERE "sessionId"=$1 AND "questionId"=\'q1\'', [contested])).rows[0];
  assert.equal(stored.optionId, submit.data.type_code === "INFP" ? "i" : "e");
  await db.query('UPDATE "MbtiGuest" SET "expiresAt"=CURRENT_TIMESTAMP-interval \'1 second\' WHERE "tokenHash"=$1', [digest]);
  await call("GET", "/results", 401, a);
  console.log(`PASS F1 isolated-test HTTP checks=${checks}; digest-only credentials, expired/invalid/missing 401, A/B 404, golden ESTJ/INFP, cursor isolation, submit 201+409, save/submit lock, DB immutability`);
} finally { await db.end(); }
