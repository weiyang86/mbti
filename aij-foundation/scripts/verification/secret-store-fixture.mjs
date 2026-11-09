// Synthetic test-only provisioning, outside HTTP; no real provider keys or account resets.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { acceptanceRecord, assertLocalPath, repositoryRoot } from "../database/connection.mjs";
export function secretStorePath(id) { return join(repositoryRoot, ".local-data/secrets/aij-foundation/test", id, "store.json"); }
const keyPath = id => join(repositoryRoot, ".local-data/auth/test", acceptanceRecord("test", id).database, "secret-store-key.json");
export function encryptSecretFixture(values, key) {
  const namespace = "aij-foundation:test", iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv); cipher.setAAD(Buffer.from(namespace));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(values), "utf8"), cipher.final()]);
  return { version: 1, namespace, algorithm: "aes-256-gcm", iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("hex") };
}
export function secretStoreEnvironment(id) {
  const lease = acceptanceRecord("test", id); assert.equal(lease.task, "AF-023"); const saved = JSON.parse(readFileSync(keyPath(id)));
  assert.equal(saved.task, "AF-023"); assert.equal(saved.database, lease.database); assert.match(saved.key, /^[a-f0-9]{64}$/);
  return { AIJ_SECRET_STORE_FILE: secretStorePath(id), AIJ_SECRET_STORE_KEY: saved.key };
}
export function prepareSecretStore(id) {
  const lease = acceptanceRecord("test", id); assert.equal(lease.task, "AF-023"); const file = secretStorePath(id); assertLocalPath(file);
  execFileSync("git", ["--no-optional-locks", "check-ignore", "--quiet", file], { cwd: repositoryRoot, stdio: "ignore" });
  const keyFile = keyPath(id); assertLocalPath(keyFile);
  if (!existsSync(file) && !existsSync(keyFile)) {
    const key = randomBytes(32).toString("hex"); mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
    writeFileSync(keyFile, JSON.stringify({ task: "AF-023", database: lease.database, key }) + "\n", { flag: "wx", mode: 0o600 });
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(encryptSecretFixture({ DEMO_OLD: randomBytes(32).toString("hex"), DEMO_NEW: randomBytes(32).toString("hex") }, key)) + "\n", { flag: "wx", mode: 0o600 });
  }
  secretStoreEnvironment(id); const saved = JSON.parse(readFileSync(file)); assert.equal(saved.version, 1); assert.equal(saved.algorithm, "aes-256-gcm"); assert.equal(saved.namespace, "aij-foundation:test");
  return { file, keyFile, references: ["local://aij-foundation/test/DEMO_OLD", "local://aij-foundation/test/DEMO_NEW"] };
}
