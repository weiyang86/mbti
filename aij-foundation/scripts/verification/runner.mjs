import { spawn, execFileSync } from "node:child_process";
import { constants } from "node:os";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryRoot, reporterPath, taskRegistry } from "./registry.mjs";

const invalid = (message) => Object.assign(new Error(message), { exitCode: 2 });
const nonemptyStrings = (value) => Array.isArray(value) && value.length > 0 && value.every((s) => typeof s === "string" && s.trim());

export function parseArguments(args) {
  if (args.filter((arg) => arg === "--").length > 1) throw invalid("Only one optional -- separator is allowed");
  const filtered = args.filter((arg) => arg !== "--");
  const manual = filtered.filter((arg) => arg === "--prepare-manual").length;
  const ids = filtered.filter((arg) => arg !== "--prepare-manual");
  if (manual > 1 || ids.length !== 1 || !/^AF-\d{3,}(?:-[A-Z])?$/.test(ids[0])) {
    throw invalid("Usage: verify:task [--] AF-NNN [--prepare-manual]");
  }
  return { taskId: ids[0], prepareManual: manual === 1 };
}

export function createRedactor(env = {}) {
  const secrets = new Set(Object.entries(env).filter(([key, value]) =>
    /password|secret|token|api.?key|authorization|cookie|database_url|credential|private_key/i.test(key) &&
    typeof value === "string" && value.length >= 4).map(([, value]) => value));
  const redact = (input) => {
    let text = String(input);
    for (const value of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(value).join("[REDACTED]");
    return text
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
      .replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
      .replace(/((?:"|')?(?:password|secret|token|api[_-]?key|authorization|cookie)(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, "$1[REDACTED]");
  };
  redact.addSecret = (value) => { if (value) secrets.add(value); };
  return redact;
}

function localFile(root, name) {
  if (typeof name !== "string" || !name || isAbsolute(name)) throw invalid("Registered file must be relative to task root");
  const path = resolve(root, name);
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel) || !existsSync(path) || !lstatSync(path).isFile()) {
    throw invalid("Missing or invalid registered file: " + name);
  }
  const actual = relative(realpathSync(root), realpathSync(path));
  if (actual.startsWith("..") || isAbsolute(actual)) throw invalid("Registered file escapes task root: " + name);
  readFileSync(path); // Access must actually succeed, not just exist.
  return path;
}

function validateEntry(entry, root, isTest = false) {
  if (!entry || !/^[a-z0-9-]+$/.test(entry.id) || !nonemptyStrings(entry.verification)) throw invalid("Missing id or verification items");
  if (entry.skip || entry.optional) throw invalid("Skipped or optional prerequisites/checks cannot PASS");
  if (entry.timeoutMs !== undefined && (!Number.isSafeInteger(entry.timeoutMs) || entry.timeoutMs < 1000 || entry.timeoutMs > 900000)) {
    throw invalid("Registered timeout must be an integer between 1000 and 900000 milliseconds");
  }
  if (!nonemptyStrings(entry.command) || entry.command.some((arg) => arg.includes("\0"))) throw invalid("Missing command argument array");
  if (!Array.isArray(entry.files)) throw invalid("Missing registered files array");
  entry.files.forEach((file) => localFile(root, file));
  const effects = entry.effects;
  if (!effects || !Array.isArray(effects.writes) || !Array.isArray(effects.services) ||
      typeof effects.testDatabase !== "boolean" || typeof effects.uniqueWriter !== "boolean") throw invalid("Missing explicit effects");
  if (isTest) {
    if (!nonemptyStrings(entry.testFiles) || new Set(entry.testFiles).size !== entry.testFiles.length) throw invalid("Missing test files");
    entry.testFiles.forEach((file) => {
      if (!/\.(test|spec)\.(mjs|cjs|js)$/.test(file)) throw invalid("Not a registered Node test file: " + file);
      localFile(root, file);
    });
    const expected = [process.execPath, "--test", "--test-reporter=" + reporterPath, ...entry.testFiles];
    if (JSON.stringify(entry.command) !== JSON.stringify(expected)) throw invalid("Test command must execute exactly the registered test files and structured reporter");
  }
}

function createEvidenceDirectory(root, taskId) {
  let path = root;
  for (const component of [".artifacts", "verification", taskId]) {
    path = join(path, component);
    if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) throw invalid("Unsafe evidence directory");
  }
  return mkdtempSync(join(path, "run-"));
}

function childEnvironment(env) {
  // Do not inherit .env, DB credentials, NODE_OPTIONS or a parent test-runner context.
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    /^(PATH|HOME|TMPDIR|TMP|TEMP|SystemRoot|WINDIR|CI|LANG|LC_ALL|TZ)$/i.test(key)));
}

