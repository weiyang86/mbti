import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const AUDIT_MAX_BYTES = 8 * 1024 * 1024;
export const ORIGINAL_DEV_ROOT = "/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation";
const severities = ["info", "low", "moderate", "high", "critical"];
const advisoryFields = ["findings", "found_by", "deleted", "references", "created", "id", "npm_advisory_id", "overview", "reported_by", "title", "metadata", "cves", "access", "severity", "module_name", "vulnerable_versions", "github_advisory_id", "recommendation", "patched_versions", "updated", "cvss", "cwe", "url"];
const packagePattern = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/;
const stablePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ghsaPattern = /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/;
const invalid = code => Object.assign(new Error(code), { code });
function requireValue(condition, code = "AUDIT_SCHEMA_INVALID") { if (!condition) throw invalid(code); }
function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function keys(value, required, optional = []) {
  requireValue(record(value));
  requireValue(required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key)));
}
function safeText(value, max = 300) {
  return typeof value === "string" && value.length > 0 && value.length <= max && [...value].every(character => character.codePointAt(0) >= 32 && character.codePointAt(0) !== 127);
}
function safePath(value) {
  if (!safeText(value, 2000)) return false;
  // Registry action paths and pnpm's installed-tree paths have distinct public shapes.
  return value.split(/ *> */).every((part, index) => {
    if (index === 0 && (part === "." || /^[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/.test(part))) return true;
    const match = part.match(/^((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:@(.+))?$/);
    return !!match && (!match[2] || versionPattern.test(match[2]));
  });
}
function count(value) { return Number.isSafeInteger(value) && value >= 0; }

function rejectDuplicateKeys(source) {
  // JSON.parse validates grammar first; this pass prevents duplicate keys silently
  // overwriting a critical advisory or count. No source values enter error messages.
  const stack = [];
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"') {
      const start = index;
      for (index++; index < source.length; index++) {
        if (source[index] === "\\") index++;
        else if (source[index] === '"') break;
      }
      const frame = stack.at(-1);
      if (frame?.object && frame.expectKey) {
        const key = JSON.parse(source.slice(start, index + 1));
        requireValue(!frame.keys.has(key), "AUDIT_DUPLICATE_KEY");
        frame.keys.add(key);
      }
    } else if (character === "{" || character === "[") {
      requireValue(stack.length < 100, "AUDIT_SCHEMA_INVALID");
      stack.push({ object: character === "{", expectKey: true, keys: new Set() });
    } else if (character === "}" || character === "]") stack.pop();
    else if (character === ":" && stack.at(-1)?.object) stack.at(-1).expectKey = false;
    else if (character === "," && stack.at(-1)?.object) stack.at(-1).expectKey = true;
  }
}

