// Project-only test fixture guard. Never accepts a development database.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { parseEnv } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import runtimeEnvironment from "../runtime-environment.cjs";
export const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
export const fixturePath = resolve(root, ".artifacts/mbti-f3-test-fixture.json");
export async function testContext() {
  const ownerRoot = realpathSync(process.env.MBTI_LOCAL_OWNER_ROOT || root);
  const check = spawnSync(process.execPath, [resolve(root, "scripts/mbti-local.mjs"), "check", "test"], { env: process.env, encoding: "utf8" });
  assert.equal(check.status, 0, "mbti-local same-project/container/marker check must pass");
  const env = parseEnv(readFileSync(resolve(ownerRoot, ".local-data/mbti-foundation/test/.env"), "utf8"));
  assert.equal(env.PROJECT_ID, "mbti-foundation"); assert.equal(env.APP_ENV, "test");
  assert.deepEqual(runtimeEnvironment.resolveRuntimeEnvironment(env).databaseTarget,
    { host: "127.0.0.1", port: 55437, database: "mbti_foundation_test", user: "mbti_foundation_test" });
  const db = new pg.Client({ connectionString: env.TEST_DATABASE_URL }); await db.connect();
  assert.deepEqual((await db.query('SELECT current_database() AS db,current_user AS role')).rows[0], { db: "mbti_foundation_test", role: "mbti_foundation_test" });
  assert.deepEqual((await db.query('SELECT project,environment,root FROM mbti_local_control."_mbti_project_identity" WHERE singleton=true')).rows[0],
    { project: "mbti-foundation", environment: "test", root: ownerRoot });
  return { db, env, ownerRoot };
}
