import { assertOwnedRef, type SecretIdentity } from "../secret-center/secret-ref";
import { assertQiniuHost, assertQiniuOrigin, QINIU_REGIONS, type QiniuRegion } from "./qiniu-storage-policy";

export const STORAGE_READ_PROFILES_MAX_BYTES = 16 * 1024;
export const STORAGE_READ_PROFILES_MAX_COUNT = 8;
export type StorageReadProfile = Readonly<{
  id: string; bucket: string; privateBucket: true; region: QiniuRegion;
  uploadOrigin: string; managementOrigin: string; downloadOrigin: string;
  allowedHosts: readonly string[]; accessKeyRef: string; secretKeyRef: string;
}>;
const fields = ["id", "bucket", "privateBucket", "region", "uploadOrigin", "managementOrigin", "downloadOrigin", "allowedHosts", "accessKeyRef", "secretKeyRef"];
const invalid = () => new Error("Invalid storage read profiles configuration");

// JSON.parse validates syntax; this second bounded pass also rejects duplicate
// object keys (including escaped spellings) rather than accepting last-key-wins.
function strictJson(raw: string): unknown {
  const value: unknown = JSON.parse(raw);
  const stack: { object: boolean; key: boolean; keys: Set<string> }[] = [];
  const tokens = raw.match(/"(?:[^"\\]|\\.)*"|[{}[\]:,]|[^\s{}[\]:,]+/g) ?? [];
  for (const token of tokens) {
    const top = stack.at(-1);
    if (token === "{" || token === "[") stack.push({ object: token === "{", key: token === "{", keys: new Set() });
    else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && top?.object) top.key = true;
    else if (token.startsWith('"') && top?.object && top.key) {
      const key: string = JSON.parse(token);
      if (top.keys.has(key)) throw invalid();
      top.keys.add(key); top.key = false;
    }
  }
  return value;
}

/** Deployment input only. No provider calls, DNS, credentials or mutable maps. */
export function parseStorageReadProfiles(raw: unknown, identity: SecretIdentity): readonly StorageReadProfile[] {
  try {
    if (!identity || typeof identity.projectId !== "string" || identity.projectId.length > 64 ||
        (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(identity.projectId) || identity.projectId.trim() !== identity.projectId) ||
        !["development", "test", "production"].includes(identity.environment)) throw invalid();
    if (raw === undefined) return Object.freeze([]);
    if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > STORAGE_READ_PROFILES_MAX_BYTES) throw invalid();
    const entries = strictJson(raw);
    if (!Array.isArray(entries) || entries.length > STORAGE_READ_PROFILES_MAX_COUNT) throw invalid();
    const ids = new Set<string>();
    const profiles = entries.map((entry: unknown): StorageReadProfile => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalid();
      const row = entry as Record<string, unknown>;
      if (Object.keys(row).length !== fields.length || !fields.every(key => Object.hasOwn(row, key))) throw invalid();
      if (typeof row.id !== "string" || row.id.length > 90) throw invalid();
      const id = /^qiniu:([a-z][a-z0-9]*(?:-[a-z0-9]+)*):v([1-9][0-9]{0,15})$/.exec(row.id);
      if (!id || id[0] !== row.id || id[1].length > 64 || !Number.isSafeInteger(Number(id[2])) || ids.has(row.id)) throw invalid();
      ids.add(row.id);
      if (typeof row.bucket !== "string" || row.bucket.trim() !== row.bucket || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(row.bucket) ||
          row.privateBucket !== true || !QINIU_REGIONS.includes(row.region as QiniuRegion) ||
          !Array.isArray(row.allowedHosts) || !row.allowedHosts.length || row.allowedHosts.length > 16) throw invalid();
      const hosts = row.allowedHosts as unknown[];
      hosts.forEach(host => {
        if (typeof host !== "string" || host.trim() !== host) throw invalid();
        assertQiniuHost(host);
      });
      const allowedHosts = hosts as string[];
      const exactHosts = new Set(allowedHosts);
      if (exactHosts.size !== hosts.length) throw invalid();
      const origins = [row.uploadOrigin, row.managementOrigin, row.downloadOrigin];
      const originHosts = origins.map(origin => assertQiniuOrigin(origin as string, exactHosts));
      // Only the fixed official upload/management endpoints and one explicitly
      // declared private download origin may be contacted; no spare allowlist.
      if (row.uploadOrigin !== `https://up-${row.region}.qiniup.com` ||
          row.managementOrigin !== `https://rs-${row.region}.qiniuapi.com` ||
          exactHosts.size !== new Set(originHosts).size) throw invalid();
      if (typeof row.accessKeyRef !== "string" || typeof row.secretKeyRef !== "string" || row.accessKeyRef === row.secretKeyRef || /\s/.test(row.accessKeyRef + row.secretKeyRef)) throw invalid();
      assertOwnedRef(row.accessKeyRef, identity); assertOwnedRef(row.secretKeyRef, identity);
      return Object.freeze({ id: row.id, bucket: row.bucket, privateBucket: true, region: row.region as QiniuRegion,
        uploadOrigin: row.uploadOrigin as string, managementOrigin: row.managementOrigin as string,
        downloadOrigin: row.downloadOrigin as string, allowedHosts: Object.freeze([...allowedHosts]),
        accessKeyRef: row.accessKeyRef, secretKeyRef: row.secretKeyRef });
    });
    return Object.freeze(profiles);
  } catch { throw invalid(); }
}
