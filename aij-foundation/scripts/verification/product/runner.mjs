import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { productCatalog, deferredMatrix, repositoryRoot, reporterPath } from "./catalog.mjs";

const invalid = message => Object.assign(new Error(message), { exitCode: 2 });
const sha256 = data => createHash("sha256").update(data).digest("hex");
const strings = value => Array.isArray(value) && value.length > 0 && value.every(item => typeof item === "string" && item.trim() && !item.includes("\0"));
const git = (root, args) => execFileSync("git", ["--no-optional-locks", ...args], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });

export function parseArguments(input) {
  const args = input[0] === "--" ? input.slice(1) : input;
  if (args.length === 1 && args[0] === "--list") return { list: true };
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--serial-db" && !options.serialDatabase) options.serialDatabase = true;
    else if (["--group", "--sha"].includes(arg)) {
      const key = arg === "--group" ? "group" : "expectedSha";
      if (options[key] || !args[index + 1]) throw invalid("Duplicate or missing " + arg);
      options[key] = args[++index];
    } else throw invalid("Unknown/duplicate option: " + arg);
  }
  if (!["checks", "database", "all"].includes(options.group) || options.expectedSha && !/^[a-f0-9]{40}$/.test(options.expectedSha)) {
    throw invalid("Usage: runner.mjs --list | --group checks|database|all [--sha FULL_SHA] [--serial-db]");
  }
  if (options.serialDatabase && options.group === "checks") throw invalid("checks has no database lease");
  return options;
}

export function captureBaseline(root) {
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  if (!/^[a-f0-9]{40}$/.test(head)) throw invalid("Cannot bind report to Git SHA");
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const diff = git(root, ["diff", "HEAD", "--binary", "--no-ext-diff", "--no-textconv"]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean).sort();
  const untrackedHashes = untracked.map(file => [file, sha256(readFileSync(localFile(root, file)))]);
  return { head, branch: git(root, ["branch", "--show-current"]).trim(),
    dirty: Boolean(status), sourceDigest: sha256(JSON.stringify([status, diff, untrackedHashes])) };
}

function localFile(root, name) {
  if (typeof name !== "string" || !name || isAbsolute(name)) throw invalid("File must be repository-relative");
  const path = resolve(root, name), rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel) || !existsSync(path) || !lstatSync(path).isFile()) throw invalid("Missing registered file: " + name);
  const actual = relative(realpathSync(root), realpathSync(path));
  if (actual.startsWith("..") || isAbsolute(actual)) throw invalid("File escapes worktree: " + name);
  return path;
}

function validateGroup(group, root) {
  if (!group || typeof group.database !== "boolean" || !group.title || !group.effects || group.effects.database !== group.database ||
      !Array.isArray(group.effects.writes) || !Array.isArray(group.effects.services) || !Array.isArray(group.prerequisites) ||
      !Array.isArray(group.steps) || !group.steps.length || !group.steps.some(entry => entry.kind === "node-test")) throw invalid("Invalid/empty product group");
  const entries = [...group.prerequisites, ...group.steps];
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw invalid("Duplicate product entry");
  for (const entry of entries) {
    if (!/^[a-z0-9-]+$/.test(entry.id) || entry.skip || entry.optional || !strings(entry.command) ||
        !["check", "node-test"].includes(entry.kind) || !Array.isArray(entry.files)) throw invalid("Invalid/skipped product entry");
    if (entry.timeoutMs !== undefined && (!Number.isSafeInteger(entry.timeoutMs) || entry.timeoutMs < 100 || entry.timeoutMs > 900000)) throw invalid("Invalid timeout");
    entry.files.forEach(file => localFile(root, file));
    if (entry.kind === "node-test") {
      if (!strings(entry.testFiles) || new Set(entry.testFiles).size !== entry.testFiles.length) throw invalid("Missing/duplicate test files");
      entry.testFiles.forEach(file => localFile(root, file));
      const expected = [process.execPath, "--test", "--test-concurrency=1", "--test-reporter=" + reporterPath, ...entry.testFiles];
      if (JSON.stringify(entry.command) !== JSON.stringify(expected)) throw invalid("Tests must use exact files and structured Node reporter");
    }
  }
  if (group.database && group.prerequisites[0]?.id !== "test-database-target") throw invalid("Database target prerequisite must run first");
}