async function execute(command, root, env, timeoutMs) {
  return new Promise((accept) => {
    let stdout = "", stderr = "", timedOut = false, overflow = false, spawnError;
    const child = spawn(command[0], command.slice(1), {
      cwd: root, env: childEnvironment(env), shell: false, stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32"
    });
    const stop = () => {
      try { if (process.platform === "win32") child.kill("SIGKILL"); else process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") stderr += error.message; }
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const collect = (stream, chunk) => {
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) + chunk.length > 4 * 1024 * 1024) {
        overflow = true; stop(); return;
      }
      if (stream === "stdout") stdout += chunk.toString(); else stderr += chunk.toString();
    };
    child.stdout.setEncoding("utf8").on("data", (chunk) => collect("stdout", chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => collect("stderr", chunk));
    child.on("error", (error) => { spawnError = error.code; stderr += error.message; });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      accept({
        exitCode: code ?? (signal ? 128 + (constants.signals[signal] || 1) : 127),
        signal, timedOut, overflow, stdout, stderr,
        effectiveExitCode: spawnError ? 127 : timedOut ? 124 : overflow ? 1 : code ?? (signal ? 128 + (constants.signals[signal] || 1) : 127)
      });
    });
  });
}

function testResult(stdout, files, root) {
  const events = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const summaries = events.filter((e) => e.type === "test:summary");
  const summary = summaries.findLast((e) => !e.data.file)?.data;
  const valid = (data) => data?.success === true && data.counts?.tests > 0 && data.counts.passed > 0 &&
    ["failed", "cancelled", "skipped", "todo"].every((key) => data.counts[key] === 0);
  if (!valid(summary)) throw new Error("No effective tests, failed tests or skipped/todo tests");
  for (const file of files) {
    const fileSummary = summaries.find((e) => e.data.file && resolve(e.data.file) === resolve(root, file));
    if (!valid(fileSummary?.data)) throw new Error("No effective tests for registered file: " + file);
  }
  return summary.counts;
}

