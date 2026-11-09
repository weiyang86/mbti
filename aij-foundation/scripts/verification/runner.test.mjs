import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArguments, runTask, createRedactor } from "./runner.mjs";
import { taskRegistry, repositoryRoot, reporterPath, artifactOnly } from "./registry.mjs";

const fixtureParent = join(repositoryRoot, ".artifacts/verification-tests");
mkdirSync(fixtureParent, { recursive: true });
const fixture = () => mkdtempSync(join(fixtureParent, "run-"));
const check = (id, source = "require('node:assert/strict').equal(2+2,4)") => ({
  id, kind: "check", command: [process.execPath, "--eval", source],
  files: [], verification: ["实际 Node 断言/退出码"], effects: artifactOnly
});
const testEntry = (files) => ({
  id: "actual-tests", kind: "node-test",
  command: [process.execPath, "--test", "--test-reporter=" + reporterPath, ...files],
  files: [], testFiles: files, verification: ["真实 test runner 用例"], effects: artifactOnly
});
const task = (steps = [check("assertions")]) => ({
  title: "synthetic verifier fixture", prerequisites: [check("required")], steps
});
async function run(definition, options = {}) {
  const root = options.root || fixture();
  const lines = [];
  const result = await runTask("AF-900", { root, registry: { "AF-900": definition }, log: (line) => lines.push(line), ...options });
  return { ...result, root, lines };
}
function saved(result) {
  return JSON.parse(readFileSync(join(result.evidenceDirectory, "report.json"), "utf8"));
}
function allEvidence(path) {
  return readdirSync(path).filter((name) => name !== "credentials.json").map((name) => readFileSync(join(path, name), "utf8")).join("\n");
}

test("argument parser accepts one optional separator and manual flag in either order", () => {
  for (const args of [["AF-002"], ["--", "AF-002"], ["AF-002", "--"]]) assert.deepEqual(parseArguments(args), { taskId: "AF-002", prepareManual: false });
  for (const args of [["--", "AF-002", "--prepare-manual"], ["--prepare-manual", "AF-002"]]) assert.deepEqual(parseArguments(args), { taskId: "AF-002", prepareManual: true });
});
test("invalid CLI arguments cannot skip prerequisites or inject commands", () => {
  for (const args of [[], ["AF-002", "--", "--"], ["AF-002", "--skip"], ["AF-002", "AF-003"], ["AF-002;exit 0"], ["AF-002", "--prepare-manual", "--prepare-manual"]]) {
    assert.throws(() => parseArguments(args), /Usage|separator/);
  }
});
test("AF-002 registration binds a real test file, exact Node arguments and explicit effects", () => {
  const entry = taskRegistry["AF-002"].steps[0];
  assert.deepEqual(entry.testFiles, ["scripts/verification/runner.test.mjs"]);
  assert.deepEqual(entry.command, [process.execPath, "--test", "--test-reporter=" + reporterPath, ...entry.testFiles]);
  assert.ok(taskRegistry["AF-002"].prerequisites.length > 0);
  assert.equal(entry.effects.testDatabase, false);
  assert.equal(entry.effects.uniqueWriter, false);
  assert.deepEqual(entry.effects.services, []);
});
test("actual commands run sequentially and record prerequisite/check exits and verification items", async () => {
  const root = fixture();
  const definition = task([check("assertions", "require('node:assert/strict').equal(require('node:fs').readFileSync('marker','utf8'),'prepared')")]);
  definition.prerequisites = [check("required", "require('node:fs').writeFileSync('marker','prepared')")];
  const result = await run(definition, { root });
  assert.equal(result.exitCode, 0);
  assert.equal(saved(result).status, "PASS");
  assert.deepEqual(saved(result).prerequisites.map((r) => r.exitCode), [0]);
  assert.deepEqual(saved(result).steps[0].verifiedItems, ["实际 Node 断言/退出码"]);
});
test("unknown task has a nonzero result and persisted failure evidence", async () => {
  const result = await runTask("AF-999999", { root: fixture(), registry: {}, log: () => {} });
  assert.equal(result.exitCode, 2);
  assert.match(saved(result).error, /Unknown task/);
});
test("real CLI propagates unknown-task failure", () => {
  const result = spawnSync(process.execPath, ["scripts/verification/runner.mjs", "--", "AF-999999"], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /"status":"FAIL"/);
});

