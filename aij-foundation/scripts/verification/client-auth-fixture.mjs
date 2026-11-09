// Synthetic AF-025-A acceptance only; no customer registration or production Seed.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { acceptanceRecord, assertLocalPath, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { seedDatabase } from "../database/seed.mjs";
import { authEnvironment, authKeys } from "./auth-support.mjs";

export const clientTask = "AF-025-A";
export const clientLifecycleTask = "AF-039";
const clientFixtureTasks = [clientTask, clientLifecycleTask, "AF-047", "AF-048", "AF-054", "AF-055", "AF-056", "AF-089", "AF-104", "AF-105", "AF-108", "AF-109", "AF-110", "AF-111", "AF-112", "AF-113", "AF-114", "AF-115", "AF-116", "AF-118", "AF-119", "AF-120", "AF-121", "AF-122", "AF-123", "AF-124", "AF-138", "AF-141", "AF-142", "AF-145", "AF-146", "AF-151", "AF-149", "AF-150", "AF-154", "AF-158", "AF-159", "AF-161", "AF-162", "AF-163", "AF-166", "AF-165", "AF-167", "AF-170", "AF-169", "AF-173", "AF-177", "AF-178", "AF-179", "AF-181", "AF-182", "AF-189", "AF-190", "AF-198", "AF-201", "AF-202", "AF-203", "AF-205", "AF-206", "AF-207", "AF-209", "AF-210", "AF-211", "AF-214", "AF-215", "AF-191", "AF-221", "AF-223", "AF-224", "AF-225", "AF-227", "AF-228", "AF-229", "AF-232", "AF-213", "AF-218", "AF-217"];
const require = createRequire(join(repositoryRoot, "apps/api/package.json")), bcrypt = require("bcryptjs");
function localJson(id, name, create, task = clientTask) {
  const lease = acceptanceRecord("test", id); assert.equal(lease.task, task);
  const directory = join(repositoryRoot, ".local-data/auth/test", lease.database), file = join(directory, name);
  assertLocalPath(file); execFileSync("git", ["--no-optional-locks", "check-ignore", "--quiet", file], { cwd: repositoryRoot });
  if (!existsSync(file)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify({ task, repository: repositoryRoot, database: lease.database, instanceId: lease.instanceId, ...create() }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
  const value = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(value.task, task); assert.equal(value.repository, repositoryRoot); assert.equal(value.database, lease.database); assert.equal(value.instanceId, lease.instanceId);
  return { file, value };
}
export function clientKeys(id, task = clientTask) {
  const keys = localJson(id, "client-keys.json", () => ({ CLIENT_JWT_SECRET: randomBytes(32).toString("hex"), CLIENT_AUTH_RATE_LIMIT_SECRET: randomBytes(32).toString("hex"), CLIENT_AUTH_TOKEN_SECRET: randomBytes(32).toString("hex") }), task);
  // Existing ignored fixtures are augmented once; never rotate a previously
  // written acceptance secret implicitly.
  if (typeof keys.value.CLIENT_AUTH_TOKEN_SECRET !== "string" || keys.value.CLIENT_AUTH_TOKEN_SECRET.length < 32) {
    keys.value.CLIENT_AUTH_TOKEN_SECRET = randomBytes(32).toString("hex");
    writeFileSync(keys.file, JSON.stringify(keys.value, null, 2) + "\n", { mode: 0o600 });
  }
  return keys;
}
export function clientEnvironment(id, task = clientTask) {
  const keys = authKeys(id, task), client = clientKeys(id, task);
  return { ...authEnvironment(id, keys.secret, task), CLIENT_AUTH_ENABLED: "true", CLIENT_JWT_SECRET: client.value.CLIENT_JWT_SECRET,
    CLIENT_AUTH_RATE_LIMIT_SECRET: client.value.CLIENT_AUTH_RATE_LIMIT_SECRET, CLIENT_AUTH_TOKEN_SECRET: client.value.CLIENT_AUTH_TOKEN_SECRET };
}
export async function prepareClientFixture(id, task = clientTask, { fileManagement = false, menuManagement = false, configuration = false, secrets = false, runtimeManagement = false, aiCenter = false, pluginManagement = false } = {}) {
  const lease = acceptanceRecord("test", id); assert.ok(clientFixtureTasks.includes(task)); assert.equal(lease.task, task);
  const seed = await seedDatabase({ mode: "test", acceptanceId: id, generateCredentials: true, auditLogs: true, fileManagement, menuManagement, configuration, secrets, runtimeManagement, aiCenter, pluginManagement,
    ...(task === "AF-089" ? { clientManagement: true, clientSessionManagement: true } : {}) });
  const prefix = task.toLowerCase().replaceAll("-", "");
  const credential = localJson(id, "client-accounts.json", () => ({ accounts: ["member", "other"].map(name => ({ id: randomUUID(), email: prefix + "-" + name + "@example.test", username: prefix + "-" + name, password: "C9-" + randomBytes(24).toString("hex") })) }), task);
  assert.equal(credential.value.accounts.length, 2);
  await withDatabase("test", readDatabaseEnvironment("test", process.env, id), async client => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('aij-af025a-fixture'))");
      const rows = (await client.query("SELECT id,email FROM public.member_user WHERE email=ANY($1::text[])", [credential.value.accounts.map(a => a.email)])).rows;
      if (rows.length) {
        assert.equal(rows.length, 2, "Partial fixture requires review, no reset");
        for (const account of credential.value.accounts) assert.ok(rows.some(row => row.id === account.id && row.email === account.email), "Existing member ownership mismatch, no adoption");
      } else for (const account of credential.value.accounts) {
        await client.query("INSERT INTO public.member_user (id,username,email,nickname,password_hash,updated_at) VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)",
          [account.id, account.username, account.email, "AIJ synthetic member", await bcrypt.hash(account.password, 12)]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  }, { acceptanceId: id });
  return { seed, accounts: credential.value.accounts.map(a => ({ id: a.id, username: a.username, email: a.email, role: "customer", initialPasswordFile: credential.file })) };
}
