import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createAcceptance, migrate } from "../database/migration.mjs";
import { profile, readDatabaseEnvironment, repositoryRoot, withDatabase } from "../database/connection.mjs";
import { seedIdentity, validateInitialPassword } from "../database/seed.mjs";

const require = createRequire(join(repositoryRoot, "apps/api/package.json")), bcrypt = require("bcryptjs"), { Prisma } = require("@prisma/client");
const hash = p => createHash("sha256").update(readFileSync(p)).digest("hex");
const randomSecret = () => "T7-" + randomBytes(24).toString("hex");
test("real protected Seed: persistence, idempotency, changed credentials/roles and no business records", { timeout: 55000 }, async t => {
  const parent = join(repositoryRoot, ".artifacts/af-012/integration"); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "run-")); let sequence = 0, main, manual, collision, generated, changedSecret;
  const secrets = ["dev", "test"].map(mode => readFileSync(profile(mode).secretFile, "utf8").trim());
  const protectedPaths = ["apps/api/prisma/schema.prisma", "apps/api/prisma/migrations/20261019000000_initial/migration.sql", "scripts/database/seed.mjs", "scripts/db-seed.mjs", ...["dev", "test"].flatMap(mode => [profile(mode).secretFile, profile(mode).stateFile, profile(mode).environmentFile])];
  const beforeHashes = protectedPaths.map(hash);
  const save = (name, value) => writeFileSync(join(root, name + ".json"), JSON.stringify(value, null, 2) + "\n");
  const query = (lease, operation) => withDatabase("test", readDatabaseEnvironment("test", process.env, lease.id), operation, { acceptanceId: lease.id });
  function run(lease, flags = [], expected = 0, extra = {}) {
    const command = ["pnpm", "run", "db:seed", "--", "test", "--acceptance", lease.id, ...flags];
    const child = spawnSync(command[0], command.slice(1), { cwd: repositoryRoot, encoding: "utf8", timeout: 15000, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "test", ...extra } });
    const output = child.stdout + child.stderr;
    for (const secret of secrets) assert.ok(!output.includes(secret), "No credential in child output");
    assert.ok(!/\$2[aby]\$\d\d\$/.test(output), "No password hash in output");
    assert.equal(child.status, expected, "Seed child exited unexpectedly; sanitized per-command evidence retained");
    save(String(++sequence).padStart(3, "0"), { command, exitCode: child.status, stdout: child.stdout, stderr: child.stderr });
    const line = (expected === 0 ? child.stdout : child.stderr).split("\n").find(line => line.startsWith("{"));
    assert.ok(line, "Expected a sanitized JSON result from the root command");
    return JSON.parse(line);
  }
  async function snapshot(lease) {
    return query(lease, async client => {
      const rows = {};
      for (const m of Prisma.dmmf.datamodel.models) rows[m.dbName] = (await client.query('SELECT to_jsonb(t)-\'password_hash\' AS value FROM public."' + m.dbName + '" t ORDER BY id')).rows.map(r => r.value);
      return rows;
    });
  }
  async function original(mode) {
    return withDatabase(mode, readDatabaseEnvironment(mode), async client => ({
      tables: (await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT LIKE 'pg_%' AND schemaname<>'information_schema' ORDER BY 1,2")).rows,
      sentinel: (await client.query("SELECT id,mode,instance_id,marker,created_at FROM af005_verification.sentinel ORDER BY id")).rows
    }));
  }
  const originals = { dev: await original("dev"), test: await original("test") };
  await t.test("own new empty target rejects Seed until real migration status is current", async () => {
    main = await createAcceptance("test", "AF-012"); save("lease", main);
    const secret = randomSecret(); secrets.push(secret);
    const result = run(main, [], 1, { AIJ_INITIAL_ADMIN_PASSWORD: secret }); assert.equal(result.status, "REJECTED");
    await query(main, async client => assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'")).rows[0].count, 0));
    assert.equal((await migrate({ mode: "test", action: "deploy", acceptanceId: main.id })).exitCode, 0);
  });
  await t.test("missing/template/legacy-only and conflicting input all reject with no product writes", async () => {
    assert.equal(run(main, [], 2).code, "CREDENTIAL_MISSING");
    assert.equal(run(main, [], 2, { AIJ_INITIAL_ADMIN_PASSWORD: "Replace-Template-2026-Not-Allowed!" }).code, "CREDENTIAL_INVALID");
    assert.equal(run(main, [], 2, { INITIAL_ADMIN_PASSWORD: randomSecret() }).code, "CREDENTIAL_MISSING");
    assert.equal(run(main, ["--generate-credentials"], 2, { AIJ_INITIAL_ADMIN_PASSWORD: randomSecret() }).code, "CREDENTIAL_INPUT_CONFLICT");
    const rows = await snapshot(main); assert.ok(Object.values(rows).every(v => v.length === 0));
  });
  let firstSnapshot, firstHash, credentialFileHash;
  await t.test("explicit generation persists only ignored initial credentials, bcrypt12 and seven minimal rows", async () => {
    const result = run(main, ["--generate-credentials"]); assert.equal(result.admin.action, "created"); assert.equal(result.menusCreated, 0);
    assert.equal(result.credentials.source, "generated-local");
    generated = JSON.parse(readFileSync(result.credentials.file, "utf8")); validateInitialPassword(generated.password); secrets.push(generated.password);
    credentialFileHash = hash(result.credentials.file);
    const ignored = spawnSync("git", ["--no-optional-locks", "check-ignore", "--quiet", result.credentials.file], { cwd: repositoryRoot }); assert.equal(ignored.status, 0);
    firstHash = await query(main, async client => (await client.query("SELECT password_hash FROM public.sys_user WHERE username=$1", [seedIdentity.username])).rows[0].password_hash);
    assert.equal(bcrypt.getRounds(firstHash), 12); assert.ok(await bcrypt.compare(generated.password, firstHash)); assert.ok(!(await bcrypt.compare(randomSecret(), firstHash)));
    firstSnapshot = await snapshot(main);
    const expected = { organization_profile: 1, project_profile: 1, sys_user: 1, sys_role: 1, sys_permission: 1, sys_user_role: 1, sys_role_permission: 1 };
    for (const [table, rows] of Object.entries(firstSnapshot)) assert.equal(rows.length, expected[table] || 0, table);
    assert.equal(firstSnapshot.sys_permission[0].api_path, null); assert.equal(firstSnapshot.sys_permission[0].resource_type, "data");
    save("first", { result, rows: firstSnapshot, bcryptVerified: true, passwordOrHashLogged: false });
  });
  await t.test("second Seed preserves row counts, IDs, timestamps, hash and initial file bytes", async () => {
    const result = run(main); assert.equal(result.admin.action, "preserved"); assert.equal(result.admin.rolesTouched, false);
    assert.deepEqual(await snapshot(main), firstSnapshot);
    const unchanged = await query(main, async client => (await client.query("SELECT password_hash FROM public.sys_user WHERE username=$1", [seedIdentity.username])).rows[0].password_hash === firstHash); assert.ok(unchanged);
    assert.equal(hash(result.credentials.file), credentialFileHash); save("second", { result, rowsStable: true, hashStable: true, credentialFileStable: true });
  });
  await t.test("manual password/status/profile/role changes and revoked grants are not undone", async () => {
    changedSecret = randomSecret(); secrets.push(changedSecret); const passwordHash = await bcrypt.hash(changedSecret, 12);
    await query(main, async client => {
      await client.query("BEGIN");
      try {
        await client.query("UPDATE public.sys_user SET password_hash=$1,real_name='AF012 changed',status='disabled',is_super_admin=false,deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE username=$2", [passwordHash, seedIdentity.username]);
        await client.query("UPDATE public.sys_role SET role_name='AF012 changed role',data_scope='self',status='disabled',deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE role_code=$1", [seedIdentity.roleCode]);
        await client.query("DELETE FROM public.sys_user_role"); await client.query("DELETE FROM public.sys_role_permission");
        const roleId = randomUUID(); await client.query("INSERT INTO public.sys_role (id,role_code,role_name,data_scope,updated_at) VALUES ($1,'af012_manual_role','AF012 manual role','self',CURRENT_TIMESTAMP)", [roleId]);
        await client.query("INSERT INTO public.sys_user_role (id,user_id,role_id) SELECT $1,id,$2 FROM public.sys_user WHERE username=$3", [randomUUID(), roleId, seedIdentity.username]);
        await client.query("UPDATE public.project_profile SET name='AF012 changed project',status='disabled',updated_at=CURRENT_TIMESTAMP");
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    });
    const before = await snapshot(main), unusedSecret = randomSecret(); secrets.push(unusedSecret);
    const result = run(main, [], 0, { AIJ_INITIAL_ADMIN_PASSWORD: unusedSecret });
    assert.deepEqual(result.admin, { action: "preserved", rolesTouched: false }); assert.deepEqual(await snapshot(main), before);
    const currentHash = await query(main, async client => (await client.query("SELECT password_hash FROM public.sys_user WHERE username=$1", [seedIdentity.username])).rows[0].password_hash);
    assert.ok(await bcrypt.compare(changedSecret, currentHash)); assert.ok(!(await bcrypt.compare(generated.password, currentHash))); assert.ok(!(await bcrypt.compare(unusedSecret, currentHash)));
    assert.equal(hash(join(repositoryRoot, ".local-data/seed/test", main.database, "initial-admin.json")), credentialFileHash);
    save("manual-changes-preserved", { result, rows: before, changedPasswordVerified: true, originalInitialFileUnchanged: true });
  });
  await t.test("dedicated variable creates a separate active synthetic administrator with locally retained input", async () => {
    manual = await createAcceptance("test", "AF-012"); await migrate({ mode: "test", action: "deploy", acceptanceId: manual.id });
    const secret = randomSecret(); secrets.push(secret);
    const inputFile = join(repositoryRoot, ".local-data/seed/test", manual.database, "provided-initial.json"); mkdirSync(join(inputFile, ".."), { recursive: true, mode: 0o700 });
    writeFileSync(inputFile, JSON.stringify({ username: seedIdentity.username, password: secret, scope: "AF-012 synthetic manual account; no Auth service" }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const result = run(manual, [], 0, { AIJ_INITIAL_ADMIN_PASSWORD: secret }); assert.equal(result.credentials.source, "dedicated-variable"); assert.equal(result.credentials.file, null);
    const valid = await query(manual, async client => { const row = (await client.query("SELECT password_hash,status FROM public.sys_user WHERE username=$1", [seedIdentity.username])).rows[0]; return row.status === "active" && await bcrypt.compare(secret, row.password_hash); }); assert.ok(valid);
    const before = await snapshot(manual); assert.equal(run(manual, ["--generate-credentials"], 2).code, "CREDENTIAL_GENERATION_EXISTING_ADMIN"); assert.deepEqual(await snapshot(manual), before);
    assert.ok(!existsSync(join(repositoryRoot, ".local-data/seed/test", manual.database, "initial-admin.json")));
    save("manual", { task: "AF-012", target: result.target, databaseRole: profile("test").user, databasePasswordFile: profile("test").secretFile, username: seedIdentity.username, initialPasswordFile: inputFile, active: true, authImplemented: false, servicesStarted: [] });
    save("provided-variable", { result, bcryptVerified: true, existingAccountGenerationRejected: true });
  });
  await t.test("reserved role collision rolls back the whole transaction and creates no unused password", async () => {
    collision = await createAcceptance("test", "AF-012"); await migrate({ mode: "test", action: "deploy", acceptanceId: collision.id });
    await query(collision, client => client.query("INSERT INTO public.sys_role (id,role_code,role_name,updated_at) VALUES ($1,$2,'AF012 collision',CURRENT_TIMESTAMP)", [randomUUID(), seedIdentity.roleCode]));
    const before = await snapshot(collision); assert.equal(run(collision, ["--generate-credentials"], 2).code, "RBAC_NAMESPACE_OCCUPIED"); assert.deepEqual(await snapshot(collision), before);
    assert.ok(!existsSync(join(repositoryRoot, ".local-data/seed/test", collision.database, "initial-admin.json"))); save("collision", { database: collision.database, rollbackPreserved: true, credentialsCreated: false });
  });
  await t.test("credential file target tampering refuses without overwrite or password recovery", async () => {
    const path = join(repositoryRoot, ".local-data/seed/test", main.database, "initial-admin.json"); const originalBytes = readFileSync(path);
    try {
      const value = JSON.parse(originalBytes); value.database = "aij_foundation_dev"; writeFileSync(path, JSON.stringify(value));
      const before = hash(path); assert.equal(run(main, [], 2).code, "CREDENTIAL_OWNER"); assert.equal(hash(path), before);
    } finally { writeFileSync(path, originalBytes); }
    assert.equal(hash(path), credentialFileHash);
  });
  await t.test("source/managed credentials and canonical databases preserved; all Seed pools close and logs contain no secret/hash", async () => {
    assert.deepEqual(protectedPaths.map(hash), beforeHashes); assert.deepEqual(await original("dev"), originals.dev); assert.deepEqual(await original("test"), originals.test);
    for (const lease of [main, manual, collision]) await query(lease, async client => assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [lease.database])).rows[0].count, 0));
    const manualRows = await snapshot(manual); for (const [table, rows] of Object.entries(manualRows)) assert.equal(rows.length, ["organization_profile", "project_profile", "sys_user", "sys_role", "sys_permission", "sys_user_role", "sys_role_permission"].includes(table) ? 1 : 0);
    for (const name of readdirSync(root).filter(n => n.endsWith(".json") && !n.startsWith("._"))) {
      const output = readFileSync(join(root, name), "utf8");
      for (const secret of secrets) assert.ok(!output.includes(secret), "No credential in retained evidence");
      assert.ok(!/\$2[aby]\$\d\d\$/.test(output), "No password hash in retained evidence");
    }
    save("result", { databases: [main, manual, collision].map(v => ({ id: v.id, database: v.database })), rowCountsStable: true, changedPasswordAndRolesPreserved: true, noMenusOrBusinessRows: true, canonicalDatabasesAndCredentialsUnchanged: true, pools: 0, sourceFilesUnchanged: true });
  });
});
