import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AUDIT_MAX_BYTES, ORIGINAL_DEV_ROOT } from "./production-dependency-security.mjs";
import { evaluateProductionHighAudit, parseAF181Gate, validateAF181OriginalDevGate, validateRemediationTargets } from "./production-dependency-remediation.mjs";

// No injected command/result, skip, audit-level filter, ignore, update, or install path.
test("AF-181 original dev audits ALL actual production dependencies; critical/high zero is release pending", { timeout: 75000 }, async () => {
  const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
  assert.equal(root, ORIGINAL_DEV_ROOT, "AUDIT_ORIGINAL_DEV_REQUIRED");
  const preflightCommand = (command, args, env) => {
    try { return execFileSync(command, args, { cwd: root, env, encoding: "utf8", timeout: 5000, maxBuffer: 16384, stdio: ["ignore", "pipe", "pipe"] }).trim(); }
    catch { throw new Error("AUDIT_PREFLIGHT_COMMAND_FAILED"); }
  };
  const git = (...args) => preflightCommand("git", args);
  const artifactRoot = join(root, ".artifacts", "af-181");
  // Gate is checked before writes or registry access, including when invoked from a child.
  let gate;
  try {
    const gatePath = join(artifactRoot, "live-gate.json");
    if (lstatSync(gatePath).isSymbolicLink() || !lstatSync(gatePath).isFile()) throw new Error("AUDIT_GATE_FILE_INVALID");
    gate = parseAF181Gate(readFileSync(gatePath, "utf8"));
  } catch { throw new Error("AUDIT_EXPLICIT_GATE_REQUIRED"); }
  const head = git("rev-parse", "HEAD");
  validateAF181OriginalDevGate({ root, gitRoot: realpathSync(git("rev-parse", "--show-toplevel")), branch: git("branch", "--show-current"), remote: git("remote", "get-url", "origin"), head, gate });
  for (const directory of [join(root, ".artifacts"), artifactRoot]) {
    if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error("AUDIT_ARTIFACT_DIRECTORY_INVALID");
  }
  const directory = mkdtempSync(join(artifactRoot, "production-audit-"));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const isolatedConfig = join(directory, "empty.npmrc");
  writeFileSync(isolatedConfig, "", { mode: 0o600, flag: "wx" });
  const hash = file => createHash("sha256").update(readFileSync(join(root, file))).digest("hex");
  const files = ["package.json", "apps/api/package.json", "apps/web/package.json", "pnpm-lock.yaml", "docs/execution/AF-181-package-updates.json"];
  const before = Object.fromEntries(files.map(file => [file, hash(file)]));
  const plan = JSON.parse(readFileSync(join(root, "docs/execution/AF-181-package-updates.json"), "utf8"));
  let targetFailureCode = null;
  try {
    validateRemediationTargets(plan, {
      manifests: Object.fromEntries(files.slice(0, 3).map(file => [file, JSON.parse(readFileSync(join(root, file), "utf8"))])),
      lockfile: readFileSync(join(root, "pnpm-lock.yaml"), "utf8"), registryMetadata: plan.registryEvidence,
      nodeVersion: process.versions.node, pnpmVersion: "10.0.0"
    });
  } catch (error) { targetFailureCode = /^REMEDIATION_[A-Z_]+$/.test(error.code ?? "") ? error.code : "REMEDIATION_TARGET_INPUT_FAILED"; }

  // Retain OS executable lookup only: never send application credentials/NODE_OPTIONS to pnpm.
  const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "SystemRoot"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, {
    npm_config_userconfig: isolatedConfig, npm_config_globalconfig: isolatedConfig,
    npm_config_registry: "https://registry.npmjs.org/", npm_config_audit_level: "low",
    npm_config_production: "true", npm_config_dev: "false", npm_config_optional: "true",
    npm_config_ignore_registry_errors: "false", npm_config_strict_ssl: "true",
    npm_config_fetch_retries: "0", npm_config_fetch_timeout: "45000", NO_COLOR: "1", CI: "true"
  });
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).packageManager, "pnpm@10.0.0", "Explicit audit adapter is pinned to pnpm 10.0.0");
  assert.equal(preflightCommand("pnpm", ["--version"], env) === "10.0.0", true, "Actual pnpm must match the frozen audit adapter");
  const processResult = await new Promise(resolve => {
    let stdout = "", bytes = 0, stderrBytes = 0, timedOut = false, outputExceeded = false, spawnError = false;
    const child = spawn("pnpm", ["audit", "--prod", "--json"], { cwd: root, env, shell: false, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    const stop = () => { try { if (process.platform === "win32") child.kill("SIGKILL"); else if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* process already exited */ } };
    const timer = setTimeout(() => { timedOut = true; stop(); }, 60000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => { bytes += Buffer.byteLength(chunk); if (bytes + stderrBytes > AUDIT_MAX_BYTES) { outputExceeded = true; stop(); } else stdout += chunk; });
    child.stderr.on("data", chunk => { stderrBytes += chunk.length; if (bytes + stderrBytes > AUDIT_MAX_BYTES) { outputExceeded = true; stop(); } });
    child.on("error", () => { spawnError = true; });
    child.on("close", (exitCode, signal) => { clearTimeout(timer); resolve({ stdout, exitCode, signal, timedOut, outputExceeded, spawnError, stderrBytes }); });
  });
  let evaluation, failureCode;
  try { evaluation = evaluateProductionHighAudit(processResult); } catch (error) { failureCode = /^AUDIT_[A-Z_]+$/.test(error.code ?? "") ? error.code : "AUDIT_EVALUATION_FAILED"; }
  const after = Object.fromEntries(files.map(file => [file, hash(file)]));
  const unchanged = JSON.stringify(before) === JSON.stringify(after) && git("rev-parse", "HEAD") === head && git("branch", "--show-current") === "dev" && git("remote", "get-url", "origin") === "git@github.com:weiyang86/aij-foundation.git";
  // Only safe fixed-shape evaluation persists; raw stderr/stdout/errors may contain credentials.
  const report = {
    schemaVersion: 1, taskId: "AF-181", recordedAt: new Date().toISOString(), head,
    command: ["pnpm", "audit", "--prod", "--json"], registry: "https://registry.npmjs.org/",
    exitCode: processResult.exitCode, timedOut: processResult.timedOut, outputExceeded: processResult.outputExceeded,
    spawnError: processResult.spawnError, stderrBytes: processResult.stderrBytes,
    stdoutSha256: createHash("sha256").update(processResult.stdout).digest("hex"),
    inputHashes: before, inputsUnchanged: unchanged, targetFailureCode,
    gateTaskId: gate.taskId, gateHead: gate.head, gateCreatedAt: gate.createdAt,
    targetStatus: targetFailureCode ? "REMEDIATION_TARGETS_REFUSED" : "DECLARED_AND_LOCKED_TARGETS_MATCH",
    status: !unchanged ? "AUDIT_INPUTS_CHANGED" : failureCode ? "AUDIT_REFUSED" : targetFailureCode ? "REMEDIATION_TARGETS_REFUSED" : evaluation.milestone, failureCode: failureCode ?? null,
    evaluation: evaluation ?? null, fullProductAcceptance: "PENDING_ROOT_SMOKE_AND_OWNER"
  };
  const reportPath = join(directory, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ reportPath, status: report.status, counts: evaluation?.counts ?? null, auditExitCode: processResult.exitCode }));
  assert.equal(unchanged, true, "Dependency input files or HEAD changed during audit");
  assert.equal(failureCode, undefined, "Actual production audit was refused; inspect safe report");
  assert.equal(targetFailureCode, null, "Planned dependency targets do not match actual manifests/lock");
  assert.equal(evaluation.highZero, true, "Production HIGH or CRITICAL advisories remain; full acceptance remains pending");
});