for (const [name, mutate] of [
  ["missing prerequisites", (d) => { delete d.prerequisites; }],
  ["empty prerequisites", (d) => { d.prerequisites = []; }],
  ["missing checks", (d) => { d.steps = []; }],
  ["empty command", (d) => { d.steps[0].command = []; }],
  ["missing command", (d) => { delete d.steps[0].command; }],
  ["missing verification items", (d) => { d.steps[0].verification = []; }],
  ["missing effects", (d) => { delete d.steps[0].effects; }],
  ["missing required file", (d) => { d.prerequisites[0].files = ["missing.json"]; }],
  ["skipped prerequisite", (d) => { d.prerequisites[0].skip = true; }],
  ["optional prerequisite", (d) => { d.prerequisites[0].optional = true; }],
  ["duplicate IDs", (d) => { d.steps[0].id = "required"; }],
  ["unknown check kind", (d) => { d.steps[0].kind = "print-pass"; }]
]) {
  test(name + " fails before executing any child", async () => {
    const definition = task();
    mutate(definition);
    const result = await run(definition);
    assert.equal(result.exitCode, 2);
    assert.equal(saved(result).status, "FAIL");
    assert.equal(saved(result).prerequisites.length, 0);
    assert.equal(saved(result).steps.length, 0);
  });
}
test("failed prerequisite preserves exit 9 and never executes the verification command", async () => {
  const definition = task([check("must-not-run", "require('node:fs').writeFileSync('forbidden','ran')")]);
  definition.prerequisites = [check("required", "process.exit(9)")];
  const result = await run(definition);
  assert.equal(result.exitCode, 9);
  assert.equal(saved(result).prerequisites[0].exitCode, 9);
  assert.equal(saved(result).steps.length, 0);
  assert.equal(existsSync(join(result.root, "forbidden")), false);
});
test("intentional child exit 7 survives real stdout/stderr capture and saved logs", async () => {
  const result = await run(task([check("failure", "console.log('PASS is not proof');console.error('expected failure');process.exit(7)")]));
  assert.equal(result.exitCode, 7);
  assert.equal(saved(result).exitCode, 7);
  assert.equal(saved(result).steps[0].exitCode, 7);
  assert.match(readFileSync(join(result.evidenceDirectory, "failure.stdout.log"), "utf8"), /PASS is not proof/);
  assert.match(readFileSync(join(result.evidenceDirectory, "failure.stderr.log"), "utf8"), /expected failure/);
});
test("missing executable fails as 127 and never PASS", async () => {
  const definition = task(); definition.steps[0].command = ["aij-nonexistent-executable-af002"];
  const result = await run(definition);
  assert.equal(result.exitCode, 127);
  assert.equal(saved(result).status, "FAIL");
});
test("arguments retain literal shell metacharacters without running a shell", async () => {
  const root = fixture(), literal = "$(touch injected); ' spaced \" value";
  const entry = check("literal", "require('node:assert/strict').equal(process.argv[1]," + JSON.stringify(literal) + ")");
  entry.command.push(literal);
  const result = await run(task([entry]), { root });
  assert.equal(result.exitCode, 0);
  assert.equal(existsSync(join(root, "injected")), false);
});
test("a real Node test assertion produces structured nonzero case counts", async () => {
  const root = fixture();
  writeFileSync(join(root, "actual.test.mjs"), "import test from 'node:test';import a from 'node:assert/strict';test('math',()=>a.equal(2+3,5));");
  const result = await run(task([testEntry(["actual.test.mjs"])]), { root });
  assert.equal(result.exitCode, 0);
  assert.equal(saved(result).steps[0].tests.tests, 1);
  assert.equal(saved(result).steps[0].tests.passed, 1);
});
for (const [name, source] of [
  ["print-only", "console.log('PASS');"],
  ["zero-tests", "import test from 'node:test'; void test;"],
  ["skipped", "import test from 'node:test';test.skip('not run',()=>{});"],
  ["todo", "import test from 'node:test';test.todo('not run');"],
  ["assertion-failure", "import test from 'node:test';import a from 'node:assert/strict';test('wrong',()=>a.equal(1,2));"]
]) {
  test(name + " cannot count as successful test verification", async () => {
    const root = fixture();
    writeFileSync(join(root, "fixture.test.mjs"), source);
    const result = await run(task([testEntry(["fixture.test.mjs"])]), { root });
    assert.notEqual(result.exitCode, 0);
    assert.equal(saved(result).status, "FAIL");
  });
}
test("every registered test file must run effective cases", async () => {
  const root = fixture();
  writeFileSync(join(root, "good.test.mjs"), "import test from 'node:test';import a from 'node:assert/strict';test('yes',()=>a.ok(true));");
  writeFileSync(join(root, "empty.test.mjs"), "");
  const result = await run(task([testEntry(["good.test.mjs", "empty.test.mjs"])]), { root });
  assert.notEqual(result.exitCode, 0);
});
test("missing test file and command/file mismatch are rejected before prerequisites", async () => {
  for (const mismatch of [false, true]) {
    const root = fixture(), entry = testEntry(["absent.test.mjs"]);
    if (mismatch) {
      writeFileSync(join(root, "absent.test.mjs"), "console.log('PASS')");
      entry.command = [process.execPath, "--eval", "console.log('PASS')"];
    }
    const result = await run(task([entry]), { root });
    assert.equal(result.exitCode, 2);
    assert.equal(saved(result).prerequisites.length, 0);
  }
});
test("declared test-database writes and unique-Writer probes cannot run without their guards", async () => {
  for (const key of ["testDatabase", "uniqueWriter"]) {
    const definition = task();
    definition.steps[0].effects = { ...artifactOnly, [key]: true };
    const result = await run(definition, { env: {} });
    assert.equal(result.exitCode, 2);
    assert.equal(saved(result).steps.length, 0);
  }
});
test("explicit unique-Writer acknowledgement permits the registered probe only", async () => {
  const definition = task();
  definition.steps[0].effects = { ...artifactOnly, uniqueWriter: true };
  const result = await run(definition, { env: { AIJ_VERIFY_WRITER: "AF-900" } });
  assert.equal(result.exitCode, 0);
  assert.equal(saved(result).steps[0].effects.uniqueWriter, true);
});
test("manual mode is explicit, runs prerequisites and only the registered safe hook", async () => {
  const definition = task([check("must-not-run", "process.exit(19)")]);
  let calls = 0;
  definition.prepareManual = { id: "safe-hook", safe: true, files: [], effects: artifactOnly, verification: ["local note"],
    run: async ({ writeNote }) => { calls++; writeNote({ prepared: true }); } };
  const normal = await run(definition);
  assert.equal(normal.exitCode, 19);
  assert.equal(calls, 0);
  const prepared = await run(definition, { prepareManual: true });
  assert.equal(prepared.exitCode, 0);
  assert.equal(calls, 1);
  assert.equal(saved(prepared).status, "PREPARED");
  assert.equal(saved(prepared).prerequisites.length, 1);
  assert.equal(saved(prepared).steps.length, 0);
  assert.equal(JSON.parse(readFileSync(join(prepared.evidenceDirectory, "manual.json"), "utf8")).prepared, true);
});
test("missing or unsafe manual hooks fail without calling them", async () => {
  for (const hook of [undefined, { safe: false, run: () => assert.fail("unsafe hook executed") }]) {
    const definition = task(); definition.prepareManual = hook;
    const result = await run(definition, { prepareManual: true });
    assert.equal(result.exitCode, 2);
  }
});
test("manual hooks cannot declare services/database/source writes", async () => {
  for (const effects of [{ ...artifactOnly, services: ["api"] }, { ...artifactOnly, testDatabase: true }, { ...artifactOnly, writes: ["apps/api"] }]) {
    const definition = task();
    definition.prepareManual = { id: "unsafe-effects", safe: true, files: [], verification: ["no unsafe effect"], effects, run: () => assert.fail("hook executed") };
    assert.equal((await run(definition, { prepareManual: true })).exitCode, 2);
  }
});
function databaseManualTask() {
  const effects = { writes: [".artifacts/", ".local-data/postgres/"], services: ["owned-database:test"], testDatabase: true, uniqueWriter: false };
  const definition = task([{ ...check("database-check"), effects }]);
  definition.prerequisites.push(check("test-database-target"));
  definition.prepareManual = { ...check("prepare-database"), safe: true, scope: "owned-local-database", effects };
  return definition;
}
test("explicit database preparation command executes after target guard and records PREPARED, not PASS", async () => {
  const result = await run(databaseManualTask(), { prepareManual: true });
  assert.equal(result.exitCode, 0);
  assert.equal(saved(result).status, "PREPARED");
  assert.equal(saved(result).steps.length, 0);
  assert.equal(saved(result).prerequisites.length, 2);
  assert.equal(saved(result).manual[0].exitCode, 0);
  assert.ok(existsSync(join(result.evidenceDirectory, "prepare-database.stdout.log")));
});
test("database preparation cannot bypass target guard, declared ownership scope or local-only writes", async () => {
  for (const mutate of [
    (d) => d.prerequisites.pop(),
    (d) => delete d.prepareManual.scope,
    (d) => d.prepareManual.effects = { ...d.prepareManual.effects, services: ["undeclared:other-project"] },
    (d) => d.prepareManual.effects = { ...d.prepareManual.effects, writes: ["apps/api/"] },
    (d) => d.prepareManual.run = () => assert.fail("ambiguous hook"),
    (d) => d.prepareManual.effects = { ...d.prepareManual.effects, uniqueWriter: true },
    (d) => d.prepareManual.effects = { ...d.prepareManual.effects, testDatabase: false }
  ]) {
    const definition = databaseManualTask(); mutate(definition);
    const result = await run(definition, { prepareManual: true });
    assert.equal(result.exitCode, 2);
    assert.equal(saved(result).manual.length, 0);
  }
});
test("failed explicit manual child exit is propagated and never produces PREPARED", async () => {
  const definition = databaseManualTask();
  definition.prepareManual.command = [process.execPath, "--eval", "process.exit(17)"];
  const result = await run(definition, { prepareManual: true });
  assert.equal(result.exitCode, 17);
  assert.equal(saved(result).manual[0].exitCode, 17);
  assert.equal(saved(result).status, "FAIL");
});
test("only registered auth and UI-1 manual tasks permit local auth/seed credential directories", async () => {
  const definition = databaseManualTask();
  definition.prepareManual.effects = { ...definition.prepareManual.effects, writes: [".artifacts/", ".local-data/postgres/", ".local-data/seed/", ".local-data/auth/"] };
  for (const taskId of ["AF-013", "AF-014", "AF-015", "AF-028", "AF-029", "AF-038", "AF-039", "AF-040", "AF-041", "AF-043"]) {
    const result = await runTask(taskId, { root: fixture(), registry: { [taskId]: definition }, log: () => {}, prepareManual: true });
    assert.equal(result.exitCode, 0); assert.equal(saved(result).status, "PREPARED");
  }
  assert.equal((await run(definition, { prepareManual: true })).exitCode, 2);
});
test("registered auth and UI-1 preparation cannot extend to source or unrelated local directories", async () => {
  for (const path of [".env", "apps/api/", ".local-data/", ".local-data/other/", ".local-data/auth/../other/"]) {
    const definition = databaseManualTask(); definition.prepareManual.effects = { ...definition.prepareManual.effects, writes: [path] };
    for (const taskId of ["AF-013", "AF-014", "AF-015", "AF-028", "AF-029", "AF-038", "AF-039", "AF-040", "AF-041", "AF-043"]) {
      const result = await runTask(taskId, { root: fixture(), registry: { [taskId]: definition }, log: () => {}, prepareManual: true });
      assert.equal(result.exitCode, 2); assert.equal(saved(result).manual.length, 0);
    }
  }
});
test("synthetic password is written to a Git-ignored local file and never echoed or saved in report/logs", async () => {
  const password = "synthetic-password-AF002-unique-value";
  const definition = task();
  definition.prepareManual = { id: "credentials", safe: true, files: [], effects: artifactOnly, verification: ["ignored fixture credentials"],
    run: async ({ writeCredentials }) => { writeCredentials({ username: "synthetic-reviewer", password }); throw new Error("hook failure " + password); } };
  const result = await run(definition, { prepareManual: true });
  assert.notEqual(result.exitCode, 0);
  const path = join(result.evidenceDirectory, "credentials.json");
  assert.equal(JSON.parse(readFileSync(path, "utf8")).password, password);
  execFileSync("git", ["--no-optional-locks", "check-ignore", "--quiet", "--", path], { cwd: result.root });
  assert.ok(!result.lines.join("\n").includes(password));
  assert.ok(!allEvidence(result.evidenceDirectory).includes(password));
});
test("parent secrets and Node injection options are not inherited by children; logs are redacted", async () => {
  const secret = "sensitive-fixture-value-1234";
  const source = "const a=require('node:assert/strict');a.equal(process.env.DATABASE_URL,undefined);a.equal(process.env.NODE_OPTIONS,undefined);console.log(" + JSON.stringify(secret) + ");console.error('password=example-only')";
  const result = await run(task([check("redaction", source)]), { env: { DATABASE_URL: secret, NODE_OPTIONS: "--bad-option" } });
  assert.equal(result.exitCode, 0);
  assert.ok(!result.lines.join("\n").includes(secret));
  assert.ok(!allEvidence(result.evidenceDirectory).includes(secret));
  assert.doesNotMatch(allEvidence(result.evidenceDirectory), /password=example-only/);
});
test("credential patterns and URL/Bearer/private key values are scrubbed", () => {
  const redact = createRedactor();
  for (const value of ["password=hide-me", '{"token":"hide-me"}', "Bearer hide-me", "postgres://u:hide-me@127.0.0.1/db", "-----BEGIN PRIVATE KEY-----hide-me-----END PRIVATE KEY-----"]) {
    assert.ok(!redact(value).includes("hide-me"));
  }
});
test("evidence directory symlink is refused instead of writing through it", async () => {
  const root = fixture(), elsewhere = fixture();
  symlinkSync(elsewhere, join(root, ".artifacts"));
  const result = await run(task(), { root });
  assert.equal(result.exitCode, 2);
  assert.deepEqual(readdirSync(elsewhere), []);
});
test("registered file outside task root is refused", async () => {
  const definition = task(); definition.prerequisites[0].files = ["../outside.json"];
  const result = await run(definition);
  assert.equal(result.exitCode, 2);
});
test("timeout is nonzero and records the actual signal plus effective 124", async () => {
  const result = await run(task([check("timeout", "setInterval(()=>{},1000)")]), { timeoutMs: 100 });
  assert.equal(result.exitCode, 124);
  assert.equal(saved(result).steps[0].timedOut, true);
});
test("registered step timeout overrides the default within the bounded maximum", async () => {
  const step = check("long-step", "setTimeout(()=>process.exit(0),80)");
  step.timeoutMs = 1000;
  const definition = task([step]);
  definition.prerequisites[0].timeoutMs = 1000;
  const result = await run(definition, { timeoutMs: 10 });
  assert.equal(result.exitCode, 0);
  assert.equal(saved(result).steps[0].timedOut, false);
  for (const timeoutMs of [999, 900001, 1.5]) {
    const invalidStep = check("invalid-timeout", "process.exit(0)");
    invalidStep.timeoutMs = timeoutMs;
    const rejected = await run(task([invalidStep]));
    assert.equal(rejected.exitCode, 2);
  }
});
test("child signal is nonzero and is retained in evidence", async () => {
  const result = await run(task([check("signal", "process.kill(process.pid,'SIGTERM')")]));
  assert.equal(result.exitCode, 143);
  assert.equal(saved(result).steps[0].signal, "SIGTERM");
});
test("runner does not modify its implementation or registry", async () => {
  const files = ["runner.mjs", "registry.mjs", "reporter.mjs"].map((file) => resolve(repositoryRoot, "scripts/verification", file));
  const hashes = () => files.map((file) => createHash("sha256").update(readFileSync(file)).digest("hex"));
  const before = hashes();
  assert.equal((await run(task())).exitCode, 0);
  assert.deepEqual(hashes(), before);
});
for (const childExit of [0, 7]) {
  test("actual log-save failure preserves child failure or fails verification: child " + childExit, async () => {
    const source = "const f=require('node:fs');const p='.artifacts/verification/AF-900/';const d=f.readdirSync(p).find(n=>n.startsWith('run-'));f.mkdirSync(p+d+'/failure.stdout.log');process.exit(" + childExit + ")";
    const result = await run(task([check("failure", source)]));
    assert.equal(result.exitCode, childExit || 74);
    assert.equal(saved(result).steps[0].exitCode, childExit);
    assert.equal(saved(result).status, "FAIL");
  });
}
test("final report-save failure cannot yield PASS", async () => {
  const source = "const f=require('node:fs');const p='.artifacts/verification/AF-900/';const d=f.readdirSync(p).find(n=>n.startsWith('run-'));f.mkdirSync(p+d+'/report.json')";
  const result = await run(task([check("break-report", source)]));
  assert.equal(result.exitCode, 74);
  assert.equal(result.report.status, "FAIL");
  assert.match(result.report.evidenceError, /EEXIST|EISDIR|directory/);
  assert.ok(!result.lines.join("\n").includes('"status":"PASS"'));
});
test("a real outer process propagates the failed command exit 7", () => {
  const root = fixture();
  const code = "import {runTask} from " + JSON.stringify(new URL("./runner.mjs", import.meta.url).href) + ";" +
    "process.exitCode=(await runTask('AF-900',{root:" + JSON.stringify(root) + ",registry:" +
    JSON.stringify({ "AF-900": task([check("deliberate-failure", "process.exit(7)")]) }) + "})).exitCode;";
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", code], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(result.status, 7);
  assert.match(result.stdout, /"exitCode":7/);
  assert.ok(!result.stdout.includes('"status":"PASS"'));
});
test("structured notes redact sensitive property values before JSON serialization", async () => {
  const definition = task();
  definition.prepareManual = { id: "note", safe: true, files: [], effects: artifactOnly, verification: ["structured redaction"],
    run: async ({ writeNote }) => writeNote({ nested: { password: "note-secret-not-from-env", token: "note-token-not-from-env" } }) };
  const result = await run(definition, { prepareManual: true });
  assert.equal(result.exitCode, 0);
  const note = JSON.parse(readFileSync(join(result.evidenceDirectory, "manual.json"), "utf8"));
  assert.equal(note.nested.password, "[REDACTED]");
  assert.equal(note.nested.token, "[REDACTED]");
  assert.ok(!allEvidence(result.evidenceDirectory).includes("note-secret-not-from-env"));
});
