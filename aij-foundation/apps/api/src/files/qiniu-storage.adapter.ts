import { LocalStorageError } from "@aij/runtime-contracts";
import type { StorageAdapter, LocalStorageErrorCode } from "@aij/runtime-contracts";
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  assertQiniuHost, assertQiniuOrigin, QINIU_JSON_BYTES, QINIU_MAX_OBJECT_BYTES,
  QINIU_REGIONS, QiniuHttpsTransport, QiniuStorageError
} from "./qiniu-storage-policy";
import type {
  QiniuHttpRequest, QiniuHttpResponse, QiniuOperation, QiniuOutcome, QiniuRegion, QiniuTransport
} from "./qiniu-storage-policy";

export { QiniuStorageError } from "./qiniu-storage-policy";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[Fl][A-Za-z0-9_-]{27}$/;
const FORM_TYPE = "application/x-www-form-urlencoded";

export interface QiniuCredentials { readonly accessKey: string; readonly secretKey: string }
/** A trusted host resolves secret references after its own authorization checks.
 * Never resolve from object metadata or client input. This adapter does not cache
 * credentials and does not expose upload or bucket-wide management tokens.
 */
export type QiniuCredentialResolver = (scope: Readonly<{
  productId: string; environment: string; bucket: string; operation: QiniuOperation;
}>) => Promise<QiniuCredentials>;
export interface QiniuStorageOptions {
  readonly productId: string;
  readonly environment: "development" | "test" | "production";
  readonly bucket: string;
  readonly privateBucket: true;
  readonly region: QiniuRegion;
  readonly uploadOrigin: string;
  readonly managementOrigin: string;
  readonly downloadOrigin: string;
  readonly allowedHosts: readonly string[];
  readonly maxObjectBytes?: number;
  readonly timeoutMs?: number;
  readonly signedUrlTtlSeconds?: number;
}

function base64url(bytes: Uint8Array | string): string {
  // Qiniu uses URL-safe Base64 WITH padding (Node's base64url omits it).
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}
function signature(data: string, credentials: QiniuCredentials): string {
  return credentials.accessKey + ":" + base64url(createHmac("sha1", credentials.secretKey).update(data).digest());
}

/** Qiniu etag: 4 MiB SHA1 blocks; prefix 0x16 for <= 1 block,
 * 0x96 + SHA1(concatenated block digests) for larger input, including exact edges.
 */
export function qiniuHash(bytes: Uint8Array): string {
  const blockSize = 4 * 1024 * 1024;
  const data = Buffer.from(bytes);
  const sha1 = (value: Uint8Array) => createHash("sha1").update(value).digest();
  if (data.byteLength <= blockSize) return base64url(Buffer.concat([Buffer.from([0x16]), sha1(data)]));
  const blocks: Buffer[] = [];
  for (let offset = 0; offset < data.byteLength; offset += blockSize) blocks.push(sha1(data.subarray(offset, offset + blockSize)));
  return base64url(Buffer.concat([Buffer.from([0x96]), sha1(Buffer.concat(blocks))]));
}

function isHash(value: unknown): value is string {
  // 21 bytes have no padding; re-encode to reject noncanonical Base64.
  if (typeof value !== "string" || !HASH.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 21 && [0x16, 0x96].includes(bytes[0]) && base64url(bytes) === value;
}
function jsonObject(response: QiniuHttpResponse): Record<string, unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers["content-type"] ?? "") || response.body.byteLength > QINIU_JSON_BYTES) throw new Error();
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}

/** Callable private protocol adapter, deliberately not wired into FilesModule.
 * All writes/deletes are ONE attempt. Unknown outcomes require caller-led stat /
 * byte verification and reconciliation; never infer cleanup permission here.
 */
export class QiniuStorageAdapter implements StorageAdapter {
  readonly #config: QiniuStorageOptions;
  readonly #resolveCredentials: QiniuCredentialResolver;
  readonly #transport: QiniuTransport;
  readonly #now: () => number;
  readonly #maxBytes: number;
  readonly #ttl: number;