export function assertDatabaseWorktree(root) {
  const firstWorktree = git(root, ["worktree", "list", "--porcelain"]).split("\n")[0].replace(/^worktree /, "");
  if (realpathSync(root) !== realpathSync(firstWorktree) || git(root, ["branch", "--show-current"]).trim() !== "dev") {
    throw invalid("Database group is restricted to the coordinator's original dev worktree");
  }
}

function safeDirectory(root, components) {
  let path = root;
  for (const component of components) {
    path = join(path, component);
    if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
    if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw invalid("Unsafe product evidence directory");
  }
  return path;
}

function redactor(env) {
  const secrets = Object.entries(env).filter(([key, value]) => /password|secret|token|credential|database_url|api.?key|cookie/i.test(key) && typeof value === "string" && value.length >= 4).map(([, value]) => value).sort((a, b) => b.length - a.length);
  return value => {
    let text = String(value);
    for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
    return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
      .replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]");
  };
}

async function execute(entry, root, env) {
  const childEnv = Object.fromEntries(Object.entries(env).filter(([key]) => /^(PATH|HOME|TMPDIR|TMP|TEMP|SystemRoot|WINDIR|LANG|LC_ALL|TZ|CI)$/i.test(key)));
  return new Promise(accept => {
    let stdout = "", stderr = "", timedOut = false, overflow = false, spawnError;
    const child = spawn(entry.command[0], entry.command.slice(1), { cwd: root, env: childEnv, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const stop = () => {
      try { if (process.platform === "win32") child.kill("SIGKILL"); else process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") stderr += error.code; }
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, entry.timeoutMs ?? 120000);
    for (const stream of ["stdout", "stderr"]) child[stream].setEncoding("utf8").on("data", chunk => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + Buffer.byteLength(chunk) > 4 * 1024 * 1024) { overflow = true; stop(); return; }
      if (stream === "stdout") stdout += chunk; else stderr += chunk;
    });
    child.on("error", error => { spawnError = error.code; });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      accept({ stdout, stderr, exitCode, signal, timedOut, overflow, spawnError,
        effectiveExitCode: spawnError ? 127 : timedOut ? 124 : overflow ? 1 : exitCode ?? 1 });
    });
  });
}

export function testCounts(stdout, files, root) {
  const summaries = stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(event => event.type === "test:summary");
  const valid = data => data?.success === true && data.counts?.tests > 0 && data.counts.passed > 0 &&
    ["failed", "cancelled", "skipped", "todo"].every(key => data.counts[key] === 0);
  const summary = summaries.findLast(event => !event.data.file)?.data;
  if (!valid(summary)) throw new Error("No effective tests or failed/skipped/todo/cancelled cases");
  for (const file of files) {
    const event = summaries.find(event => event.data.file && resolve(root, event.data.file) === resolve(root, file));
    if (!valid(event?.data)) throw new Error("No effective tests for " + file);
  }
  return summary.counts;
}

