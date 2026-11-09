import { LocalStorageError } from "@aij/runtime-contracts";
import type { LocalStorageErrorCode } from "@aij/runtime-contracts";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";

export const QINIU_MAX_OBJECT_BYTES = 5 * 1024 * 1024;
export const QINIU_JSON_BYTES = 16 * 1024;
export const QINIU_REGIONS = Object.freeze([
  "z0", "cn-east-2", "z1", "z2", "na0", "as0", "ap-southeast-2", "ap-southeast-3"
] as const);
export type QiniuRegion = typeof QINIU_REGIONS[number];
export type QiniuOperation = "write" | "read" | "stat" | "remove" | "sign";
export type QiniuOutcome = "not_attempted" | "rejected" | "unknown";

// Keep the shared error identity/codes used by storage callers. Never attach a
// vendor body, URL, credentials, native network exception or cause to this error.
export class QiniuStorageError extends LocalStorageError {
  constructor(code: LocalStorageErrorCode, readonly operation: QiniuOperation, readonly outcome: QiniuOutcome) {
    super(code);
  }
}

export interface QiniuHttpRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Uint8Array;
  readonly maxResponseBytes: number;
}
export interface QiniuHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: Uint8Array;
}
export interface QiniuTransport {
  send(input: QiniuHttpRequest): Promise<QiniuHttpResponse>;
}

// Only safe enums cross the transport boundary. No native error is retained.
export class QiniuTransportError extends Error {
  constructor(readonly reason: "policy" | "timeout" | "network" | "redirect" | "size" | "response") {
    super("QINIU_TRANSPORT_" + reason.toUpperCase());
  }
}

export function assertQiniuHost(host: string): void {
  if (typeof host !== "string" || host.length > 253 || host !== host.toLowerCase() ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host) ||
      isIP(host) !== 0 || /(?:^|\.)(?:localhost|local|internal|test|invalid|onion|home|lan)$/.test(host)) {
    throw new LocalStorageError("STORAGE_ROOT_INVALID");
  }
}

export function assertQiniuOrigin(origin: string, hosts: ReadonlySet<string>): string {
  if (typeof origin !== "string" || !origin.startsWith("https://")) throw new LocalStorageError("STORAGE_ROOT_INVALID");
  const host = origin.slice(8);
  assertQiniuHost(host);
  if (!hosts.has(host)) throw new LocalStorageError("STORAGE_ROOT_INVALID");
  return host;
}

// Conservative IPv4-only policy; deny special-use networks even when a subset
// has an exception in the IANA registry. IPv6 (including mapped IPv4) is denied.
export function isQiniuPublicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99) ||
      (b === 31 && c === 196) || (b === 52 && c === 193) || (b === 175 && c === 48))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export interface QiniuNetworkIO {
  resolve4(host: string): Promise<readonly string[]>;
  request: typeof request;
}
const productionIO: QiniuNetworkIO = {
  resolve4: async (host) => (await lookup(host, { all: true, family: 4, verbatim: true })).map((entry) => entry.address),
  request
};

/** Own HTTPS transport: no proxy/env configuration, redirects, fallback or retry.
 * Optional IO is constructor-scoped for synthetic tests only. The default always
 * checks DNS, pins lookup, and verifies TLS with the original hostname/SNI.
 */
export class QiniuHttpsTransport implements QiniuTransport {
  private readonly hosts: ReadonlySet<string>;
  private readonly io: QiniuNetworkIO;
  private readonly timeoutMs: number;

  constructor(allowedHosts: readonly string[], timeoutMs = 10_000, testIO?: QiniuNetworkIO) {
    if (!Array.isArray(allowedHosts) || !allowedHosts.length || allowedHosts.length > 16 ||
        !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 30_000) {
      throw new LocalStorageError("STORAGE_ROOT_INVALID");
    }
    allowedHosts.forEach(assertQiniuHost);
    this.hosts = new Set(allowedHosts);
    this.timeoutMs = timeoutMs;
    this.io = testIO ? { resolve4: testIO.resolve4, request: testIO.request } : productionIO;
  }

