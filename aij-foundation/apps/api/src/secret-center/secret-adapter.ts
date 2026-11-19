// Env adapter adapted from F00 M06; protected local read adapter is new, not a vault service.
import { ServiceUnavailableException } from "@nestjs/common";
import { createDecipheriv } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { ParsedSecretRef, SecretIdentity } from "./secret-ref";
import { readRepositoryEnvironment } from "../../../../scripts/runtime-environment.cjs";
export interface SecretAdapter { resolve(parsed: ParsedSecretRef): Promise<string>; exists(parsed: ParsedSecretRef): Promise<boolean>; }
const unavailable = () => new ServiceUnavailableException("Configured secret unavailable");
function usable(value: unknown): value is string { return typeof value === "string" && value.length >= 16 && value.length <= 8192 && !/\s/.test(value) && !/change.?me|replace.?me|your[_-]|example|placeholder|template/i.test(value); }
export class EnvSecretAdapter implements SecretAdapter {
  async resolve(parsed: ParsedSecretRef) { try { const value = readRepositoryEnvironment()[parsed.name]; if (!usable(value)) throw unavailable(); return value; } catch { throw unavailable(); } }
  async exists(parsed: ParsedSecretRef) { try { await this.resolve(parsed); return true; } catch { return false; } }
}
export class LocalSecretStoreAdapter implements SecretAdapter {
  constructor(private readonly identity: SecretIdentity) {}
  async resolve(parsed: ParsedSecretRef) {
    let fd: number | undefined;
    try {
      const base = join(this.identity.repositoryRoot, ".local-data/secrets", this.identity.projectId, this.identity.environment);
      const environment = readRepositoryEnvironment();
      const path = environment.AIJ_SECRET_STORE_FILE ?? join(base, "store.json"), full = resolve(path), rel = relative(base, full);
      if (!rel || rel.startsWith("..") || rel.startsWith(sep) || full !== path) throw unavailable();
      // No symlink at any component; all private ancestors under .local-data are owned and mode 0700.
      let cursor = this.identity.repositoryRoot;
      const parts = relative(cursor, full).split(sep);
      for (const [index, component] of parts.entries()) {
        cursor = join(cursor, component); const st = lstatSync(cursor);
        if (st.isSymbolicLink() || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0 || (index === parts.length - 1 ? !st.isFile() || st.nlink !== 1 : !st.isDirectory())) throw unavailable();
      }
      fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW); const st = fstatSync(fd);
      if (!st.isFile() || st.uid !== process.getuid?.() || st.nlink !== 1 || (st.mode & 0o077) !== 0 || st.size > 65536) throw unavailable();
      const record = JSON.parse(readFileSync(fd, "utf8")), key = environment.AIJ_SECRET_STORE_KEY;
      if (!key || !/^[a-f0-9]{64}$/.test(key) || record?.version !== 1 || record.namespace !== this.identity.namespace || record.algorithm !== "aes-256-gcm" || !/^[a-f0-9]{24}$/.test(record.iv) || !/^[a-f0-9]{32}$/.test(record.tag) || typeof record.ciphertext !== "string" || !/^(?:[a-f0-9]{2})+$/.test(record.ciphertext)) throw unavailable();
      // Namespace is authenticated too. The real decryption key is provisioned separately by the owner.
      const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), Buffer.from(record.iv, "hex"));
      decipher.setAAD(Buffer.from(this.identity.namespace)); decipher.setAuthTag(Buffer.from(record.tag, "hex"));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, "hex")), decipher.final()]);
      let values: unknown;
      try { values = JSON.parse(plaintext.toString("utf8")); } finally { plaintext.fill(0); }
      const value: unknown = values && typeof values === "object" && Object.hasOwn(values, parsed.name) ? (values as Record<string, unknown>)[parsed.name] : undefined;
      if (!usable(value)) throw unavailable(); return value;
    } catch { throw unavailable(); }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  async exists(parsed: ParsedSecretRef) { try { await this.resolve(parsed); return true; } catch { return false; } }
}