export async function runTask(taskId, {
  root = repositoryRoot, registry = taskRegistry, prepareManual = false, env = process.env,
  log = (line) => console.log(line), timeoutMs = 60000
} = {}) {
  const redact = createRedactor(env);
  const scrub = (value) => {
    if (typeof value === "string") return redact(value);
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, /^(password|secret|token|api[_-]?key|authorization|cookie|database_url|credential|private_key)$/i.test(key) ? "[REDACTED]" : scrub(item)
    ]));
    return value;
  };
  const say = (value) => log(typeof value === "string" ? redact(value) : JSON.stringify(scrub(value)));
  const report = { taskId, mode: prepareManual ? "prepare-manual" : "verify", status: "FAIL", exitCode: 2,
    startedAt: new Date().toISOString(), prerequisites: [], steps: [], manual: [] };
  let evidenceDirectory;
  let exitCode = 2;
  const persistText = (name, value) => writeFileSync(join(evidenceDirectory, name), redact(value), { flag: "wx", mode: 0o600 });
  const persistJson = (name, value) => writeFileSync(join(evidenceDirectory, name), JSON.stringify(scrub(value), null, 2) + "\n", { flag: "wx", mode: 0o600 });
  try {
    if (!/^AF-\d{3,}(?:-[A-Z])?$/.test(taskId)) throw invalid("Invalid task ID");
    evidenceDirectory = createEvidenceDirectory(root, taskId);
    const task = Object.hasOwn(registry, taskId) ? registry[taskId] : null;
    if (!task) throw invalid("Unknown task: " + taskId);
    if (!Array.isArray(task.prerequisites) || !task.prerequisites.length) throw invalid("Missing prerequisites");
    if (!Array.isArray(task.steps) || !task.steps.length) throw invalid("Missing verification steps");
    const entries = [...task.prerequisites, ...task.steps];
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw invalid("Duplicate entry IDs");
    task.prerequisites.forEach((entry) => validateEntry(entry, root));
    task.steps.forEach((entry) => {
      if (!["node-test", "check"].includes(entry.kind)) throw invalid("Unknown verification kind");
      validateEntry(entry, root, entry.kind === "node-test");
    });
    if (entries.some((entry) => entry.effects.testDatabase) &&
        !task.prerequisites.some((entry) => entry.id === "test-database-target")) throw invalid("Missing test database target guard prerequisite");
    const hook = task.prepareManual;
    if (prepareManual && (!hook || hook.safe !== true || (!hook.command && typeof hook.run !== "function"))) throw invalid("No registered safe manual preparation hook");
    if (prepareManual) {
      validateEntry({ ...hook, command: hook.command || [process.execPath] }, root);
      if (hook.command) {
        // Explicitly registered local DB commands are reviewed code, not an arbitrary CLI escape.
        const declaredServices = new Set(task.steps.flatMap((entry) => entry.effects.services));
        const localWrites = [...(taskId === "AF-023" ? [".local-data/secrets/"] : []), ".artifacts/", ".local-data/postgres/", ...(["AF-013", "AF-014", "AF-015", "AF-016", "AF-017", "AF-018", "AF-019", "AF-020", "AF-021", "AF-022", "AF-023", "AF-024", "AF-025-A", "AF-028", "AF-029", "AF-030", "AF-031", "AF-032", "AF-033", "AF-035", "AF-036", "AF-037", "AF-038", "AF-039", "AF-040", "AF-041", "AF-043"].includes(taskId) ? [".local-data/seed/", ".local-data/auth/"] : [])];
        if (hook.run || hook.scope !== "owned-local-database" || !hook.effects.testDatabase ||
            !task.prerequisites.some((entry) => entry.id === "test-database-target") ||
            !hook.effects.services.length || hook.effects.services.some((service) => !declaredServices.has(service)) ||
            hook.effects.uniqueWriter || hook.effects.writes.some((path) => !localWrites.includes(path))) {
          throw invalid("Manual database command requires explicit owned services, target guard and local-only effects");
        }
      } else if (hook.effects.services.length || hook.effects.testDatabase || hook.effects.uniqueWriter ||
          hook.effects.writes.some((path) => !path.startsWith(".artifacts/"))) throw invalid("Manual hook is not artifact-only");
    }
    if (entries.some((entry) => entry.effects.uniqueWriter) && env.AIJ_VERIFY_WRITER !== taskId) throw invalid("Unique Writer acknowledgement required: AIJ_VERIFY_WRITER=" + taskId);
    report.title = task.title;
    const runEntry = async (entry, destination) => {
      say({ phase: destination, id: entry.id, command: entry.command, files: entry.files,
        verification: entry.verification, effects: entry.effects });
      const result = await execute(entry.command, root, env, entry.timeoutMs ?? timeoutMs);
      exitCode = result.effectiveExitCode;
      const record = { id: entry.id, command: entry.command, files: entry.files, testFiles: entry.testFiles, kind: entry.kind, verification: entry.verification,
        timeoutMs: entry.timeoutMs ?? timeoutMs, effects: entry.effects, exitCode: result.exitCode, signal: result.signal,
        timedOut: result.timedOut, overflow: result.overflow, effectiveExitCode: exitCode };
      report[destination].push(record);
      say({ id: entry.id, exitCode: result.exitCode, effectiveExitCode: exitCode, signal: result.signal });
      persistText(entry.id + ".stdout.log", result.stdout);
      persistText(entry.id + ".stderr.log", result.stderr);
      if (exitCode !== 0) throw Object.assign(new Error("Child command failed: " + entry.id), { exitCode });
      if (entry.kind === "node-test") {
        try { record.tests = testResult(result.stdout, entry.testFiles, root); }
        catch (error) { throw Object.assign(error, { exitCode: 1 }); }
      } else record.verifiedItems = entry.verification;
      say({ id: entry.id, ...record });
    };
    for (const entry of task.prerequisites) await runEntry(entry, "prerequisites");
    if (prepareManual) {
      if (hook.command) {
        await runEntry(hook, "manual");
        report.status = "PREPARED";
      } else {
      say({ phase: "manual", id: hook.id, verification: hook.verification, effects: hook.effects });
      const writeCredentials = (credentials) => {
        if (!credentials || typeof credentials.password !== "string" || !credentials.password) throw invalid("Synthetic credential password required");
        redact.addSecret(credentials.password);
        const path = join(evidenceDirectory, "credentials.json");
        execFileSync("git", ["--no-optional-locks", "check-ignore", "--quiet", "--", path], { cwd: root, stdio: "ignore" });
        writeFileSync(path, JSON.stringify(credentials, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        say("Synthetic credentials saved to ignored local file: " + path);
        return path;
      };
      const manualRecord = { id: hook.id, verification: hook.verification, effects: hook.effects, exitCode: null };
      report.manual.push(manualRecord);
      try {
        await hook.run({ writeCredentials, writeNote: (value) => persistJson("manual.json", value) });
        manualRecord.exitCode = 0;
      } catch (error) {
        manualRecord.exitCode = error.exitCode || 74;
        throw error;
      }
      report.status = "PREPARED"; // Preparation never certifies verification PASS.
      }
    } else {
      for (const entry of task.steps) await runEntry(entry, "steps");
      report.status = "PASS";
    }
    exitCode = 0;
  } catch (error) {
    // A log write error must not turn a child's exit 7 into either success or a different code.
    exitCode = error.exitCode ?? (exitCode !== 0 ? exitCode : 74);
    report.error = redact(error.message);
    report.status = "FAIL";
  }
  report.exitCode = exitCode;
  report.finishedAt = new Date().toISOString();
  try {
    if (!evidenceDirectory) throw new Error("Evidence directory unavailable");
    persistJson("report.json", report);
  } catch (error) {
    if (exitCode === 0) exitCode = 74;
    report.exitCode = exitCode;
    report.status = "FAIL";
    report.evidenceError = redact(error.message);
  }
  say({ taskId, status: report.status, exitCode, evidenceDirectory, error: report.error, evidenceError: report.evidenceError });
  return { exitCode, report: scrub(report), evidenceDirectory };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { taskId, prepareManual } = parseArguments(process.argv.slice(2));
    process.exitCode = (await runTask(taskId, { prepareManual })).exitCode;
  } catch (error) {
    console.error(createRedactor(process.env)(error.message));
    process.exitCode = error.exitCode || 2;
  }
}
