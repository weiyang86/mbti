import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AUDIT_MAX_BYTES, ORIGINAL_DEV_ROOT } from "./production-dependency-security.mjs";
import { evaluateProductionHighAudit, parseAF181Gate, validateAF181OriginalDevGate, validateRemediationBeforeFiles, validateRemediationProposal, validateRemediationTargets } from "./production-dependency-remediation.mjs";

const plan = JSON.parse(readFileSync(new URL("../../docs/execution/AF-181-package-updates.json", import.meta.url)));
const clone = value => structuredClone(value);
const context = () => ({ manifests: clone(plan.before.manifests), registryMetadata: clone(plan.registryEvidence), nodeVersion: "24.21.0", pnpmVersion: "10.0.0" });
const rejects = (fn, code) => assert.throws(fn, error => error.code === code);
function fixture(severities = []) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }, advisories = {}, actions = [];
  for (const [index, severity] of severities.entries()) {
    const id = index + 1, name = index ? "unknown-package" : "multer";
    const path = `apps__api>${name}`;
    counts[severity]++;
    advisories[id] = { id, module_name: name, severity, url: "https://github.com/advisories/GHSA-q7qp-rjg7-q26m", findings: [{ version: "2.1.1", paths: [path] }], vulnerable_versions: "<2.5.0", patched_versions: ">=2.5.0", title: "SECRET_DO_NOT_PERSIST" };
    actions.push({ action: "review", resolves: [{ id, path, dev: false, optional: true, bundled: false }] });
  }
  return { actions, advisories, muted: [], metadata: { vulnerabilities: counts, dependencies: 30, devDependencies: 0, optionalDependencies: 2, totalDependencies: 32 } };
}
const evaluate = (audit, extra = {}) => evaluateProductionHighAudit({ stdout: JSON.stringify(audit), exitCode: Object.keys(audit.advisories).length ? 1 : 0, ...extra });
function post() {
  const manifests = clone(plan.before.manifests);
  for (const update of plan.updates) manifests[update.file][update.section][update.package] = update.newVersion;
  manifests["package.json"].pnpm = { overrides: Object.fromEntries(plan.overrides.map(o => [o.selector, o.newVersion])) };
  const lockfile = "lockfileVersion: '9.0'\n\noverrides:\n" + plan.overrides.map(o => `  '${o.selector}': ${o.newVersion}\n`).join("") + "\npackages:\n\n" + Object.values(plan.registryEvidence).map(p => `  '${p.name}@${p.version}':\n    resolution: {integrity: ${p.dist.integrity}}\n\n`).join("") + "snapshots:\n";
  return { ...context(), manifests, lockfile };
}

test("exact conditional proposal preserves contracts and has no applied/acceptance claim", () => {
  const result = validateRemediationProposal(plan, context());
  assert.equal(result.status, "CONDITIONAL_PROPOSAL_VALIDATED");assert.equal(result.applied, false);assert.equal(result.codeVerified, false);
  assert.equal(plan.before.audit.counts.high, 7);assert.equal(plan.before.audit.advisories.length, 10);
});
for (const [name, mutate] of [
  ["global override", p => p.overrides[0].selector = "deepmerge-ts"],
  ["range override", p => p.overrides[0].newVersion = "^8.0.0"],
  ["canary", p => p.updates[0].newVersion = "6.19.4-dev.1"],
  ["framework migration", p => p.updates.push({ package: "next", newVersion: "17.0.0" })],
  ["unnecessary Nest bump", p => p.updates.push({ package: "@nestjs/core", newVersion: "11.2.8" })],
  ["extra override", p => p.overrides.push({ selector: "qs", newVersion: "6.16.1" })]
]) test(`proposal refuses ${name}`, () => { const p = clone(plan);mutate(p);rejects(() => validateRemediationProposal(p, context()), "REMEDIATION_SCOPE_INVALID"); });

test("before snapshots cannot silently absorb unrelated changes", () => {
  const p = clone(plan), c = context();p.before.manifests["package.json"].scripts.test = "true";c.manifests = p.before.manifests;
  rejects(() => validateRemediationProposal(p, c), "REMEDIATION_BASE_MISMATCH");
});
for (const [name, mutate, code] of [
  ["wrong SRI", c => c.registryMetadata.multer.dist.integrity = "sha512-" + "A".repeat(86) + "==", "REMEDIATION_PROVENANCE_INVALID"],
  ["foreign tarball", c => c.registryMetadata.multer.dist.tarball = "https://example.com/x.tgz", "REMEDIATION_PROVENANCE_INVALID"],
  ["deprecated", c => c.registryMetadata.multer.deprecated = "unsupported", "REMEDIATION_REGISTRY_INVALID"],
  ["peer drift", c => c.registryMetadata["@nestjs/platform-express"].peerDependencies["@nestjs/core"] = "^12.0.0", "REMEDIATION_REGISTRY_INVALID"],
  ["engine drift", c => c.registryMetadata["deepmerge-ts"].engines.node = ">=26", "REMEDIATION_REGISTRY_INVALID"],
  ["Node major", c => c.nodeVersion = "26.0.0", "REMEDIATION_ENGINE_INVALID"],
  ["pnpm adapter", c => c.pnpmVersion = "10.1.0", "REMEDIATION_ENGINE_INVALID"]
]) test(`proposal refuses ${name}`, () => { const c = context();mutate(c);rejects(() => validateRemediationProposal(plan, c), code); });

