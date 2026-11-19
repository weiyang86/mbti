import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { evaluateProductionAudit, ORIGINAL_DEV_ROOT } from "./production-dependency-security.mjs";

const check = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const sha256 = value => createHash("sha256").update(value).digest("hex");
const files = ["package.json", "apps/api/package.json", "apps/web/package.json"];
const updates = [
  { file: "apps/api/package.json", section: "dependencies", package: "@prisma/client", oldVersion: "6.19.0", newVersion: "6.19.3" },
  { file: "apps/api/package.json", section: "devDependencies", package: "prisma", oldVersion: "6.19.0", newVersion: "6.19.3" }
];
const overrides = [
  { selector: "@prisma/config@6.19.3>deepmerge-ts", package: "deepmerge-ts", oldVersion: "7.1.5", newVersion: "8.0.0", reason: "CONDITIONAL_MAJOR_EXCEPTION_msg_76d615d44101" },
  { selector: "@nestjs/platform-express@11.1.19>multer", package: "multer", oldVersion: "2.1.1", newVersion: "2.5.0", reason: "UPSTREAM_EXACT_PIN_BLOCKS_SAME_MAJOR_FIX" }
];
const lockTargets = [
  { package: "body-parser", oldVersion: "2.3.0", newVersion: "2.4.0", parent: "express@5.2.1", range: "^2.2.1" },
  { package: "qs", oldVersion: "6.16.0", newVersion: "6.16.1", parent: "express@5.2.1", range: "^6.14.0" }
];
const registryTargets = {
  "@prisma/client": ["6.19.3", "Apache-2.0"], prisma: ["6.19.3", "Apache-2.0"], "@prisma/config": ["6.19.3", "Apache-2.0"],
  effect: ["3.21.0", "MIT"], "deepmerge-ts": ["8.0.0", "BSD-3-Clause"], "@nestjs/platform-express": ["11.1.19", "MIT"],
  multer: ["2.5.0", "MIT"], express: ["5.2.1", "MIT"], "body-parser": ["2.4.0", "MIT"], qs: ["6.16.1", "BSD-3-Clause"]
};
const beforeHashes = {
  "package.json": "832c05330b2db494d475506c7cba061579ff7684d6b8d2e13796032417a0a542",
  "apps/api/package.json": "5e85effa347be48770becfb1329637e523b06f022236de220232f4571a1a0791",
  "apps/web/package.json": "263465196218e0035b74697983474b9344eaece2325109a36b9fb4f3e1db646c",
  "pnpm-lock.yaml": "51177cd10250a39b04bc7c35f2d876512dd6da09be0955f7ac67c943ec10f0b2"
};