  constructor(options: QiniuStorageOptions, resolver: QiniuCredentialResolver,
    testing?: { transport?: QiniuTransport; now?: () => number }) {
    if (!options || typeof options !== "object") throw new LocalStorageError("STORAGE_ROOT_INVALID");
    const maxBytes = options.maxObjectBytes ?? QINIU_MAX_OBJECT_BYTES;
    const ttl = options.signedUrlTtlSeconds ?? 60;
    if (typeof options.productId !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(options.productId) || options.productId.length > 64 ||
        !["development", "test", "production"].includes(options.environment) ||
        typeof options.bucket !== "string" || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(options.bucket) || options.privateBucket !== true ||
        !QINIU_REGIONS.includes(options.region) || typeof resolver !== "function" ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > QINIU_MAX_OBJECT_BYTES ||
        !Number.isInteger(ttl) || ttl < 1 || ttl > 300 ||
        !Array.isArray(options.allowedHosts) || !options.allowedHosts.length || options.allowedHosts.length > 16) {
      throw new LocalStorageError("STORAGE_ROOT_INVALID");
    }
    options.allowedHosts.forEach(assertQiniuHost);
    const hosts = new Set(options.allowedHosts);
    assertQiniuOrigin(options.uploadOrigin, hosts);
    assertQiniuOrigin(options.managementOrigin, hosts);
    assertQiniuOrigin(options.downloadOrigin, hosts);
    // No discovery, redirects, alternate regions or arbitrary upload/RS hosts.
    if (options.uploadOrigin !== `https://up-${options.region}.qiniup.com` ||
        options.managementOrigin !== `https://rs-${options.region}.qiniuapi.com`) {
      throw new LocalStorageError("STORAGE_ROOT_INVALID");
    }
    this.#config = Object.freeze({ ...options, allowedHosts: Object.freeze([...options.allowedHosts]) });
    this.#resolveCredentials = resolver;
    this.#maxBytes = maxBytes;
    this.#ttl = ttl;
    this.#now = testing?.now ?? Date.now;
    // Validate timeout even when a test transport is injected.
    const production = new QiniuHttpsTransport(options.allowedHosts, options.timeoutMs);
    this.#transport = testing?.transport ?? production;
  }

  relativePath(objectKey: string): string {
    if (typeof objectKey !== "string" || !UUID.test(objectKey)) throw new LocalStorageError("OBJECT_KEY_INVALID");
    return `${this.#config.productId}/${this.#config.environment}/objects/${objectKey}`;
  }

  private failure(operation: QiniuOperation, outcome: QiniuOutcome, code?: LocalStorageErrorCode): QiniuStorageError {
    return new QiniuStorageError(code ?? (operation === "write" ? "STORAGE_WRITE_FAILED" : operation === "remove" ? "STORAGE_DELETE_FAILED" : "STORAGE_READ_FAILED"), operation, outcome);
  }

  private async credentials(operation: QiniuOperation): Promise<QiniuCredentials> {
    try {
      const value = await this.#resolveCredentials(Object.freeze({ productId: this.#config.productId,
        environment: this.#config.environment, bucket: this.#config.bucket, operation }));
      if (!value || typeof value.accessKey !== "string" || typeof value.secretKey !== "string" ||
          !/^[A-Za-z0-9_-]{8,128}$/.test(value.accessKey) || !/^[A-Za-z0-9_-]{8,128}$/.test(value.secretKey)) throw new Error();
      return { accessKey: value.accessKey, secretKey: value.secretKey };
    } catch { throw this.failure(operation, "not_attempted"); }
  }

