// The coordinator alone wires original seed/application owners into this profile.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readLocalState, root, profile, writePrivate, validateOwner, validateValues, refuse, systemEnvironment } from "./config.mjs";
import { buildApplications, hasBuild } from "./build.mjs";

export async function initializeAiLocal({ owner, values, runtime }) {
  validateOwner(owner);
  const actual = readLocalState();
  assert.deepEqual(actual.owner, owner); assert.deepEqual(actual.values, values);
  assert.deepEqual(validateValues(values), runtime);
  writePrivate(join(profile.directory, "initialization-progress.json"), { stage: "BUILD", at: new Date().toISOString() });
  if (!hasBuild(owner)) buildApplications(owner, values);
  const child = spawnSync(process.execPath, [join(root, "scripts/ai-local-development/initialize-application.mjs")], {
    cwd: root, env: { ...systemEnvironment(), ...values }, encoding: "utf8", timeout: 120000,
    maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"]
  });
  if (child.status !== 0) refuse("Original AI local initialization owners failed; state retained, initialized marker unchanged");
  let result;
  try { result = JSON.parse(child.stdout); } catch { refuse("AI local initialization receipt unavailable"); }
  if (result.status !== "INITIALIZED" || result.applicationPools !== 0 || result.members !== 5) refuse("AI local initialization receipt incomplete");
}