test("authorized before blob contents must match exact hashes even after root applies updates", () => {
  const contents = Object.fromEntries(Object.keys(plan.before.hashes).map(file => [file, execFileSync("git", ["show", `55719998d8d6aafe18260c87d5c230352a16522b:${file}`], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 })]));
  validateRemediationBeforeFiles(plan, contents);contents["pnpm-lock.yaml"] += "\n";
  rejects(() => validateRemediationBeforeFiles(plan, contents), "REMEDIATION_BASE_HASH_MISMATCH");
});

test("post targets require exact manifest changes and registry SRI in lock", () => {
  assert.equal(validateRemediationTargets(plan, post()).status, "DECLARED_AND_LOCKED_TARGETS_MATCH");
  const c = post();c.manifests["apps/web/package.json"].dependencies.next = "17.0.0";
  rejects(() => validateRemediationTargets(plan, c), "REMEDIATION_POST_MANIFEST_MISMATCH");
});
for (const [name, mutate, code] of [
  ["old affected version", c => c.lockfile = c.lockfile.replace("multer@2.5.0", "multer@2.1.1"), "REMEDIATION_LOCK_TARGET_MISMATCH"],
  ["second affected copy", c => c.lockfile = c.lockfile.replace("snapshots:\n", "  'multer@2.1.1':\n    resolution: {integrity: sha512-AA==}\n\nsnapshots:\n"), "REMEDIATION_LOCK_TARGET_MISMATCH"],
  ["wrong locked SRI", c => c.lockfile = c.lockfile.replace(plan.registryEvidence.multer.dist.integrity, "sha512-AA=="), "REMEDIATION_LOCK_INTEGRITY_MISMATCH"],
  ["truncated lock", c => c.lockfile = c.lockfile.replace("snapshots:\n", ""), "REMEDIATION_LOCK_INVALID"],
  ["duplicate entry", c => c.lockfile = c.lockfile.replace("snapshots:\n", "  'multer@2.5.0':\n    resolution: {integrity: sha512-AA==}\n\nsnapshots:\n"), "REMEDIATION_LOCK_INVALID"]
]) test(`post targets refuse ${name}`, () => { const c = post();mutate(c);rejects(() => validateRemediationTargets(plan, c), code); });

test("high-zero does not call remaining moderate/low or exit1 clean release", () => {
  const r = evaluate(fixture(["moderate", "low"]));assert.equal(r.highZero, true);assert.equal(r.auditExitCode, 1);assert.equal(r.counts.total, 2);assert.equal(r.fullSecurityAcceptance, false);assert.equal(r.releaseStatus, "OWNER_CHECK_PENDING");
  assert.equal(r.advisories[1].module, "unknown-package");assert.deepEqual(r.advisories[1].paths, ["apps__api>unknown-package"]);assert.equal(r.advisories[1].officialReferences.length, 1);assert.ok(!JSON.stringify(r).includes("SECRET_DO_NOT_PERSIST"));
});
for (const severity of ["high", "critical"]) test(`unknown optional production ${severity} cannot be ignored`, () => {
  const r = evaluate(fixture(["moderate", severity]));assert.equal(r.highZero, false);assert.equal(r.counts[severity], 1);assert.equal(r.advisories[1].module, "unknown-package");
});
test("zero advisory audit requires actual exit0", () => { assert.equal(evaluate(fixture()).highZero, true);rejects(() => evaluate(fixture(), { exitCode: 1 }), "AUDIT_EXIT_COUNTS_MISMATCH"); });
for (const [name, extra, code] of [
  ["network error", { exitCode: 2 }, "AUDIT_EXIT_INVALID"],
  ["signal", { signal: "SIGTERM" }, "AUDIT_PROCESS_FAILED"],
  ["timeout", { timedOut: true }, "AUDIT_PROCESS_FAILED"],
  ["output limit", { outputExceeded: true }, "AUDIT_PROCESS_FAILED"],
  ["spawn error", { spawnError: true }, "AUDIT_PROCESS_FAILED"],
  ["truncated JSON", { stdout: '{"advisories":' }, "AUDIT_JSON_INVALID"],
  ["empty", { stdout: "" }, "AUDIT_OUTPUT_INVALID"],
  ["oversized", { stdout: " ".repeat(AUDIT_MAX_BYTES + 1) }, "AUDIT_OUTPUT_INVALID"],
  ["duplicate key", { stdout: JSON.stringify(fixture()).replace('"muted":[]', '"muted":[],"muted":[]') }, "AUDIT_DUPLICATE_KEY"]
]) test(`shared evaluator fails closed: ${name}`, () => rejects(() => evaluate(fixture(), extra), code));
for (const [name, mutate, code] of [
  ["muted finding", a => a.muted.push(1), "AUDIT_SUPPRESSION_FORBIDDEN"],
  ["unknown top-level error", a => a.error = { code: "NETWORK" }, "AUDIT_SCHEMA_INVALID"],
  ["wrong severity count", a => a.metadata.vulnerabilities.high++, "AUDIT_COUNTS_MISMATCH"],
  ["dev scope", a => { a.metadata.devDependencies++;a.metadata.totalDependencies++; }, "AUDIT_PRODUCTION_SCOPE_INVALID"],
  ["missing advisory action path", a => a.actions = [], "AUDIT_PATH_COVERAGE_INVALID"],
  ["unsafe path", a => a.actions[0].resolves[0].path = "../../secret", "AUDIT_UNSAFE_PATH"]
]) test(`shared evaluator refuses ${name}`, () => { const a = fixture(["high"]);mutate(a);rejects(() => evaluate(a), code); });