  async send(input: QiniuHttpRequest): Promise<QiniuHttpResponse> {
    let url: URL;
    try {
      url = new URL(input.url);
      assertQiniuHost(url.hostname);
      if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash ||
          !this.hosts.has(url.hostname) || url.href !== input.url ||
          !["GET", "POST"].includes(input.method) ||
          !Number.isSafeInteger(input.maxResponseBytes) || input.maxResponseBytes < 0 || input.maxResponseBytes > QINIU_MAX_OBJECT_BYTES ||
          (input.body && (!(input.body instanceof Uint8Array) || input.body.byteLength > QINIU_MAX_OBJECT_BYTES + QINIU_JSON_BYTES))) {
        throw new Error();
      }
    } catch { throw new QiniuTransportError("policy"); }
    const method = input.method;
    const limit = input.maxResponseBytes;
    const body = input.body ? Buffer.from(input.body) : undefined;
    const headers: Record<string, string> = { "Accept-Encoding": "identity", Connection: "close" };
    // Callers cannot override routing, framing, decompression or TLS identity.
    for (const [name, value] of Object.entries(input.headers)) {
      if (!["authorization", "content-type", "x-qiniu-date"].includes(name.toLowerCase()) ||
          typeof value !== "string" || value.length > 8192 || /[\r\n\0]/.test(value)) throw new QiniuTransportError("policy");
      headers[name] = value;
    }
    if (body || method === "POST") headers["Content-Length"] = String(body?.byteLength ?? 0);
    return new Promise((resolve, reject) => {
      let done = false;
      let req: ClientRequest | undefined;
      let res: IncomingMessage | undefined;
      const finish = (reason?: QiniuTransportError, result?: QiniuHttpResponse) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (reason) { res?.destroy(); req?.destroy(); reject(reason); }
        else resolve(result!);
      };
      // Total deadline includes DNS, connection, TLS, headers and the entire body.
      const timer = setTimeout(() => finish(new QiniuTransportError("timeout")), this.timeoutMs);
      void (async () => {
        try {
          const addresses = await this.io.resolve4(url.hostname);
          if (done) return; // A late DNS completion must never open a socket.
          if (!addresses.length || addresses.length > 64 || !addresses.every(isQiniuPublicIpv4)) {
            finish(new QiniuTransportError("policy")); return;
          }
          const pinned = addresses[0];
          req = this.io.request({
            protocol: "https:", hostname: url.hostname, port: 443,
            servername: url.hostname, method, path: url.pathname + url.search,
            headers, agent: false, family: 4,
            rejectUnauthorized: true, minVersion: "TLSv1.2", maxHeaderSize: 8192,
            checkServerIdentity: (_host, cert) => checkServerIdentity(url.hostname, cert),
            // No second resolver lookup, pooled connection or alternate IP fallback.
            lookup: (_host, options, callback) => {
              if (options.all) callback(null, [{ address: pinned, family: 4 }]);
              else callback(null, pinned, 4);
            }
          }, (response) => {
            res = response;
            if (done) { response.destroy(); return; }
            const status = response.statusCode ?? 0;
            if (status >= 300 && status < 400) { finish(new QiniuTransportError("redirect")); return; }
            const length = response.headers["content-length"];
            const encoding = response.headers["content-encoding"];
            if (status < 100 || status > 699 || (encoding && encoding !== "identity")) {
              finish(new QiniuTransportError("response")); return;
            }
            if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > limit)) {
              finish(new QiniuTransportError("size")); return;
            }
            let size = 0;
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => {
              size += chunk.byteLength;
              if (size > limit) { finish(new QiniuTransportError("size")); return; }
              if (!done) chunks.push(Buffer.from(chunk));
            });
            response.on("error", () => finish(new QiniuTransportError("network")));
            response.on("aborted", () => finish(new QiniuTransportError("network")));
            response.on("end", () => {
              if (!response.complete || (length !== undefined && size !== Number(length))) { finish(new QiniuTransportError("response")); return; }
              finish(undefined, {
                status, headers: { "content-type": response.headers["content-type"] }, body: Buffer.concat(chunks, size)
              });
            });
          });
          req.on("error", () => finish(new QiniuTransportError("network")));
          req.end(body);
        } catch { finish(new QiniuTransportError("network")); }
      })();
    });
  }
}
