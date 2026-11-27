// Controlled write path for local encrypted secrets. Values never leave this module
// or reach HTTP responses; only the owning reference metadata is returned.
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { readRepositoryEnvironment } from "../../../../scripts/runtime-environment.cjs";
import { isUsableSecretValue } from "./secret-adapter";
import { SecretIdentity } from "./secret-ref";

const MAX_STORE_BYTES = 65536;
const NAME = /^[A-Z][A-Z0-9_]{2,63}$/;
const unavailable = () => new ServiceUnavailableException("Secret store unavailable");

// Serialize writes inside this process; the encrypted store is a single document.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(run: () => Promise<T>): Promise<T> => {
  const next = queue.then(run, run);
  queue = next.then(() => undefined, () => undefined);
  return next;
};

export class LocalSecretStoreWriter {
  constructor(private readonly identity: SecretIdentity) {}

  private environment() { return readRepositoryEnvironment(); }

  private location() {
    const base = join(this.identity.repositoryRoot, ".local-data/secrets", this.identity.projectId, this.identity.environment);
    const file = this.environment().AIJ_SECRET_STORE_FILE ?? join(base, "store.json");
    const full = resolve(file), rel = relative(base, full);
    if (!rel || rel.startsWith("..") || rel.startsWith(sep) || full !== file) throw unavailable();
    return { base, full };
  }

  private key() {
    const key = this.environment().AIJ_SECRET_STORE_KEY;
    if (!key || !/^[a-f0-9]{64}$/.test(key)) throw new ServiceUnavailableException("Secret store key is unavailable");
    return key;
  }

  private read(full: string): Record<string, string> {
    if (!existsSync(full)) return {};
    const info = lstatSync(full);
    if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_STORE_BYTES) throw unavailable();
    const record = JSON.parse(readFileSync(full, "utf8"));
    const key = this.key();
    if (!record || typeof record !== "object" || record.version !== 1 || record.namespace !== this.identity.namespace ||
      record.algorithm !== "aes-256-gcm" || !/^[a-f0-9]{24}$/.test(record.iv) || !/^[a-f0-9]{32}$/.test(record.tag) ||
      typeof record.ciphertext !== "string" || !/^(?:[a-f0-9]{2})+$/.test(record.ciphertext)) throw unavailable();
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), Buffer.from(record.iv, "hex"));
    decipher.setAAD(Buffer.from(this.identity.namespace));
    decipher.setAuthTag(Buffer.from(record.tag, "hex"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "hex")), decipher.final()]);
    let values: unknown;
    try { values = JSON.parse(plaintext.toString("utf8")); } finally { plaintext.fill(0); }
    if (!values || typeof values !== "object" || Array.isArray(values)) throw unavailable();
    const result: Record<string, string> = {};
    for (const [name, value] of Object.entries(values)) if (NAME.test(name) && isUsableSecretValue(value)) result[name] = value;
    return result;
  }

  private encode(values: Record<string, string>) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from(this.key(), "hex"), iv);
    cipher.setAAD(Buffer.from(this.identity.namespace));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(values), "utf8"), cipher.final()]);
    const text = JSON.stringify({ version: 1, namespace: this.identity.namespace, algorithm: "aes-256-gcm",
      iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ciphertext: ciphertext.toString("hex") }) + "\n";
    if (Buffer.byteLength(text) > MAX_STORE_BYTES) throw new BadRequestException("Secret store is full");
    return text;
  }

  write(name: string, value: string) {
    if (!NAME.test(name)) throw new BadRequestException("Invalid secret name");
    if (!isUsableSecretValue(value)) throw new BadRequestException("Invalid secret value");
    return serial(async () => {
      const { full } = this.location();
      mkdirSync(dirname(full), { recursive: true, mode: 0o700 });
      const values = this.read(full);
      values[name] = value;
      const text = this.encode(values);
      const temp = `${full}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      writeFileSync(temp, text, { mode: 0o600, flag: "wx" });
      try { renameSync(temp, full); }
      catch (error) { try { unlinkSync(temp); } catch { /* temp already gone */ } throw error; }
      return true;
    });
  }
}
