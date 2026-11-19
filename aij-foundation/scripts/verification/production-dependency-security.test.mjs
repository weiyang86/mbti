import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AUDIT_MAX_BYTES, evaluateProductionAudit, ORIGINAL_DEV_ROOT, validateOriginalDevGate, validateSecurityProposal } from "./production-dependency-security.mjs";

// Stored public synthetic fixtures shaped like the observed pnpm 10 report. They prove
// evaluator behavior only; they are never installed packages or product/live audit evidence.
const stored = {
  critical: `{"actions":[{"action":"review","module":"next","resolves":[{"id":1193676,"path":"apps__web>next","dev":false,"optional":false,"bundled":false}]}],"advisories":{"1193676":{"id":1193676,"module_name":"next","severity":"critical","url":"https://github.com/advisories/GHSA-p293-qw3h-jr36","vulnerable_versions":">=16.0.0 <16.3.3","patched_versions":">=16.3.3","findings":[{"version":"16.2.6","paths":[]}]}},"muted":[],"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":1},"dependencies":333,"devDependencies":0,"optionalDependencies":0,"totalDependencies":333}}`,
  high: `{"actions":[{"action":"review","module":"effect","resolves":[{"id":1115356,"path":"apps__api>@prisma/client>prisma>@prisma/config>effect","dev":false,"optional":false,"bundled":false}]}],"advisories":{"1115356":{"id":1115356,"module_name":"effect","severity":"high","url":"https://github.com/advisories/GHSA-38f7-945m-qr2g","vulnerable_versions":"<3.20.0","patched_versions":">=3.20.0","findings":[{"version":"3.18.4","paths":[]}]}},"muted":[],"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":1,"critical":0},"dependencies":333,"devDependencies":0,"optionalDependencies":0,"totalDependencies":333}}`,
  clean: `{"actions":[],"advisories":{},"muted":[],"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0},"dependencies":333,"devDependencies":0,"optionalDependencies":0,"totalDependencies":333}}`
};
const parse = name => JSON.parse(stored[name]);
const evaluate = (data, exitCode = 1) => evaluateProductionAudit({ stdout: typeof data === "string" ? data : JSON.stringify(data), exitCode });
function refusal(data, code, exitCode = 1) { assert.throws(() => evaluate(data, exitCode), error => error.code === code); }

test("known critical is refused with public package, severity, advisory and actual action path", () => {
  const result = evaluate(stored.critical);
  assert.equal(result.criticalZero, false);
  assert.equal(result.milestone, "CRITICAL_PRESENT");
  assert.deepEqual(result.counts, { info: 0, low: 0, moderate: 0, high: 0, critical: 1, total: 1 });
  assert.deepEqual(result.advisories[0].paths, ["apps__web>next"]);
  assert.deepEqual(result.advisories[0].officialReferences, ["https://github.com/advisories/GHSA-p293-qw3h-jr36"]);
});

test("future unknown package/ID critical is counted even when every known Next critical disappears", () => {
  const data = parse("critical"), advisory = data.advisories[1193676];
  advisory.id = 999999999; advisory.module_name = "@future/unknown-package";
  advisory.url = "https://github.com/advisories/GHSA-aaaa-bbbb-cccc";
  advisory.vulnerable_versions = "*"; advisory.patched_versions = null;
  data.advisories = { 999999999: advisory };
  data.actions[0].module = advisory.module_name;
  data.actions[0].resolves[0].id = advisory.id;
  data.actions[0].resolves[0].path = "apps__api>@future/unknown-package";
  const result = evaluate(data);
  assert.equal(result.criticalZero, false);
  assert.equal(result.counts.critical, 1);
  assert.equal(result.advisories[0].module, "@future/unknown-package");
  assert.equal(result.advisories[0].patchedVersions, null);
});