const now = Date.parse("2026-11-05T21:00:00Z"), head = "a".repeat(40);
const gateContext = () => ({ root: ORIGINAL_DEV_ROOT, gitRoot: ORIGINAL_DEV_ROOT, branch: "dev", remote: "git@github.com:weiyang86/aij-foundation.git", head, now, gate: { schemaVersion: 1, taskId: "AF-181", allowProductionAudit: true, head, createdAt: new Date(now).toISOString() } });
test("AF181 root gate is explicit, HEAD-bound and time-bound", () => validateAF181OriginalDevGate(gateContext()));
for (const [name, mutate, code] of [
  ["AF177 gate", c => c.gate.taskId = "AF-177", "AUDIT_EXPLICIT_GATE_REQUIRED"],
  ["old HEAD", c => c.gate.head = "b".repeat(40), "AUDIT_EXPLICIT_GATE_REQUIRED"],
  ["expired", c => c.gate.createdAt = new Date(now - 1800001).toISOString(), "AUDIT_EXPLICIT_GATE_REQUIRED"],
  ["future", c => c.gate.createdAt = new Date(now + 5001).toISOString(), "AUDIT_EXPLICIT_GATE_REQUIRED"],
  ["extra bypass", c => c.gate.skip = true, "AUDIT_EXPLICIT_GATE_REQUIRED"],
  ["child worktree", c => c.root = "/tmp/worker", "AUDIT_ORIGINAL_DEV_REQUIRED"],
  ["non-dev", c => c.branch = "main", "AUDIT_ORIGINAL_DEV_REQUIRED"],
  ["wrong remote", c => c.remote = "git@example.com:other.git", "AUDIT_ORIGINAL_DEV_REQUIRED"]
]) test(`AF181 gate refuses ${name}`, () => { const c = gateContext();mutate(c);rejects(() => validateAF181OriginalDevGate(c), code); });

test("actual live entry refuses child before registry access or artifact writes", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url)).replace(/\/$/, "");
  // On original dev this unit test validates only the pure guard; the registered
  // live test is run separately by root with the explicit, fresh AF181 gate.
  if (root === ORIGINAL_DEV_ROOT) {
    const c = gateContext();c.root = "/tmp/child";rejects(() => validateAF181OriginalDevGate(c), "AUDIT_ORIGINAL_DEV_REQUIRED");return;
  }
  const r = spawnSync(process.execPath, ["--test", fileURLToPath(new URL("./production-high-dependencies-live.test.mjs", import.meta.url))], { cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 65536, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(r.status, 1);assert.match(r.stdout, /AUDIT_ORIGINAL_DEV_REQUIRED/);
});

test("gate JSON parser rejects duplicate, escaped, malformed and oversized inputs", () => {
  const raw = JSON.stringify(gateContext().gate);assert.deepEqual(parseAF181Gate(raw), gateContext().gate);
  for (const source of [raw.replace('"taskId":"AF-181"', '"taskId":"AF-177","taskId":"AF-181"'), raw.slice(0, -1), " ".repeat(4097), raw.replace('"taskId"', '"\\u0074askId"')]) rejects(() => parseAF181Gate(source), "AUDIT_EXPLICIT_GATE_REQUIRED");
});

test("lock override declarations cannot be global, omitted or ranged", () => {
  for (const replacement of ["'deepmerge-ts': 8.0.0", "'@prisma/config@6.19.3>deepmerge-ts': ^8.0.0", "'@prisma/config@6.19.3>deepmerge-ts': 7.1.5"]) {
    const c = post();c.lockfile = c.lockfile.replace("'@prisma/config@6.19.3>deepmerge-ts': 8.0.0", replacement);
    rejects(() => validateRemediationTargets(plan, c), "REMEDIATION_LOCK_OVERRIDE_MISMATCH");
  }
});
