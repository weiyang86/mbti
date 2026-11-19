import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot, reporterPath, productCatalog } from "./catalog.mjs";
import { assertDatabaseWorktree, captureBaseline, parseArguments, runProduct } from "./runner.mjs";
import { migrationInventory } from "./database-preflight.mjs";

const parent = join(repositoryRoot, ".artifacts/product-runner-tests");
mkdirSync(parent, { recursive: true });
function fixture(sources = { "actual.test.mjs": "import test from 'node:test';import a from 'node:assert/strict';test('effective assertion',()=>a.equal(2+2,4));" }) {
  const root = mkdtempSync(join(parent, "run-"));
  // External macOS volumes may create AppleDouble sidecars after Git commit.
  // Ignore only fixture artifacts/system sidecars; business source stays visible.
  writeFileSync(join(root, ".gitignore"), ".artifacts/\n._*\n");
  writeFileSync(join(root, "source.txt"), "source");
  for (const [file, source] of Object.entries(sources)) writeFileSync(join(root, file), source);
  const git = args => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git(["init", "-b", "dev"]);
  git(["add", "."]);
  git(["-c", "user.name=Offline product fixture", "-c", "user.email=fixture@localhost", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  return root;
}
const check = (id, source) => ({ id, kind: "check", files: [], command: [process.execPath, "--eval", source] });
const testEntry = (files = ["actual.test.mjs"]) => ({ id: "cases", kind: "node-test", files, testFiles: files,
  command: [process.execPath, "--test", "--test-concurrency=1", "--test-reporter=" + reporterPath, ...files] });
const group = (steps = [testEntry()]) => ({ title: "offline fixture", database: false,
  effects: { writes: [".artifacts/"], services: [], database: false }, prerequisites: [], steps });
const databaseGroup = (prerequisite = check("test-database-target", "require('node:assert/strict').ok(true)")) => ({
  ...group(), database: true, effects: { writes: [".artifacts/"], services: [], database: true }, prerequisites: [prerequisite]
});
const run = (root, definition = group(), options = {}) => runProduct({ root, group: "checks", catalog: { checks: definition }, log: () => {}, ...options });
const saved = result => JSON.parse(readFileSync(join(result.evidenceDirectory, "report.json"), "utf8"));

test("CLI requires an explicit registered scope and cannot inject commands, skip, repeat or abbreviate a SHA", () => {
  assert.deepEqual(parseArguments(["--list"]), { list: true });
  assert.equal(parseArguments(["--", "--group", "checks"]).group, "checks");
  assert.equal(parseArguments(["--group", "all", "--serial-db", "--sha", "a".repeat(40)]).serialDatabase, true);
  for (const args of [[], ["--group", "unknown"], ["--group", "checks", "--skip"], ["--group", "checks", "--sha", "abc123"],
    ["--group", "checks", "--group", "checks"], ["--group", "checks", "--serial-db"],
    ["--group", "database", "--serial-db", "--serial-db"], ["--group", "checks", "--command", "true"]]) assert.throws(() => parseArguments(args));
});

test("fresh checkout with no historical .artifacts passes real assertions and binds the tested SHA", async () => {
  const root = fixture();
  assert.equal(existsSync(join(root, ".artifacts")), false);
  // Reproduce the external-volume sidecar even on filesystems without AppleDouble.
  const metadata = join(root, "._synthetic-product-metadata");
  writeFileSync(metadata, "synthetic AppleDouble metadata");
  const baseline = captureBaseline(root), result = await run(root, group(), { expectedSha: baseline.head });
  assert.equal(result.exitCode, 0);
  const report = saved(result);
  assert.equal(report.status, "PASS");
  assert.equal(report.baseline.head, baseline.head);
  assert.equal(report.baseline.dirty, false);
  assert.deepEqual(report.endBaseline, report.baseline);
  assert.equal(report.entries[0].tests.tests, 1);
  assert.equal(report.productMatrix, "DEFERRED_CI_02");
  assert.equal(readFileSync(metadata, "utf8"), "synthetic AppleDouble metadata");
});

test("SHA mismatch is recorded as failure before any command", async () => {
  const result = await run(fixture(), group(), { expectedSha: "f".repeat(40) });
  assert.equal(result.exitCode, 2);
  assert.equal(saved(result).entries.length, 0);
  assert.match(saved(result).error, /SHA/);
});

for (const [name, source] of [
  ["print-only", "console.log('PASS')"], ["zero cases", ""],
  ["skip", "import test from 'node:test';test.skip('skipped',()=>{});"],
  ["todo", "import test from 'node:test';test.todo('later');"],
  ["cancelled", "import test from 'node:test';test('cancelled',{signal:AbortSignal.abort()},()=>{});"],
  ["failed assertion", "import test from 'node:test';import a from 'node:assert/strict';test('bad',()=>a.equal(1,2));"]
]) test(name + " cannot PASS", async () => {
  const result = await run(fixture({ "actual.test.mjs": source }));
  assert.notEqual(result.exitCode, 0);
  assert.equal(saved(result).status, "FAIL");
  assert.equal(saved(result).entries[0].status, "FAIL");
});

test("one effective file cannot mask another empty file", async () => {
  const root = fixture(); writeFileSync(join(root, "empty.test.mjs"), "");
  const result = await run(root, group([testEntry(["actual.test.mjs", "empty.test.mjs"])]));
  assert.notEqual(result.exitCode, 0);
  assert.match(saved(result).error, /effective tests/);
});

for (const [name, mutate] of [
  ["empty group", d => { d.steps = []; }],
  ["check-only group", d => { d.steps = [check("print", "console.log('PASS')")]; }],
  ["missing test", d => { d.steps = [testEntry(["absent.test.mjs"])]; }],
  ["mismatched command", d => { d.steps[0].command = [process.execPath, "--eval", "console.log('PASS')"]; }],
  ["skipped entry", d => { d.steps[0].skip = true; }],
  ["optional entry", d => { d.steps[0].optional = true; }],
  ["duplicate id", d => { d.steps.push(testEntry()); }],
  ["escaping source", d => { d.steps[0].files = ["../source.txt"]; }],
  ["invalid timeout", d => { d.steps[0].timeoutMs = -1; }]
]) test(name + " fails registration before execution", async () => {
  const definition = group(); mutate(definition);
  const result = await run(fixture(), definition);
  assert.equal(result.exitCode, 2);
  assert.equal(saved(result).entries.length, 0);
});

test("prerequisites and groups run sequentially; a failure retains its exit and prevents later commands", async () => {
  const root = fixture(), trace = source => "require('node:fs').appendFileSync('.artifacts/trace'," + JSON.stringify(source) + ")";
  const first = group([check("step", trace("step\n")), testEntry()]);
  first.prerequisites = [check("prepare", trace("prepare\n"))];
  const second = group([check("stop", trace("stop\n") + ";process.exit(7)"), testEntry()]);
  const result = await run(root, first, { group: "all", catalog: { first, second } });
  assert.equal(result.exitCode, 7);
  assert.equal(saved(result).status, "FAIL");
  assert.equal(saved(result).entries.at(-1).effectiveExitCode, 7);
  assert.deepEqual(saved(result).notRun.map(entry => entry.id), ["cases"]);
  assert.equal(readFileSync(join(root, ".artifacts/trace"), "utf8"), "prepare\nstep\nstop\n");
});

test("spawn failure and timeout cannot pass", async () => {
  for (const entry of [
    { id: "missing", kind: "check", files: [], command: ["aij-product-no-such-executable"] },
    { ...check("timeout", "setInterval(()=>{},1000)"), timeoutMs: 100 }
  ]) {
    const result = await run(fixture(), group([entry, testEntry()]));
    assert.equal(result.exitCode, entry.id === "missing" ? 127 : 124);
    assert.equal(saved(result).status, "FAIL");
  }
});

test("child environment strips credentials and Node overrides, logs redact inherited secrets", async () => {
  const secret = "product-test-secret-never-a-credential";
  const source = "const a=require('node:assert/strict');a.equal(process.env.TEST_DATABASE_URL,undefined);a.equal(process.env.NODE_OPTIONS,undefined);console.log(process.argv[1])";
  const entry = check("environment", source); entry.command.push(secret);
  const result = await run(fixture(), group([entry, testEntry()]), { env: { ...process.env, TEST_DATABASE_URL: secret, NODE_OPTIONS: "--invalid-never-inherited" } });
  assert.equal(result.exitCode, 0);
  assert.ok(!readFileSync(join(result.evidenceDirectory, "checks-environment.stdout.log"), "utf8").includes(secret));
  assert.ok(!readFileSync(join(result.evidenceDirectory, "report.json"), "utf8").includes(secret));
});

test("tracked or untracked source mutation during verification invalidates the SHA-bound report", async () => {
  for (const name of ["source.txt", "new-source.txt"]) {
    const result = await run(fixture(), group([check("mutation", "require('node:fs').writeFileSync('" + name + "','changed')"), testEntry()]));
    assert.equal(result.exitCode, 1);
    assert.equal(saved(result).status, "FAIL");
    assert.match(saved(result).error, /Source\/HEAD changed/);
  }
});

test("dirty candidate baseline records a digest and is allowed only if it stays unchanged", async () => {
  const root = fixture(); writeFileSync(join(root, "source.txt"), "candidate");
  const result = await run(root);
  assert.equal(result.exitCode, 0);
  assert.equal(saved(result).baseline.dirty, true);
  assert.match(saved(result).baseline.sourceDigest, /^[a-f0-9]{64}$/);
});

test("DB group requires lease and target-first registration without connecting to a database", async () => {
  const root = fixture();
  const noLease = await run(root, databaseGroup());
  assert.equal(noLease.exitCode, 2); assert.equal(saved(noLease).entries.length, 0);
  const badOrder = databaseGroup(); badOrder.prerequisites = [];
  const noTarget = await run(root, badOrder, { serialDatabase: true });
  assert.equal(noTarget.exitCode, 2); assert.equal(saved(noTarget).entries.length, 0);
});

for (const reason of ["Missing DB", "Missing migration chain"]) test(reason + " blocks the serial group with real nonzero child exit (offline fixture)", async () => {
  const definition = databaseGroup(check("test-database-target", "console.error('" + reason + "');process.exit(3)"));
  const result = await run(fixture(), definition, { serialDatabase: true });
  assert.equal(result.exitCode, 3);
  assert.equal(saved(result).entries.length, 1);
  assert.equal(saved(result).status, "FAIL");
  assert.equal(existsSync(join(result.evidenceDirectory, "../database.lock")), false);
});

test("serial DB lock rejects a concurrent run and does not remove someone else's lease", async () => {
  const root = fixture(), lock = join(root, ".artifacts/product-verification/database.lock");
  mkdirSync(lock, { recursive: true });
  const result = await run(root, databaseGroup(), { serialDatabase: true });
  assert.equal(result.exitCode, 2); assert.equal(saved(result).entries.length, 0);
  assert.equal(existsSync(lock), true);
});

test("successful synthetic serial DB group releases its lease without DB access", async () => {
  const result = await run(fixture(), databaseGroup(), { serialDatabase: true });
  assert.equal(result.exitCode, 0);
  assert.equal(saved(result).entries[0].id, "test-database-target");
  assert.deepEqual(saved(result).notRun, []);
  assert.equal(existsSync(join(result.evidenceDirectory, "../database.lock")), false);
});

test("linked worker and non-dev worktree guards reject without DB access", () => {
  const root = fixture();
  const worker = join(root, ".artifacts/linked-worker");
  mkdirSync(join(root, ".artifacts"), { recursive: true });
  execFileSync("git", ["worktree", "add", "-b", "worker", worker], { cwd: root, stdio: "ignore" });
  assert.throws(() => assertDatabaseWorktree(worker), /original dev/);
  execFileSync("git", ["branch", "-m", "candidate"], { cwd: root });
  assert.throws(() => assertDatabaseWorktree(root), /original dev/);
});

test("actual migration inventory rejects missing directory, empty chain, missing/empty SQL and empty Schema without DB access", () => {
  for (const kind of ["missing directory", "empty chain", "missing SQL", "empty SQL", "empty Schema", "valid"]) {
    const root = fixture(), prisma = join(root, "apps/api/prisma"), directory = join(prisma, "migrations");
    if (kind !== "missing directory") mkdirSync(directory, { recursive: true });
    else mkdirSync(prisma, { recursive: true });
    writeFileSync(join(prisma, "schema.prisma"), kind === "empty Schema" ? " " : "synthetic schema");
    if (!["missing directory", "empty chain"].includes(kind)) {
      const migration = join(directory, "20261104000000_fixture"); mkdirSync(migration);
      if (kind !== "missing SQL") writeFileSync(join(migration, "migration.sql"), kind === "empty SQL" ? " \n" : "SELECT 1;");
    }
    if (kind === "valid") assert.match(migrationInventory(root)[0].sha256, /^[a-f0-9]{64}$/);
    else assert.throws(() => migrationInventory(root));
  }
});

test("symlink evidence directory cannot redirect reports outside the worktree", async () => {
  const root = fixture(), target = fixture();
  symlinkSync(target, join(root, ".artifacts"));
  const result = await run(root);
  assert.equal(result.exitCode, 2);
  assert.match(result.report.error, /Unsafe/);
  assert.equal(result.evidenceDirectory, undefined);
});

test("catalog has pure and target-protected DB groups, without historical report or task-runner commands", () => {
  assert.deepEqual(Object.keys(productCatalog), ["checks", "database"]);
  assert.equal(productCatalog.checks.database, false);
  assert.equal(productCatalog.database.prerequisites[0].id, "test-database-target");
  for (const definition of Object.values(productCatalog)) for (const entry of [...definition.prerequisites, ...definition.steps]) {
    assert.ok(!entry.command.join(" ").includes("verify:task"));
    assert.ok(!entry.command.join(" ").includes(".artifacts/"));
  }
});

test("real CLI lists scope and propagates invalid arguments", () => {
  const cli = join(repositoryRoot, "scripts/verification/product/runner.mjs");
  const listing = spawnSync(process.execPath, [cli, "--list"], { encoding: "utf8" });
  assert.equal(listing.status, 0);
  assert.equal(JSON.parse(listing.stdout).groups.database.database, true);
  const invalid = spawnSync(process.execPath, [cli, "--group", "checks", "--skip"], { encoding: "utf8" });
  assert.equal(invalid.status, 2);
});