// Dependency injection is for offline fixtures only. The CLI always uses the trusted catalog.
export async function runProduct({ group, expectedSha, serialDatabase = false, root = repositoryRoot,
  catalog = productCatalog, env = process.env, log = line => console.log(line) } = {}) {
  const report = { version: 1, scope: "selected-product-groups", productMatrix: "DEFERRED_CI_02", deferred: deferredMatrix,
    status: "FAIL", exitCode: 2, startedAt: new Date().toISOString(), groups: [], plan: [], entries: [] };
  const redact = redactor(env);
  let evidenceDirectory, lock;
  try {
    const names = group === "all" ? Object.keys(catalog) : [group];
    if (!names.length || names.some(name => !Object.hasOwn(catalog, name))) throw invalid("Unknown product group");
    report.groups = names;
    const evidenceRoot = safeDirectory(root, [".artifacts", "product-verification"]);
    evidenceDirectory = mkdtempSync(join(evidenceRoot, "run-"));
    report.baseline = captureBaseline(root);
    if (expectedSha !== undefined && expectedSha !== report.baseline.head) throw invalid("Expected SHA does not match tested HEAD");
    if (process.versions.node.split(".")[0] !== "24") throw invalid("Product verification requires Node 24");
    for (const name of names) {
      validateGroup(catalog[name], root);
      for (const [phase, entries] of [["prerequisites", catalog[name].prerequisites], ["steps", catalog[name].steps]]) {
        report.plan.push(...entries.map(entry => ({ group: name, phase, id: entry.id })));
      }
    }
    if (names.some(name => catalog[name].database)) {
      if (!serialDatabase) throw invalid("Database group requires the coordinator's serial lease (--serial-db)");
      assertDatabaseWorktree(root);
      const lockPath = join(evidenceRoot, "database.lock");
      try { mkdirSync(lockPath, { mode: 0o700 }); lock = lockPath; }
      catch { throw invalid("Database product lease is occupied; no stale-lock recovery or concurrent DB run"); }
    }
    for (const name of names) {
      const definition = catalog[name];
      for (const [phase, entries] of [["prerequisites", definition.prerequisites], ["steps", definition.steps]]) {
        for (const entry of entries) {
          const result = await execute(entry, root, env);
          const { stdout, stderr, ...outcome } = result;
          const record = { group: name, phase, id: entry.id, kind: entry.kind, command: entry.command,
            testFiles: entry.testFiles, effects: definition.effects, ...outcome, status: "FAIL" };
          report.entries.push(record);
          for (const [stream, value] of [["stdout", stdout], ["stderr", stderr]]) writeFileSync(join(evidenceDirectory, name + "-" + entry.id + "." + stream + ".log"), redact(value), { flag: "wx", mode: 0o600 });
          if (result.effectiveExitCode) throw Object.assign(new Error("Product command failed: " + entry.id), { exitCode: result.effectiveExitCode });
          if (entry.kind === "node-test") record.tests = testCounts(stdout, entry.testFiles, root);
          record.status = "PASS";
          log(JSON.stringify({ group: name, id: entry.id, status: record.status, tests: record.tests }));
        }
      }
    }
    report.status = "PASS";
    report.exitCode = 0;
  } catch (error) {
    report.error = redact(error.message);
    report.exitCode = error.exitCode || 1;
  } finally {
    if (report.baseline) {
      try {
        report.endBaseline = captureBaseline(root);
        if (JSON.stringify(report.baseline) !== JSON.stringify(report.endBaseline)) {
          report.error = "Source/HEAD changed during product verification";
          report.status = "FAIL"; report.exitCode = 1;
        }
      } catch { report.error = "Cannot confirm ending Git baseline"; report.status = "FAIL"; report.exitCode = 1; }
    }
    if (lock) rmdirSync(lock);
    report.notRun = report.plan.filter(planned => !report.entries.some(entry => entry.group === planned.group && entry.id === planned.id));
    report.finishedAt = new Date().toISOString();
    if (evidenceDirectory) writeFileSync(join(evidenceDirectory, "report.json"), redact(JSON.stringify(report, null, 2)) + "\n", { flag: "wx", mode: 0o600 });
  }
  log(JSON.stringify({ status: report.status, exitCode: report.exitCode, testedSha: report.baseline?.head, groups: report.groups, evidenceDirectory }));
  return { report, exitCode: report.exitCode, evidenceDirectory };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.list) console.log(JSON.stringify({ groups: productCatalog, deferred: deferredMatrix }, null, 2));
    else process.exitCode = (await runProduct(options)).exitCode;
  } catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1; }
}