test("critical zero with high still captures audit exit 1 and leaves release/security pending", () => {
  const result = evaluate(stored.high);
  assert.equal(result.criticalZero, true);
  assert.equal(result.auditExitCode, 1);
  assert.equal(result.milestone, "CRITICAL_ZERO_RELEASE_PENDING");
  assert.equal(result.releaseStatus, "OWNER_CHECK_PENDING");
  assert.equal(result.fullSecurityAcceptance, false);
  assert.equal(result.counts.high, 1);
  assert.equal(result.advisories[0].paths[0], "apps__api>@prisma/client>prisma>@prisma/config>effect");
});

test("zero advisories requires exit 0 and still cannot grant full product acceptance", () => {
  const result = evaluate(stored.clean, 0);
  assert.equal(result.criticalZero, true); assert.equal(result.counts.total, 0);
  assert.equal(result.fullSecurityAcceptance, false);
  refusal(stored.clean, "AUDIT_EXIT_COUNTS_MISMATCH");
  refusal(stored.high, "AUDIT_EXIT_COUNTS_MISMATCH", 0);
});

test("noncritical severities and multiple paths remain inspectable without inflating advisory counts", () => {
  const data = parse("high"), sample = data.advisories[1115356];
  for (const [index, severity] of ["low", "moderate", "info"].entries()) {
    const id = 2000000 + index;
    data.advisories[id] = { ...structuredClone(sample), id, severity };
    data.metadata.vulnerabilities[severity]++;
    data.actions[0].resolves.push({ id, path: "apps__api>effect", dev: false, optional: false, bundled: false });
  }
  data.actions[0].resolves.push({ id: 1115356, path: "packages__extra>effect", dev: false, optional: true, bundled: false });
  const result = evaluate(data);
  assert.deepEqual(result.counts, { info: 1, low: 1, moderate: 1, high: 1, critical: 0, total: 4 });
  assert.equal(result.advisories[0].paths.length, 2);
});

test("installed pnpm paths with importer/version and registry action paths are both validated", () => {
  const data = parse("critical");
  data.advisories[1193676].findings[0].paths = [". > next@16.2.6", "apps/web > next@16.2.6"];
  const result = evaluate(data);
  assert.deepEqual(result.advisories[0].paths, [". > next@16.2.6", "apps/web > next@16.2.6", "apps__web>next"]);
  const nested = parse("high");
  nested.advisories[1115356].findings[0].paths = ["apps/api > @prisma/client@6.19.0 > prisma@6.19.0 > @prisma/config@6.19.0 > effect@3.18.4"];
  assert.equal(evaluate(nested).advisories[0].paths.length, 2);
});

test("metadata/advisory counts, types, IDs and coverage must agree", () => {
  for (const mutate of [
    d => { d.metadata.vulnerabilities.critical = 0; },
    d => { d.metadata.vulnerabilities.high = 2; }
  ]) { const d = parse("critical"); mutate(d); refusal(d, "AUDIT_COUNTS_MISMATCH"); }
  for (const mutate of [
    d => { d.metadata.vulnerabilities.high = "0"; },
    d => { d.metadata.vulnerabilities.critical = -1; },
    d => { d.metadata.vulnerabilities.critical = 0.5; },
    d => { d.advisories[1193676].id = 123; },
    d => { d.actions[0].resolves[0].id = 123; },
    d => { delete d.metadata.vulnerabilities.critical; },
    d => { d.advisories[1193676].severity = "fatal"; },
    d => { d.metadata.vulnerabilities.fatal = 1; }
  ]) { const d = parse("critical"); mutate(d); refusal(d, "AUDIT_SCHEMA_INVALID"); }
  const noPaths = parse("critical"); noPaths.actions = []; refusal(noPaths, "AUDIT_PATH_COVERAGE_INVALID");
  const dependencyCounts = parse("critical"); dependencyCounts.metadata.totalDependencies = 1; refusal(dependencyCounts, "AUDIT_DEPENDENCY_COUNTS_MISMATCH");
});