// Adapter for pnpm 10's legacy audit JSON. A new transport/schema needs an explicit adapter.
// Editorial advisory text and arbitrary process output never enter the returned report.
export function evaluateProductionAudit({ stdout, exitCode, signal = null, timedOut = false, outputExceeded = false, spawnError = false }) {
  requireValue(signal === null && timedOut === false && outputExceeded === false && spawnError === false, "AUDIT_PROCESS_FAILED");
  requireValue(exitCode === 0 || exitCode === 1, "AUDIT_EXIT_INVALID");
  requireValue(typeof stdout === "string" && Buffer.byteLength(stdout) > 0 && Buffer.byteLength(stdout) <= AUDIT_MAX_BYTES, "AUDIT_OUTPUT_INVALID");
  let audit;
  try { audit = JSON.parse(stdout); } catch { throw invalid("AUDIT_JSON_INVALID"); }
  rejectDuplicateKeys(stdout);
  keys(audit, ["actions", "advisories", "muted", "metadata"]);
  requireValue(Array.isArray(audit.actions) && record(audit.advisories) && Array.isArray(audit.muted));
  requireValue(audit.muted.length === 0, "AUDIT_SUPPRESSION_FORBIDDEN");
  keys(audit.metadata, ["vulnerabilities", "dependencies", "devDependencies", "optionalDependencies", "totalDependencies"]);
  keys(audit.metadata.vulnerabilities, severities);
  requireValue(severities.every(severity => count(audit.metadata.vulnerabilities[severity])));
  for (const name of ["dependencies", "devDependencies", "optionalDependencies", "totalDependencies"]) requireValue(count(audit.metadata[name]));
  requireValue(audit.metadata.totalDependencies === audit.metadata.dependencies + audit.metadata.devDependencies + audit.metadata.optionalDependencies, "AUDIT_DEPENDENCY_COUNTS_MISMATCH");
  requireValue(audit.metadata.devDependencies === 0 && audit.metadata.totalDependencies > 0, "AUDIT_PRODUCTION_SCOPE_INVALID");
  const counts = Object.fromEntries(severities.map(severity => [severity, 0]));
  const advisories = new Map();
  for (const [key, value] of Object.entries(audit.advisories)) {
    keys(value, ["id", "module_name", "severity", "url", "findings", "vulnerable_versions", "patched_versions"], advisoryFields);
    requireValue(Number.isSafeInteger(value.id) && value.id > 0 && String(value.id) === key && !advisories.has(value.id));
    requireValue(typeof value.module_name === "string" && packagePattern.test(value.module_name) && value.module_name.length <= 214);
    requireValue(severities.includes(value.severity));
    requireValue(typeof value.url === "string" && ghsaPattern.test(value.url));
    if (Object.hasOwn(value, "github_advisory_id")) requireValue(value.github_advisory_id === value.url.match(ghsaPattern)[1]);
    requireValue(safeText(value.vulnerable_versions) && (value.patched_versions === null || safeText(value.patched_versions)));
    requireValue(Array.isArray(value.findings) && value.findings.length > 0);
    const versions = new Set(), paths = new Set();
    for (const finding of value.findings) {
      keys(finding, ["version", "paths"]);
      requireValue(typeof finding.version === "string" && versionPattern.test(finding.version));
      requireValue(Array.isArray(finding.paths) && finding.paths.every(safePath));
      versions.add(finding.version); finding.paths.forEach(path => paths.add(path));
    }
    advisories.set(value.id, {
      id: value.id, module: value.module_name, severity: value.severity,
      officialReferences: [value.url], vulnerableVersions: value.vulnerable_versions,
      patchedVersions: value.patched_versions, versions: [...versions].sort(), paths: [...paths]
    });
    counts[value.severity]++;
  }
  // Before installed-tree enrichment, findings.paths can be empty; actions.resolves has paths.
  const resolvedIds = new Set();
  for (const action of audit.actions) {
    keys(action, ["action", "resolves"], ["module", "target", "depth"]);
    requireValue(["update", "review", "install"].includes(action.action) && Array.isArray(action.resolves) && action.resolves.length > 0);
    requireValue(action.module === undefined || action.module === null || (typeof action.module === "string" && packagePattern.test(action.module)));
    requireValue(action.target === undefined || action.target === null || (typeof action.target === "string" && versionPattern.test(action.target)));
    requireValue(action.depth === undefined || count(action.depth));
    for (const resolution of action.resolves) {
      keys(resolution, ["id", "path", "dev", "optional", "bundled"]);
      requireValue(Number.isSafeInteger(resolution.id) && advisories.has(resolution.id) && safePath(resolution.path));
      requireValue(resolution.dev === false && typeof resolution.optional === "boolean" && typeof resolution.bundled === "boolean", "AUDIT_PRODUCTION_SCOPE_INVALID");
      resolvedIds.add(resolution.id);
      advisories.get(resolution.id).paths.push(resolution.path);
    }
  }
  requireValue(resolvedIds.size === advisories.size, "AUDIT_PATH_COVERAGE_INVALID");
  requireValue(severities.every(severity => counts[severity] === audit.metadata.vulnerabilities[severity]), "AUDIT_COUNTS_MISMATCH");
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  requireValue((total === 0 && exitCode === 0) || (total > 0 && exitCode === 1), "AUDIT_EXIT_COUNTS_MISMATCH");
  return {
    schemaVersion: 1, scope: "production", auditExitCode: exitCode,
    criticalZero: counts.critical === 0,
    milestone: counts.critical > 0 ? "CRITICAL_PRESENT" : "CRITICAL_ZERO_RELEASE_PENDING",
    releaseStatus: "OWNER_CHECK_PENDING", fullSecurityAcceptance: false,
    counts: { ...counts, total },
    advisories: [...advisories.values()].map(value => ({ ...value, paths: [...new Set(value.paths)].sort() })).sort((a, b) => a.id - b.id)
  };
}

function tuple(version) {
  requireValue(typeof version === "string" && stablePattern.test(version), "PLAN_EXACT_STABLE_VERSION_REQUIRED");
  return version.split(".").map(Number);
}
function atLeast(actual, floor) {
  const a = tuple(actual), b = tuple(floor);
  return a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2])));
}