// Supplied registry inputs must be read from the exact official HTTPS endpoints.
// Matching a stored input is reproducibility evidence, not a registry-authenticity proof.
export function validateRemediationProposal(plan, { manifests, registryMetadata, nodeVersion, pnpmVersion }) {
  check(plan?.schemaVersion === 1 && plan.task === "AF-181" && plan.status === "CONDITIONAL_PROPOSAL_ROOT_ONLY" && plan.amendment === "msg_76d615d44101", "REMEDIATION_PLAN_INVALID");
  check(plan.applied === false && plan.codeVerified === false && plan.releaseStatus === "OWNER_CHECK_PENDING", "REMEDIATION_ACCEPTANCE_INVALID");
  check(isDeepStrictEqual(plan.updates, updates) && isDeepStrictEqual(plan.overrides, overrides) && isDeepStrictEqual(plan.lockTargets, lockTargets), "REMEDIATION_SCOPE_INVALID");
  check(isDeepStrictEqual(plan.before?.hashes, beforeHashes) && isDeepStrictEqual(plan.before?.manifests, manifests) && Object.keys(manifests).length === files.length, "REMEDIATION_BASE_MISMATCH");
  check(sha256(JSON.stringify(manifests)) === "9fcc9575322c50948f4223f381146e9ae828915f46c665fc013531a23217201b", "REMEDIATION_BASE_MISMATCH");
  for (const update of updates) check(manifests[update.file]?.[update.section]?.[update.package] === update.oldVersion, "REMEDIATION_BASE_MISMATCH");
  const root = manifests["package.json"], api = manifests["apps/api/package.json"], web = manifests["apps/web/package.json"];
  check(stable.test(nodeVersion) && nodeVersion.split(".")[0] === "24" && pnpmVersion === "10.0.0" && root.packageManager === "pnpm@10.0.0", "REMEDIATION_ENGINE_INVALID");
  for (const manifest of [root, api, web]) check(manifest.engines?.node === ">=24.0.0 <25" && manifest.engines?.pnpm === ">=10.0.0 <11", "REMEDIATION_ENGINE_INVALID");
  check(web.dependencies.next === "16.4.1" && web.dependencies.react === "19.2.6" && web.dependencies["react-dom"] === "19.2.6" && root.devDependencies["eslint-config-next"] === "16.4.1" && api.dependencies.htmlparser2 === "10.1.0", "REMEDIATION_PRESERVED_DEPENDENCY_INVALID");
  for (const name of ["@nestjs/common", "@nestjs/core", "@nestjs/platform-express"]) check(api.dependencies[name] === "11.1.19", "REMEDIATION_PEER_INVALID");
  check(root.pnpm === undefined, "REMEDIATION_EXISTING_POLICY_INVALID");
  check(isDeepStrictEqual(Object.keys(plan.registryEvidence ?? {}).sort(), Object.keys(registryTargets).sort()), "REMEDIATION_REGISTRY_INVALID");
  for (const [name, [version, license]] of Object.entries(registryTargets)) {
    const pkg = registryMetadata?.[name], pinned = plan.registryEvidence[name];
    check(pkg?.name === name && pkg.version === version && stable.test(pkg.version) && !pkg.deprecated && pkg.license === license, "REMEDIATION_REGISTRY_INVALID");
    const leaf = name.split("/").at(-1), url = `https://registry.npmjs.org/${name}/${version}`;
    check(pinned.registryUrl === url && pkg.dist?.tarball === `https://registry.npmjs.org/${name}/-/${leaf}-${version}.tgz` && /^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.dist?.integrity ?? ""), "REMEDIATION_PROVENANCE_INVALID");
    for (const key of ["name", "version", "license", "engines", "dependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta", "deprecated"]) check(isDeepStrictEqual(pkg[key], pinned[key]), "REMEDIATION_REGISTRY_INVALID");
    check(pkg.dist.integrity === pinned.dist.integrity && pkg.dist.tarball === pinned.dist.tarball, "REMEDIATION_PROVENANCE_INVALID");
  }
  const config = registryMetadata["@prisma/config"], prisma = registryMetadata.prisma, platform = registryMetadata["@nestjs/platform-express"];
  check(prisma.dependencies?.["@prisma/config"] === "6.19.3" && prisma.dependencies?.["@prisma/engines"] === "6.19.3" && config.dependencies?.effect === "3.21.0" && config.dependencies?.["deepmerge-ts"] === "7.1.5", "REMEDIATION_CLOSURE_INVALID");
  check(prisma.engines?.node === ">=18.18" && prisma.peerDependencies?.typescript === ">=5.1.0" && registryMetadata["@prisma/client"].peerDependencies?.prisma === "*", "REMEDIATION_PEER_INVALID");
  check(platform.dependencies?.multer === "2.1.1" && platform.dependencies?.express === "5.2.1" && platform.peerDependencies?.["@nestjs/common"] === "^11.0.0" && platform.peerDependencies?.["@nestjs/core"] === "^11.0.0", "REMEDIATION_PEER_INVALID");
  check(registryMetadata["deepmerge-ts"].engines?.node === ">=16.0.0" && registryMetadata.multer.engines?.node === ">= 10.16.0" && registryMetadata["body-parser"].engines?.node === ">=18" && registryMetadata.qs.engines?.node === ">=0.6", "REMEDIATION_ENGINE_INVALID");
  check(registryMetadata.express.dependencies?.["body-parser"] === "^2.2.1" && registryMetadata.express.dependencies?.qs === "^6.14.0" && registryMetadata["body-parser"].dependencies?.qs === "^6.16.1", "REMEDIATION_CLOSURE_INVALID");
  check(plan.compatibility?.status === "ISOLATED_COMPATIBILITY_CONDITIONAL" && plan.compatibility.types === "PASS_TS5.9.3_STRICT_NODE_NEXT_SKIP_LIB_CHECK_FALSE" && plan.compatibility.rootValidation === "NOT_RUN", "REMEDIATION_COMPATIBILITY_REQUIRED");
  return { status: "CONDITIONAL_PROPOSAL_VALIDATED", applied: false, codeVerified: false, rootCompatibility: "NOT_RUN", releaseStatus: "OWNER_CHECK_PENDING" };
}

export function validateRemediationBeforeFiles(plan, contents) {
  for (const [file, expected] of Object.entries(beforeHashes)) check(typeof contents[file] === "string" && sha256(contents[file]) === expected && plan.before?.hashes?.[file] === expected, "REMEDIATION_BASE_HASH_MISMATCH");
}

