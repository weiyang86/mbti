import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const runId = randomBytes(5).toString("hex");
const orchestrationRoot = join(repositoryRoot, ".artifacts", "af-076", "orchestration-run-" + runId);
const packedRunRoot = join(repositoryRoot, ".artifacts", "af-076", "e2e-run-" + runId);
const packedReportPath = join(packedRunRoot, "report.json");
const reportPath = join(orchestrationRoot, "report.json");
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|TMPDIR|TMP|TEMP|SystemRoot|WINDIR|LANG|LC_ALL|TZ|PNPM_HOME)$/i.test(key)));
safeEnv.PATH = [dirname(process.execPath), safeEnv.PATH].filter(Boolean).join(delimiter);
safeEnv.CI = "1";
safeEnv.NEXT_TELEMETRY_DISABLED = "1";

function tcpListeners(port) {
  const result = spawnSync("lsof", ["-nP", "-t", "-iTCP:" + port, "-sTCP:LISTEN"], { cwd: repositoryRoot, env: safeEnv, encoding: "utf8", shell: false, timeout: 10000 });
  if (result.status === 1 && !result.stdout.trim()) return [];
  assert.equal(result.status, 0, "lsof must resolve the AF-076 listener identity on port " + port);
  return result.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
}

test("AF-076 one packed consumer installs, upgrades, restores, starts, and becomes ready end to end", { timeout: 890000 }, async () => {
  mkdirSync(orchestrationRoot, { recursive: false, mode: 0o700 });
  const child = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "scripts/verification/packed-consumer-upgrade.test.mjs"], {
    cwd: repositoryRoot,
    env: { ...safeEnv, AIJ_AF076_E2E: "1", AIJ_AF076_RUN_ID: runId },
    encoding: "utf8",
    shell: false,
    timeout: 850000,
    maxBuffer: 24 * 1024 * 1024
  });
  const childExitCode = child.status ?? (child.error?.code === "ETIMEDOUT" ? 124 : 127);
  const tapSummary = String(child.stdout || "").split("\n").filter((line) => /^(?:# (?:tests|pass|fail|cancelled|skipped|todo|duration_ms)|1\.\.|ok \d+|not ok \d+)/.test(line)).slice(-24);
  const packedReport = existsSync(packedReportPath) ? JSON.parse(readFileSync(packedReportPath, "utf8")) : null;
  const events = packedReport?.events || [];
  const eventNames = events.map((event) => event.name);
  const expectedEvents = ["packed-consumer", "prior-schema-fixture", "backup-restored", "upgrade-and-incompatibility-guard", "end-to-end-host-readiness"];
  const missingEvents = expectedEvents.filter((name) => !eventNames.includes(name));
  const volumes = packedReport ? [packedReport.targets?.prior?.volume, packedReport.targets?.restore?.volume] : [];
  const volumeChecks = volumes.map((name) => {
    if (!name) return { name: null, exitCode: null };
    const result = spawnSync("docker", ["volume", "inspect", name, "--format", "{{.Name}}"], { cwd: repositoryRoot, env: safeEnv, encoding: "utf8", shell: false, timeout: 10000 });
    return { name, exitCode: result.status, present: result.status === 0 && result.stdout.trim() === name };
  });
  const ports = { api: 37266, web: 37265, priorDatabase: 55444, restoredDatabase: 55445 };
  const releasedPorts = Object.fromEntries(Object.entries(ports).map(([name, port]) => [name, tcpListeners(port).length === 0]));
  const report = {
    task: "AF-076",
    runId,
    childCommand: [process.execPath, "--test", "--test-reporter=tap", "scripts/verification/packed-consumer-upgrade.test.mjs"],
    childExitCode,
    childErrorCode: child.error?.code || null,
    childTapSummary: tapSummary,
    packedReportPath: packedReport ? ".artifacts/af-076/e2e-run-" + runId + "/report.json" : null,
    packedReportPresent: Boolean(packedReport),
    packedTask: packedReport?.task || null,
    sourceRoot: packedReport?.sourceRoot || null,
    sourceRootIsExternal: packedReport ? !String(packedReport.sourceRoot).startsWith(repositoryRoot + "/") : false,
    tarballSha256: packedReport?.tarballSha256 || null,
    eventNames,
    missingEvents,
    childCleanupErrors: packedReport?.cleanupErrors || null,
    targetStates: { prior: packedReport?.targets?.prior?.stateAfterTest || null, restore: packedReport?.targets?.restore?.stateAfterTest || null },
    retainedVolumeChecks: volumeChecks,
    releasedPorts,
    recordedAt: new Date().toISOString()
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });

  assert.equal(childExitCode, 0, "integrated packed-consumer child test must exit successfully; see sanitized AF-076 report " + reportPath);
  assert.equal(packedReport?.task, "AF-076");
  assert.ok(report.sourceRootIsExternal, "the installed tarball must materialize outside the checkout");
  assert.ok(report.tarballSha256);
  assert.deepEqual(missingEvents, [], "installation, prior-schema fixture, backup/restore, migration refusal and post-recovery host readiness must all occur in the same consumer run");
  assert.deepEqual(packedReport.cleanupErrors, []);
  assert.equal(packedReport.targets.prior.stateAfterTest, "exited");
  assert.equal(packedReport.targets.restore.stateAfterTest, "exited");
  assert.ok(volumeChecks.length === 2 && volumeChecks.every((result) => result.present), "AF-076 volumes must remain present after owned containers stop");
  assert.ok(Object.values(releasedPorts).every(Boolean), "all AF-076-owned ports must be released");
  const hostEvent = events.find((event) => event.name === "end-to-end-host-readiness");
  assert.deepEqual({ health: hostEvent?.apiHealth, ready: hostEvent?.apiReadyBeforeOutage, outageLive: hostEvent?.apiHealthDuringDatabaseOutage, outageReady: hostEvent?.apiReadyDuringDatabaseOutage, recovered: hostEvent?.apiReadyAfterSameVolumeRecovery, web: hostEvent?.webStatus }, { health: 200, ready: 200, outageLive: 200, outageReady: 503, recovered: 200, web: 200 });
});