test("malformed, truncated, unknown and network/error schema fail closed without reflecting output", () => {
  for (const data of ["{", stored.critical.slice(0, -9), "registry warning\n" + stored.clean]) refusal(data, "AUDIT_JSON_INVALID");
  for (const data of ["{}", "[]", "null", '{"error":{"code":"ECONNRESET","message":"secret-never-print"}}', '{"auditReportVersion":2,"vulnerabilities":{},"metadata":{}}']) refusal(data, "AUDIT_SCHEMA_INVALID");
  for (const mutate of [d => { d.error = "secret-never-print"; }, d => { delete d.advisories; }, d => { d.advisories = []; }, d => { d.advisories[1193676].newSchema = {}; }]) {
    const d = parse("critical"); mutate(d); refusal(d, "AUDIT_SCHEMA_INVALID");
  }
  refusal(stored.critical.replace('"critical":1', '"critical":1,"critical":0'), "AUDIT_DUPLICATE_KEY");
  refusal(stored.critical.replace('"critical":1', '"critical":1,"criti\\u0063al":0'), "AUDIT_DUPLICATE_KEY");
});

test("muting, dev scope, unsafe references/control characters and malformed findings are refused", () => {
  const muted = parse("critical"); muted.muted = [1193676]; refusal(muted, "AUDIT_SUPPRESSION_FORBIDDEN");
  const dev = parse("critical"); dev.metadata.devDependencies = 1; dev.metadata.totalDependencies++; refusal(dev, "AUDIT_PRODUCTION_SCOPE_INVALID");
  const actionDev = parse("critical"); actionDev.actions[0].resolves[0].dev = true; refusal(actionDev, "AUDIT_PRODUCTION_SCOPE_INVALID");
  for (const mutate of [
    d => { d.advisories[1193676].module_name = "next\nSECRET"; },
    d => { d.advisories[1193676].url = "https://user:password@github.com/advisories/GHSA-p293-qw3h-jr36"; },
    d => { d.advisories[1193676].url += "?token=secret"; },
    d => { d.advisories[1193676].findings = []; },
    d => { d.advisories[1193676].findings[0].paths = ["Bearer secret"]; },
    d => { d.actions[0].resolves[0].path = "https://user:secret@example.com"; },
    d => { d.advisories[1193676].github_advisory_id = "GHSA-aaaa-bbbb-cccc"; }
  ]) { const d = parse("critical"); mutate(d); refusal(d, "AUDIT_SCHEMA_INVALID"); }
  const editorial = parse("critical"); editorial.advisories[1193676].overview = "secret-never-print";
  assert.equal(JSON.stringify(evaluate(editorial)).includes("secret-never-print"), false);
});

test("process deadlines, caps, signals, errors and unexpected exit cannot become a clean audit", () => {
  for (const processState of [{ timedOut: true }, { outputExceeded: true }, { spawnError: true }, { signal: "SIGKILL" }]) {
    assert.throws(() => evaluateProductionAudit({ stdout: stored.clean, exitCode: 0, ...processState }), { code: "AUDIT_PROCESS_FAILED" });
  }
  for (const exitCode of [null, 2, 127, -1, "1"]) assert.throws(() => evaluateProductionAudit({ stdout: stored.clean, exitCode }), { code: "AUDIT_EXIT_INVALID" });
  refusal(" ".repeat(AUDIT_MAX_BYTES + 1), "AUDIT_OUTPUT_INVALID");
  refusal("", "AUDIT_OUTPUT_INVALID");
});