// This is a bounded inventory reader for pnpm lockfile v9's `packages` section,
// not a general YAML parser or a claim that the complete transitive graph is unchanged.
// The real pnpm audit separately parses the actual lock and evaluates every advisory.
export function validateRemediationTargets(plan, { manifests, lockfile, registryMetadata, nodeVersion, pnpmVersion }) {
  validateRemediationProposal(plan, { manifests: plan.before?.manifests, registryMetadata, nodeVersion, pnpmVersion });
  const expected = structuredClone(plan.before.manifests);
  for (const u of updates) expected[u.file][u.section][u.package] = u.newVersion;
  expected["package.json"].pnpm = { overrides: Object.fromEntries(overrides.map(o => [o.selector, o.newVersion])) };
  check(isDeepStrictEqual(manifests, expected), "REMEDIATION_POST_MANIFEST_MISMATCH");
  check(typeof lockfile === "string" && Buffer.byteLength(lockfile) <= 8 * 1024 * 1024 && /^lockfileVersion: '9\.0'\n/.test(lockfile) && !/[\t\0\r]/.test(lockfile), "REMEDIATION_LOCK_INVALID");
  const overrideBlock = lockfile.match(/^overrides:\n((?: {2}.+\n)+)/m)?.[1];
  check(overrideBlock !== undefined, "REMEDIATION_LOCK_OVERRIDE_MISMATCH");
  const lockedOverrides = {};
  for (const line of overrideBlock.trimEnd().split("\n")) {
    const match = line.match(/^ {2}'([^']+)': (\d+\.\d+\.\d+)$/);
    check(match && !Object.hasOwn(lockedOverrides, match[1]), "REMEDIATION_LOCK_OVERRIDE_MISMATCH");
    lockedOverrides[match[1]] = match[2];
  }
  check(isDeepStrictEqual(lockedOverrides, expected["package.json"].pnpm.overrides), "REMEDIATION_LOCK_OVERRIDE_MISMATCH");
  const parts = lockfile.split(/^packages:\n/m);
  check(parts.length === 2 && parts[1].split(/^snapshots:\n/m).length === 2, "REMEDIATION_LOCK_INVALID");
  const entries = parts[1].split(/^snapshots:\n/m)[0].split(/(?=^ {2}\S)/m).filter(s => s.trim());
  const seen = new Map();
  for (const entry of entries) {
    const match = entry.match(/^ {2}'?((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)@([^'\n]+)'?:\n/);
    check(match && !seen.has(`${match[1]}@${match[2]}`), "REMEDIATION_LOCK_INVALID");
    seen.set(`${match[1]}@${match[2]}`, entry);
  }
  for (const [name, [version]] of Object.entries(registryTargets)) {
    const matching = [...seen].filter(([key]) => key.startsWith(`${name}@`));
    check(matching.length === 1 && matching[0][0] === `${name}@${version}`, "REMEDIATION_LOCK_TARGET_MISMATCH");
    const integrity = matching[0][1].match(/^ {4}resolution: \{integrity: (sha512-[A-Za-z0-9+/]+=*)\}\n/m)?.[1];
    check(integrity === registryMetadata[name].dist.integrity, "REMEDIATION_LOCK_INTEGRITY_MISMATCH");
  }
  return { status: "DECLARED_AND_LOCKED_TARGETS_MATCH", completeTransitiveDiffReview: "ROOT_REQUIRED", appliedProof: false };
}

// One audit parser owns all pnpm schema/count/path/suppression truth, including
// unknown modules and optional-package findings. Never select a list of known IDs.
export function evaluateProductionHighAudit(processResult) {
  const evaluation = evaluateProductionAudit(processResult);
  check(evaluation.advisories.every(advisory => advisory.paths.every(path => !path.split(/[/>]/).some(part => part.trim() === ".."))), "AUDIT_UNSAFE_PATH");
  const highZero = evaluation.counts.critical === 0 && evaluation.counts.high === 0;
  return { ...evaluation, highZero, milestone: highZero ? "CRITICAL_HIGH_ZERO_RELEASE_PENDING" : "PRODUCTION_HIGH_OR_CRITICAL_PRESENT", fullSecurityAcceptance: false, releaseStatus: "OWNER_CHECK_PENDING" };
}

// Gate values are ASCII fixed identifiers/timestamps: escapes and duplicate keys
// add no valid use case and are refused before JSON.parse can overwrite a key.
export function parseAF181Gate(source) {
  check(typeof source === "string" && source.length > 0 && source.length <= 4096 && !source.includes(String.fromCharCode(92)), "AUDIT_EXPLICIT_GATE_REQUIRED");
  for (const key of ["schemaVersion", "taskId", "allowProductionAudit", "head", "createdAt"]) check(source.match(new RegExp(`"${key}"\\s*:`, "g"))?.length === 1, "AUDIT_EXPLICIT_GATE_REQUIRED");
  try { return JSON.parse(source); } catch { throw Object.assign(new Error("AUDIT_EXPLICIT_GATE_REQUIRED"), { code: "AUDIT_EXPLICIT_GATE_REQUIRED" }); }
}

export function validateAF181OriginalDevGate({ root, gitRoot, branch, remote, head, gate, now = Date.now() }) {
  check(root === ORIGINAL_DEV_ROOT && gitRoot === ORIGINAL_DEV_ROOT && branch === "dev" && remote === "git@github.com:weiyang86/aij-foundation.git", "AUDIT_ORIGINAL_DEV_REQUIRED");
  const fields = ["schemaVersion", "taskId", "allowProductionAudit", "head", "createdAt"];
  check(gate && Object.keys(gate).length === fields.length && fields.every(key => Object.hasOwn(gate, key)), "AUDIT_EXPLICIT_GATE_REQUIRED");
  const created = Date.parse(gate.createdAt);
  check(gate.schemaVersion === 1 && gate.taskId === "AF-181" && gate.allowProductionAudit === true && /^[a-f0-9]{40}$/.test(head) && gate.head === head && Number.isFinite(created) && created <= now + 5000 && created >= now - 30 * 60 * 1000, "AUDIT_EXPLICIT_GATE_REQUIRED");
}