  private timestamp(): number {
    const value = Math.floor(this.#now() / 1000);
    if (!Number.isSafeInteger(value) || value < 1 || value > 253402300000) throw new LocalStorageError("STORAGE_ROOT_INVALID");
    return value;
  }

  private async send(operation: QiniuOperation, request: QiniuHttpRequest): Promise<QiniuHttpResponse> {
    try {
      const result = await this.#transport.send(request);
      if (!Number.isInteger(result.status) || result.status < 100 || result.status > 699 ||
          !(result.body instanceof Uint8Array) || result.body.byteLength > request.maxResponseBytes) throw new Error();
      if (result.status >= 300 && result.status < 400) throw new Error();
      return { status: result.status, headers: { ...result.headers }, body: Buffer.from(result.body) };
    } catch {
      // Even a timeout/error after POST may follow vendor acceptance. Conservatively
      // preserve unknown for every transport failure; never leak native exceptions.
      throw this.failure(operation, operation === "write" || operation === "remove" ? "unknown" : "rejected");
    }
  }

  async write(objectKey: string, bytes: Uint8Array): Promise<{ path: string; size: number }> {
    const key = this.relativePath(objectKey);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > this.#maxBytes) throw this.failure("write", "not_attempted");
    // Copy only the supplied view, before the first await; Buffer.from(arrayBuffer)
    // would retain caller memory and could upload unrelated backing-buffer bytes.
    const content = Buffer.from(bytes);
    const hash = qiniuHash(content);
    const credentials = await this.credentials("write");
    const policy = base64url(JSON.stringify({ scope: `${this.#config.bucket}:${key}`, deadline: this.timestamp() + 300,
      insertOnly: 1, fsizeLimit: content.byteLength, returnBody: '{"key":"$(key)","hash":"$(etag)"}' }));
    const token = signature(policy, credentials) + ":" + policy;
    let boundary: string;
    do { boundary = "aij-" + randomBytes(24).toString("hex"); } while (content.includes(Buffer.from(boundary)));
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="key"\r\n\r\n${key}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="token"\r\n\r\n${token}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="object"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      content, Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const result = await this.send("write", { url: this.#config.uploadOrigin + "/", method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=" + boundary }, body, maxResponseBytes: QINIU_JSON_BYTES });
    if (result.status === 614) throw this.failure("write", "rejected", "OBJECT_EXISTS");
    if (result.status !== 200) throw this.failure("write", result.status >= 400 && result.status < 500 && result.status !== 408 ? "rejected" : "unknown");
    try {
      const receipt = jsonObject(result);
      if (receipt.key !== key || !isHash(receipt.hash) || receipt.hash !== hash) throw new Error();
    } catch { throw this.failure("write", "unknown"); }
    return { path: key, size: content.byteLength };
  }

  private async management(objectKey: string, operation: "stat" | "remove"): Promise<QiniuHttpResponse> {
    const key = this.relativePath(objectKey);
    const credentials = await this.credentials(operation);
    const method = operation === "stat" ? "GET" : "POST";
    const path = `/${operation === "stat" ? "stat" : "delete"}/${base64url(this.#config.bucket + ":" + key)}`;
    const date = new Date(this.timestamp() * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const host = new URL(this.#config.managementOrigin).host;
    const authorization = "Qiniu " + signature(`${method} ${path}\nHost: ${host}\nContent-Type: ${FORM_TYPE}\nX-Qiniu-Date: ${date}\n\n`, credentials);
    return this.send(operation, { url: this.#config.managementOrigin + path, method,
      headers: { "Content-Type": FORM_TYPE, "X-Qiniu-Date": date, Authorization: authorization }, maxResponseBytes: QINIU_JSON_BYTES });
  }

  private async stat(objectKey: string): Promise<{ size: number; hash: string } | null> {
    const result = await this.management(objectKey, "stat");
    // Management 404 may mean a nonexistent bucket/route; only Qiniu's explicit
    // 612 is object absence here. Outage or corrupt metadata must never be false.
    if (result.status === 612) return null;
    if (result.status !== 200) throw this.failure("stat", "rejected");
    try {
      const value = jsonObject(result);
      if (!Number.isSafeInteger(value.fsize) || (value.fsize as number) < 0 || (value.fsize as number) > this.#maxBytes || !isHash(value.hash)) throw new Error();
      return { size: value.fsize as number, hash: value.hash };
    } catch { throw this.failure("stat", "rejected", "OBJECT_INVALID"); }
  }

  async exists(objectKey: string): Promise<boolean> { return (await this.stat(objectKey)) !== null; }

  /** Returns a bearer URL for this exact UUID only; host authorization precedes
   * this call. TTL 1..300s; never persist/log it or use it as a logical path.
   */
  async signedGetUrl(objectKey: string, ttlSeconds = this.#ttl): Promise<string> {
    const key = this.relativePath(objectKey);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 300) throw this.failure("sign", "not_attempted");
    const credentials = await this.credentials("sign");
    const url = `${this.#config.downloadOrigin}/${key}?e=${this.timestamp() + ttlSeconds}`;
    return url + "&token=" + signature(url, credentials);
  }

  async read(objectKey: string): Promise<Buffer> {
    const metadata = await this.stat(objectKey);
    if (!metadata) throw this.failure("read", "rejected", "OBJECT_MISSING");
    const url = await this.signedGetUrl(objectKey);
    const result = await this.send("read", { url, method: "GET", headers: {}, maxResponseBytes: this.#maxBytes });
    if (result.status === 404 || result.status === 612) throw this.failure("read", "rejected", "OBJECT_MISSING");
    if (result.status !== 200) throw this.failure("read", "rejected");
    const content = Buffer.from(result.body);
    if (content.length !== metadata.size || qiniuHash(content) !== metadata.hash) throw this.failure("read", "rejected", "OBJECT_INVALID");
    return content;
  }

  async remove(objectKey: string): Promise<void> {
    const result = await this.management(objectKey, "remove");
    if (result.status === 612) throw this.failure("remove", "rejected", "OBJECT_MISSING");
    if (result.status !== 200) throw this.failure("remove", result.status >= 400 && result.status < 500 && result.status !== 408 ? "rejected" : "unknown");
    if (result.body.byteLength !== 0) throw this.failure("remove", "unknown");
  }
}