const proposal = JSON.parse(readFileSync(new URL("../../docs/execution/AF-177-package-updates.json", import.meta.url)));
// Public registry snapshots restricted to fields consumed by the proposal validator.
const registryMetadata = {
  next: { name: "next", version: "16.4.1", license: "MIT", engines: { node: ">=20.9.0" },
    peerDependencies: { react: "^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0", "react-dom": "^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0" },
    dependencies: { "@next/env": "16.4.1", postcss: "8.5.23" }, optionalDependencies: { sharp: "^0.35.5" },
    dist: { tarball: "https://registry.npmjs.org/next/-/next-16.4.1.tgz", integrity: "sha512-uc657V62E34fOI6W5NtG9IzwsPcms0Z60grz2MJGtglgD+pTFnNt4Yw2PzaU622tfX4vhrDgLZzicE2YlhI20Q==" } },
  "eslint-config-next": { name: "eslint-config-next", version: "16.4.1", license: "MIT", peerDependencies: { eslint: ">=9.0.0", typescript: ">=3.3.1" },
    dependencies: { "@next/eslint-plugin-next": "16.4.1" },
    dist: { tarball: "https://registry.npmjs.org/eslint-config-next/-/eslint-config-next-16.4.1.tgz", integrity: "sha512-6AsojbCfRdpWkP6BIUnMBv3MH4OvtfmH9p4hSfLh8ZgsW7nfhu7DpUMNBB7leisDyyMz+YYxTc+NAdBOQfovlA==" } }
};
const engines = { node: ">=24.0.0 <25", pnpm: ">=10.0.0 <11" };
const planContext = { nodeVersion: "24.21.0", pnpmVersion: "10.0.0", registryMetadata, manifests: {
  "package.json": { packageManager: "pnpm@10.0.0", engines, devDependencies: { "eslint-config-next": "16.2.6", eslint: "9.39.2", typescript: "5.9.3" } },
  "apps/web/package.json": { engines, dependencies: { next: "16.2.6", react: "19.2.6", "react-dom": "19.2.6" } },
  "apps/api/package.json": { engines, dependencies: { htmlparser2: "10.1.0" } }
} };

test("actual proposal is exact minimal same-major stable, paired, and compatible with frozen baseline", () => {
  assert.deepEqual(validateSecurityProposal(proposal, planContext), { status: "PROPOSAL_COMPATIBILITY_CHECKED", applied: false, productAcceptance: "NOT_RUN", nodeVersion: "24.21.0", pnpmVersion: "10.0.0" });
  assert.equal(proposal.criticalAdvisories.length, 5);
  assert.equal(proposal.remainingBaselineFindings.length, 10);
  assert.equal(proposal.remainingBaselineFindings.filter(f => f.severity === "high").length, 7);
});

test("proposal refuses range/canary/major upgrades, unrelated changes, overrides and stale bases", () => {
  for (const version of ["^16.4.1", "latest", "16.4.1-canary.1", "17.0.0", "16.3.6"]) {
    const plan = structuredClone(proposal); plan.updates[0].newVersion = version;
    assert.throws(() => validateSecurityProposal(plan, planContext));
  }
  for (const mutate of [p => p.updates.push({ package: "react", newVersion: "20.0.0" }), p => p.overrides.push({ package: "next", version: "16.4.1" }), p => { p.updates[1].file = "apps/api/package.json"; }]) {
    const plan = structuredClone(proposal); mutate(plan); assert.throws(() => validateSecurityProposal(plan, planContext), { code: "PLAN_SCOPE_INVALID" });
  }
  const context = structuredClone(planContext); context.manifests["apps/web/package.json"].dependencies.next = "16.0.0";
  assert.throws(() => validateSecurityProposal(proposal, context), { code: "PLAN_BASE_VERSION_MISMATCH" });
});