// AF-177's deliberately narrow proposal guard, independent of the ALL-advisory evaluator.
// Does not install, mutate manifests, resolve a lock, or certify registry data as authentic.
export function validateSecurityProposal(plan, { manifests, registryMetadata, nodeVersion, pnpmVersion }) {
  requireValue(record(plan) && plan.schemaVersion === 1 && plan.task === "AF-177" && plan.status === "PROPOSAL_ROOT_ONLY", "PLAN_SCHEMA_INVALID");
  requireValue(Array.isArray(plan.updates) && plan.updates.length === 2 && Array.isArray(plan.overrides) && plan.overrides.length === 0, "PLAN_SCOPE_INVALID");
  const expected = [["apps/web/package.json", "dependencies", "next"], ["package.json", "devDependencies", "eslint-config-next"]];
  for (const [index, [file, section, name]] of expected.entries()) {
    const update = plan.updates[index], pkg = registryMetadata[name];
    requireValue(record(update) && update.file === file && update.section === section && update.package === name, "PLAN_SCOPE_INVALID");
    tuple(update.oldVersion); tuple(update.newVersion);
    requireValue(update.oldVersion === "16.2.6" && update.newVersion === "16.4.1", "PLAN_VERSION_INVALID");
    requireValue(manifests[file]?.[section]?.[name] === update.oldVersion, "PLAN_BASE_VERSION_MISMATCH");
    requireValue(pkg?.name === name && pkg.version === update.newVersion && !pkg.deprecated && pkg.license === "MIT", "PLAN_REGISTRY_MISMATCH");
    requireValue(update.registryUrl === `https://registry.npmjs.org/${name}/${update.newVersion}`, "PLAN_REGISTRY_MISMATCH");
    requireValue(pkg.dist?.tarball === `https://registry.npmjs.org/${name}/-/${name}-${update.newVersion}.tgz` && pkg.dist?.integrity === update.integrity, "PLAN_PROVENANCE_MISMATCH");
  }
  const next = registryMetadata.next, eslint = registryMetadata["eslint-config-next"];
  const root = manifests["package.json"], web = manifests["apps/web/package.json"], api = manifests["apps/api/package.json"];
  requireValue(next.engines?.node === ">=20.9.0" && atLeast(nodeVersion, "24.0.0") && tuple(nodeVersion)[0] === 24, "PLAN_ENGINE_INVALID");
  requireValue(tuple(pnpmVersion)[0] === 10 && root.packageManager === "pnpm@10.0.0", "PLAN_ENGINE_INVALID");
  for (const manifest of [root, web, api]) requireValue(manifest.engines?.node === ">=24.0.0 <25" && manifest.engines?.pnpm === ">=10.0.0 <11", "PLAN_ENGINE_INVALID");
  const reactRange = "^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0";
  requireValue(next.peerDependencies?.react === reactRange && next.peerDependencies?.["react-dom"] === reactRange, "PLAN_PEER_INVALID");
  for (const name of ["react", "react-dom"]) requireValue(tuple(web.dependencies[name])[0] === 19 && atLeast(web.dependencies[name], "19.0.0"), "PLAN_PEER_INVALID");
  requireValue(web.dependencies.react === web.dependencies["react-dom"], "PLAN_PEER_INVALID");
  requireValue(eslint.peerDependencies?.eslint === ">=9.0.0" && eslint.peerDependencies?.typescript === ">=3.3.1" && atLeast(root.devDependencies.eslint, "9.0.0") && atLeast(root.devDependencies.typescript, "3.3.1"), "PLAN_PEER_INVALID");
  requireValue(api.dependencies.htmlparser2 === "10.1.0", "PLAN_PRESERVED_DEPENDENCY_INVALID");
  requireValue(next.dependencies?.["@next/env"] === "16.4.1" && next.dependencies?.postcss === "8.5.23" && next.optionalDependencies?.sharp === "^0.35.5" && eslint.dependencies?.["@next/eslint-plugin-next"] === "16.4.1", "PLAN_CLOSURE_INVALID");
  return { status: "PROPOSAL_COMPATIBILITY_CHECKED", applied: false, productAcceptance: "NOT_RUN", nodeVersion, pnpmVersion };
}

export function validateOriginalDevGate({ root, gitRoot, branch, remote, head, gate, now = Date.now() }) {
  requireValue(root === ORIGINAL_DEV_ROOT && gitRoot === ORIGINAL_DEV_ROOT && branch === "dev" && remote === "git@github.com:weiyang86/aij-foundation.git", "AUDIT_ORIGINAL_DEV_REQUIRED");
  keys(gate, ["schemaVersion", "taskId", "allowProductionAudit", "head", "createdAt"]);
  const created = Date.parse(gate.createdAt);
  requireValue(gate.schemaVersion === 1 && gate.taskId === "AF-177" && gate.allowProductionAudit === true && /^[a-f0-9]{40}$/.test(head) && gate.head === head && Number.isFinite(created) && created <= now + 5000 && created >= now - 30 * 60 * 1000, "AUDIT_EXPLICIT_GATE_REQUIRED");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    requireValue(args.length === 4 && args[0] === "--audit-file" && args[2] === "--audit-exit-code" && /^[01]$/.test(args[3]), "AUDIT_CLI_USAGE_INVALID");
    const result = evaluateProductionAudit({ stdout: readFileSync(args[1], "utf8"), exitCode: Number(args[3]) });
    console.log(JSON.stringify({ ...result, evidence: "STORED_INPUT_ONLY_NOT_LIVE_PROOF" }, null, 2));
    process.exitCode = result.criticalZero ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ status: "AUDIT_REFUSED", code: error.code?.startsWith("AUDIT_") ? error.code : "AUDIT_INPUT_FAILED" }));
    process.exitCode = 2;
  }
}