test("proposal validates actual engine/peer/provenance/native closure constraints and htmlparser2 preservation", () => {
  const cases = [
    [c => { c.nodeVersion = "20.8.0"; }, "PLAN_ENGINE_INVALID"],
    [c => { c.nodeVersion = "25.0.0"; }, "PLAN_ENGINE_INVALID"],
    [c => { c.pnpmVersion = "11.0.0"; }, "PLAN_ENGINE_INVALID"],
    [c => { c.registryMetadata.next.engines.node = ">=26"; }, "PLAN_ENGINE_INVALID"],
    [c => { c.manifests["apps/web/package.json"].dependencies.react = "18.2.0"; }, "PLAN_PEER_INVALID"],
    [c => { c.manifests["apps/web/package.json"].dependencies["react-dom"] = "19.1.0"; }, "PLAN_PEER_INVALID"],
    [c => { c.manifests["package.json"].devDependencies.eslint = "8.57.0"; }, "PLAN_PEER_INVALID"],
    [c => { c.manifests["apps/api/package.json"].dependencies.htmlparser2 = "11.0.0"; }, "PLAN_PRESERVED_DEPENDENCY_INVALID"],
    [c => { c.registryMetadata.next.dist.tarball = "https://example.com/next.tgz"; }, "PLAN_PROVENANCE_MISMATCH"],
    [c => { c.registryMetadata.next.dist.integrity = "sha512-different"; }, "PLAN_PROVENANCE_MISMATCH"],
    [c => { c.registryMetadata.next.optionalDependencies.sharp = "^0.34.5"; }, "PLAN_CLOSURE_INVALID"],
    [c => { c.registryMetadata.next.deprecated = "unsupported"; }, "PLAN_REGISTRY_MISMATCH"]
  ];
  for (const [mutate, code] of cases) { const context = structuredClone(planContext); mutate(context); assert.throws(() => validateSecurityProposal(proposal, context), { code }); }
});

test("root live gate rejects children/foreign branches and stale/mismatched or absent explicit approval", () => {
  const now = Date.parse("2026-11-06T02:00:00.000Z"), head = "a".repeat(40);
  const valid = { root: ORIGINAL_DEV_ROOT, gitRoot: ORIGINAL_DEV_ROOT, branch: "dev", remote: "git@github.com:weiyang86/aij-foundation.git", head, now,
    gate: { schemaVersion: 1, taskId: "AF-177", allowProductionAudit: true, head, createdAt: new Date(now).toISOString() } };
  validateOriginalDevGate(valid);
  for (const mutate of [
    v => { v.root = "/Users/lei/orca/workspaces/aij-foundation/AIJ-W11-AF177"; },
    v => { v.gitRoot = "/tmp/copy"; }, v => { v.branch = "main"; }, v => { v.remote = "git@example.com:foreign/repo.git"; },
    v => { v.gate.allowProductionAudit = false; }, v => { v.gate.head = "b".repeat(40); },
    v => { v.gate.createdAt = new Date(now - 31 * 60 * 1000).toISOString(); }, v => { v.gate.createdAt = new Date(now + 60000).toISOString(); },
    v => { v.gate = null; }, v => { v.gate.taskId = "AF-178"; }
  ]) { const value = structuredClone(valid); mutate(value); assert.throws(() => validateOriginalDevGate(value)); }
});

test("stored-input CLI reports real evaluation exits and never echoes network credential text", () => {
  const directory = mkdtempSync(join(tmpdir(), "aij-af177-audit-"));
  const file = join(directory, "public-synthetic.json"), helper = fileURLToPath(new URL("./production-dependency-security.mjs", import.meta.url));
  try {
    for (const [data, auditExit, expectedExit] of [[stored.critical, 1, 1], [stored.high, 1, 0], [stored.clean, 0, 0], ['{"error":"secret-never-print"}', 1, 2]]) {
      writeFileSync(file, data);
      const child = spawnSync(process.execPath, [helper, "--audit-file", file, "--audit-exit-code", String(auditExit)], { encoding: "utf8", timeout: 5000 });
      assert.equal(child.status, expectedExit);
      assert.equal((child.stdout + child.stderr).includes("secret-never-print"), false);
      if (expectedExit !== 2) assert.equal(JSON.parse(child.stdout).evidence, "STORED_INPUT_ONLY_NOT_LIVE_PROOF");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
