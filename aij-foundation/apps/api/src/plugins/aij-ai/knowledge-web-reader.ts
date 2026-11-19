import { createHash } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { Agent, request } from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { isIP } from 'node:net';
import type { LookupFunction } from 'node:net';
import { performance } from 'node:perf_hooks';
import { checkServerIdentity, connect } from 'node:tls';
import type { ConnectionOptions, TLSSocket } from 'node:tls';
import { domainToASCII, domainToUnicode } from 'node:url';

export const KNOWLEDGE_WEB_READER_POLICY = Object.freeze({
  maxUrlLength: 2048, maxBytes: 1024 * 1024, maxHeaderBytes: 16384,
  maxHeaders: 100, maxAddresses: 64, maxRedirects: 3,
  overallMs: 15000, dnsMs: 2000, headersMs: 5000, readMs: 3000,
});
export type KnowledgeWebReaderErrorCode =
  | 'URL_REJECTED' | 'ADDRESS_REJECTED' | 'DNS_FAILED' | 'DNS_TIMEOUT'
  | 'CANCELLED' | 'DEADLINE_EXCEEDED' | 'HEADERS_TIMEOUT' | 'READ_TIMEOUT'
  | 'TLS_FAILED' | 'TRANSPORT_FAILED' | 'HEADERS_INVALID' | 'STATUS_REJECTED'
  | 'REDIRECT_REJECTED' | 'ENCODING_REJECTED' | 'CONTENT_TYPE_REJECTED'
  | 'BODY_TOO_LARGE' | 'BODY_INVALID' | 'CACHE_INVALID';
/** Safe to record the code/counts; never record input URLs, response headers or body. */
export class KnowledgeWebReaderError extends Error {
  readonly code: KnowledgeWebReaderErrorCode;
  constructor(code: KnowledgeWebReaderErrorCode) {
    super(code);
    this.name = 'KnowledgeWebReaderError';
    this.code = code;
  }
}
function fail(code: KnowledgeWebReaderErrorCode): never { throw new KnowledgeWebReaderError(code); }
export type KnowledgeWebContentType = 'text/html' | 'text/plain';
export interface KnowledgeWebCacheContext {
  /** Server-owned persisted metadata of an existing, validated resource; never accept from a request body. */
  readonly sourceUrl: string;
  readonly checksum: string;
  readonly contentType: KnowledgeWebContentType;
  readonly etag?: string;
  readonly lastModified?: string;
}
export interface KnowledgeWebReadOptions {
  readonly signal?: AbortSignal;
  readonly cache?: KnowledgeWebCacheContext;
}
interface ResourceMetadata extends KnowledgeWebCacheContext { readonly redirectCount: number }
export type KnowledgeWebReadResult =
  | (ResourceMetadata & { readonly state: 'fetched'; readonly bytes: Buffer; readonly text: string; readonly byteLength: number })
  | (ResourceMetadata & { readonly state: 'not-modified' });
export interface KnowledgeWebAddress { readonly address: string; readonly family: 4 | 6 }
/** Trusted composition/test seams only. No transport, trust, resolver or timeout options in read(). */
export type KnowledgeWebTlsOptions = ConnectionOptions & { readonly family: 4 | 6; readonly autoSelectFamily: false };
export interface KnowledgeWebReaderDependencies {
  readonly resolve?: (hostname: string, signal: AbortSignal) => Promise<readonly KnowledgeWebAddress[]>;
  readonly connect?: (options: KnowledgeWebTlsOptions) => TLSSocket;
  /** Can only shorten fixed production bounds. */
  readonly timeouts?: Partial<Record<'overallMs' | 'dnsMs' | 'headersMs' | 'readMs', number>>;
}

const unsafeUrlCharacters = (value: string): boolean => /[\s\\#]/u.test(value) || Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const blockedLabels = new Set(['localhost', 'local', 'localdomain', 'internal', 'intranet', 'lan', 'corp', 'home', 'private', 'test', 'invalid', 'example', 'onion', 'alt', 'arpa', 'metadata', 'instance-data']);
export function normalizeKnowledgeWebUrl(input: string): URL {
  if (typeof input !== 'string' || input.length > 2048 || unsafeUrlCharacters(input) || /%(?![\da-f]{2})/i.test(input)) fail('URL_REJECTED');
  const authority = /^https:\/\/([^/?#]+)/i.exec(input)?.[1];
  if (!authority || /[@%\u0080-\uffff]/u.test(authority)) fail('URL_REJECTED');
  let url: URL;
  try { url = new URL(input); decodeURIComponent(url.pathname); decodeURIComponent(url.search); } catch { return fail('URL_REJECTED'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.href.length > 2048) fail('URL_REJECTED');
  const host = url.hostname;
  const labels = host.split('.');
  if (isIP(host) || host.includes(':') || host.length > 253 || labels.length < 2 || !/^[a-z][a-z0-9-]*[a-z0-9]$/i.test(labels.at(-1) ?? '')
    || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label) || blockedLabels.has(label))) fail('URL_REJECTED');
  if (domainToASCII(domainToUnicode(host)) !== host || /(^|\.)example\.(com|net|org)$/.test(host)) fail('URL_REJECTED');
  // Reject alternate authority spellings (numeric IP normalization, trailing dots, nondefault/empty ports).
  if (authority.toLowerCase() !== host && authority.toLowerCase() !== `${host}:443`) fail('URL_REJECTED');
  return url;
}

function ipv4Number(address: string): number {
  return address.split('.').reduce((value, part) => value * 256 + Number(part), 0);
}
function ipv6Number(address: string): bigint {
  const halves = address.toLowerCase().split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const words = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return words.reduce((value: bigint, word: string) => (value << 16n) | BigInt(`0x${word}`), 0n);
}
// Conservative: reject every IANA special-purpose allocation, including globally reachable special services.
const specialV4: readonly [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['192.175.48.0', 24],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
];
const specialV6: readonly [bigint, number][] = [
  [ipv6Number('2001::'), 23], [ipv6Number('2001:db8::'), 32], [ipv6Number('2002::'), 16],
  [ipv6Number('2620:4f:8000::'), 48], [ipv6Number('3fff::'), 20],
];
export function isPublicKnowledgeWebAddress(address: string): boolean {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    return !specialV4.some(([base, bits]) => Math.floor(value / 2 ** (32 - bits)) === Math.floor(ipv4Number(base) / 2 ** (32 - bits)));
  }
  if (family !== 6 || address.includes('.')) return false;
  const value = ipv6Number(address);
  // Only native global unicast; excludes mapped/compatible, NAT64, ULA, multicast, link/site-local, reserved and transition ranges.
  const interfacePrefix = (value >> 32n) & 0xffffffffn;
  if (interfacePrefix === 0x00005efen || interfacePrefix === 0x02005efen) return false; // ISATAP
  return value >> 125n === 1n && !specialV6.some(([base, bits]) => value >> BigInt(128 - bits) === base >> BigInt(128 - bits));
}
function signalError(signal: AbortSignal): KnowledgeWebReaderError {
  return new KnowledgeWebReaderError(signal.reason === 'DEADLINE_EXCEEDED' ? 'DEADLINE_EXCEEDED' : signal.reason === 'DNS_TIMEOUT' ? 'DNS_TIMEOUT' : 'CANCELLED');
}
async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signalError(signal);
  let abort: () => void = () => {};
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      abort = () => reject(signalError(signal));
      signal.addEventListener('abort', abort, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', abort); }
}
async function defaultResolve(hostname: string, signal: AbortSignal): Promise<readonly KnowledgeWebAddress[]> {
  const resolver = new Resolver({ timeout: KNOWLEDGE_WEB_READER_POLICY.dnsMs, tries: 1 });
  const abort = () => resolver.cancel();
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw signalError(signal);
    const query = async (family: 4 | 6): Promise<KnowledgeWebAddress[]> => {
      try { return (await (family === 4 ? resolver.resolve4(hostname) : resolver.resolve6(hostname))).map(address => ({ address, family })); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENODATA') return []; throw error; }
    };
    return (await Promise.all([query(4), query(6)])).flat();
  } finally { resolver.cancel(); signal.removeEventListener('abort', abort); }
}
function etag(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 256 || !/^(?:W\/)?"[\x21\x23-\x7e]*"$/.test(value)) fail('CACHE_INVALID');
  return value;
}
function lastModified(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length !== 29 || !Number.isFinite(Date.parse(value)) || new Date(value).toUTCString() !== value) fail('CACHE_INVALID');
  return value;
}
function validateCache(cache?: KnowledgeWebCacheContext): KnowledgeWebCacheContext | undefined {
  if (cache === undefined) return undefined;
  try {
    if (!cache || normalizeKnowledgeWebUrl(cache.sourceUrl).href !== cache.sourceUrl || !/^[a-f0-9]{64}$/.test(cache.checksum)
      || !['text/html', 'text/plain'].includes(cache.contentType)) fail('CACHE_INVALID');
    const validators = { etag: etag(cache.etag), lastModified: lastModified(cache.lastModified) };
    if (!validators.etag && !validators.lastModified) fail('CACHE_INVALID');
    return Object.freeze({ sourceUrl: cache.sourceUrl, checksum: cache.checksum, contentType: cache.contentType, ...validators });
  } catch { return fail('CACHE_INVALID'); }
}
function responseValidators(response: IncomingMessage): Pick<KnowledgeWebCacheContext, 'etag' | 'lastModified'> {
  try { return { etag: etag(response.headers.etag), lastModified: lastModified(response.headers['last-modified']) }; }
  catch { return fail('HEADERS_INVALID'); }
}
function responseType(value: unknown): KnowledgeWebContentType {
  if (typeof value !== 'string') fail('CONTENT_TYPE_REJECTED');
  const match = /^text\/(html|plain)(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i.exec(value.trim());
  if (!match) fail('CONTENT_TYPE_REJECTED');
  return `text/${match[1].toLowerCase()}` as KnowledgeWebContentType;
}
function safeTransportError(error: unknown): KnowledgeWebReaderError {
  if (error instanceof KnowledgeWebReaderError) return error;
  const code = (error as NodeJS.ErrnoException)?.code ?? '';
  return new KnowledgeWebReaderError(code === 'HPE_HEADER_OVERFLOW' ? 'HEADERS_INVALID' : /^(ERR_TLS_|ERR_SSL_|CERT_|DEPTH_ZERO_|SELF_SIGNED_|UNABLE_TO_)/.test(code) ? 'TLS_FAILED' : 'TRANSPORT_FAILED');
}
function invalidText(text: string): boolean {
  if (!text.trim() || text.charCodeAt(0) === 0xfeff) return true;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) return true;
  }
  return false;
}
interface Hop { status: number; location?: string; bytes?: Buffer; contentType?: KnowledgeWebContentType; etag?: string; lastModified?: string }
const redirects = new Set([301, 302, 303, 307, 308]);

export class KnowledgeWebReader {
  readonly #resolve: NonNullable<KnowledgeWebReaderDependencies['resolve']>;
  readonly #connect: NonNullable<KnowledgeWebReaderDependencies['connect']>;
  readonly #timeouts: Readonly<Record<'overallMs' | 'dnsMs' | 'headersMs' | 'readMs', number>>;
  constructor(trusted: KnowledgeWebReaderDependencies = {}) {
    this.#resolve = trusted.resolve ?? defaultResolve;
    this.#connect = trusted.connect ?? connect;
    const timeouts = { overallMs: 15000, dnsMs: 2000, headersMs: 5000, readMs: 3000 };
    for (const key of Object.keys(timeouts) as (keyof typeof timeouts)[]) {
      const value = trusted.timeouts?.[key];
      if (value !== undefined) {
        if (!Number.isInteger(value) || value < 1 || value > timeouts[key]) fail('HEADERS_INVALID');
        timeouts[key] = value;
      }
    }
    this.#timeouts = Object.freeze(timeouts);
    Object.freeze(this);
  }
  async read(input: string, options: KnowledgeWebReadOptions = {}): Promise<KnowledgeWebReadResult> {
    const controller = new AbortController();
    const cancel = () => controller.abort('CANCELLED');
    const deadline = performance.now() + this.#timeouts.overallMs;
    const ensureActive = () => {
      if (performance.now() >= deadline) controller.abort('DEADLINE_EXCEEDED');
      if (controller.signal.aborted) throw signalError(controller.signal);
    };
    const timer = setTimeout(() => controller.abort('DEADLINE_EXCEEDED'), this.#timeouts.overallMs);
    const externalSignal = options.signal;
    externalSignal?.addEventListener('abort', cancel, { once: true });
    try {
      if (externalSignal?.aborted) cancel();
      let url = normalizeKnowledgeWebUrl(input);
      const cache = validateCache(options.cache);
      for (let count = 0; ; count++) {
        ensureActive();
        const dnsScope = new AbortController();
        const abortDns = () => dnsScope.abort(controller.signal.reason);
        const dnsTimer = setTimeout(() => dnsScope.abort('DNS_TIMEOUT'), this.#timeouts.dnsMs);
        controller.signal.addEventListener('abort', abortDns, { once: true });
        let answers: readonly KnowledgeWebAddress[];
        try { answers = await withAbort(Promise.resolve().then(() => this.#resolve(url.hostname, dnsScope.signal)), dnsScope.signal); }
        catch (error) { if (dnsScope.signal.aborted) throw signalError(dnsScope.signal); if (error instanceof KnowledgeWebReaderError) throw error; return fail('DNS_FAILED'); }
        finally { clearTimeout(dnsTimer); controller.signal.removeEventListener('abort', abortDns); }
        if (!Array.isArray(answers) || !answers.length || answers.length > KNOWLEDGE_WEB_READER_POLICY.maxAddresses) fail('DNS_FAILED');
        if (answers.some(answer => !answer || isIP(answer.address) !== answer.family || !isPublicKnowledgeWebAddress(answer.address))) fail('ADDRESS_REJECTED');
        // Snapshot trusted resolver output before any asynchronous transport work.
        const selected = Object.freeze({ address: answers[0].address, family: answers[0].family });
        ensureActive();
        const sameCache = cache?.sourceUrl === url.href ? cache : undefined;
        const hop = await this.#fetch(url, selected, controller.signal, sameCache);
        ensureActive();
        if (redirects.has(hop.status)) {
          if (count >= KNOWLEDGE_WEB_READER_POLICY.maxRedirects || !hop.location) fail('REDIRECT_REJECTED');
          try {
            if (hop.location.length > 2048 || unsafeUrlCharacters(hop.location) || /%(?![\da-f]{2})/i.test(hop.location)) fail('REDIRECT_REJECTED');
            const target = /^https:/i.test(hop.location) ? hop.location : hop.location.startsWith('//') ? `https:${hop.location}` : new URL(hop.location, url).href;
            url = normalizeKnowledgeWebUrl(target);
          } catch { return fail('REDIRECT_REJECTED'); }
          continue;
        }
        if (hop.status === 304) {
          if (!sameCache) fail('CACHE_INVALID');
          if (sameCache.etag && hop.etag && sameCache.etag.replace(/^W\//, '') !== hop.etag.replace(/^W\//, '')) fail('CACHE_INVALID');
          if (!sameCache.etag && hop.lastModified && hop.lastModified !== sameCache.lastModified) fail('CACHE_INVALID');
          return { ...sameCache, etag: hop.etag ?? sameCache.etag, lastModified: hop.lastModified ?? sameCache.lastModified, state: 'not-modified', redirectCount: count };
        }
        const bytes = hop.bytes!;
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch { return fail('BODY_INVALID'); }
        if (invalidText(text)) fail('BODY_INVALID');
        const checksum = createHash('sha256').update(bytes).digest('hex');
        ensureActive();
        return { state: 'fetched', sourceUrl: url.href, contentType: hop.contentType!, checksum,
          etag: hop.etag, lastModified: hop.lastModified, bytes, text, byteLength: bytes.length, redirectCount: count };
      }
    } catch (error) { throw safeTransportError(error); }
    finally { clearTimeout(timer); externalSignal?.removeEventListener('abort', cancel); }
  }
  #fetch(url: URL, selected: KnowledgeWebAddress, signal: AbortSignal, cache?: KnowledgeWebCacheContext): Promise<Hop> {
    return new Promise((resolve, reject) => {
      const agent = new Agent({ keepAlive: false, maxSockets: 1, maxCachedSessions: 0 });
      // Own Agent never inherits globalAgent proxy configuration; direct TLS does not consult proxy env.
      agent.createConnection = () => this.#connect({ host: url.hostname, port: 443, servername: url.hostname,
        rejectUnauthorized: true, checkServerIdentity, lookup, family: selected.family, autoSelectFamily: false, ALPNProtocols: ['http/1.1'] });
      const lookup: LookupFunction = (_hostname, options, callback) => {
        if (signal.aborted) { callback(signalError(signal), '', selected.family); return; }
        if (options.all) callback(null, [{ address: selected.address, family: selected.family }]);
        else callback(null, selected.address, selected.family);
      };
      const headers: Record<string, string> = { Accept: 'text/html, text/plain', 'User-Agent': 'AIJ-KnowledgeWebReader/1', 'Accept-Encoding': 'identity' };
      if (cache?.etag) headers['If-None-Match'] = cache.etag;
      if (cache?.lastModified) headers['If-Modified-Since'] = cache.lastModified;
      let response: IncomingMessage | undefined;
      let settled = false;
      let req: ReturnType<typeof request> | undefined;
      let timer: ReturnType<typeof setTimeout>;
      let onData: ((chunk: Buffer) => void) | undefined;
      let onEnd: (() => void) | undefined;
      const onError = (error: unknown) => finish(error);
      const onAborted = () => finish(new KnowledgeWebReaderError('TRANSPORT_FAILED'));
      const onInformation = () => finish(new KnowledgeWebReaderError('STATUS_REJECTED'));
      const onUpgrade = (_res: IncomingMessage, socket: Duplex) => { socket.destroy(); finish(new KnowledgeWebReaderError('STATUS_REJECTED')); };
      const cleanup = () => {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        if (onData) response?.off('data', onData);
        if (onEnd) response?.off('end', onEnd);
        response?.off('aborted', onAborted);
        req?.off('information', onInformation); req?.off('upgrade', onUpgrade);
        // Error listeners stay until close to absorb asynchronous destroy/TLS errors, then detach.
        response?.destroy(); req?.destroy(); agent.destroy();
      };
      const finish = (error?: unknown, value?: Hop) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(safeTransportError(error)); else resolve(value!);
      };
      const abort = () => finish(signalError(signal));
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(new KnowledgeWebReaderError('HEADERS_TIMEOUT')), this.#timeouts.headersMs);
      try {
        if (signal.aborted) { abort(); return; }
        req = request({ protocol: 'https:', hostname: url.hostname, port: 443, path: url.pathname + url.search, method: 'GET', headers,
          agent, lookup, family: selected.family, servername: url.hostname,
          rejectUnauthorized: true, checkServerIdentity, maxHeaderSize: KNOWLEDGE_WEB_READER_POLICY.maxHeaderBytes,
          insecureHTTPParser: false, joinDuplicateHeaders: false }, res => {
          response = res;
          res.on('error', onError);
          res.on('aborted', onAborted);
          res.once('close', () => {
            res.off('error', onError); res.off('aborted', onAborted);
            if (!settled) finish(new KnowledgeWebReaderError('TRANSPORT_FAILED'));
          });
          if (settled) { res.destroy(); return; }
          clearTimeout(timer);
          try {
            if (res.rawHeaders.length / 2 > KNOWLEDGE_WEB_READER_POLICY.maxHeaders) fail('HEADERS_INVALID');
            const seen = new Set<string>();
            for (let i = 0; i < res.rawHeaders.length; i += 2) {
              const name = res.rawHeaders[i].toLowerCase();
              if (seen.has(name) && ['content-type', 'content-length', 'content-encoding', 'location', 'etag', 'last-modified', 'transfer-encoding'].includes(name)) fail('HEADERS_INVALID');
              seen.add(name);
            }
            const status = res.statusCode ?? 0;
            if (redirects.has(status)) { finish(undefined, { status, location: res.headers.location }); return; }
            if (status !== 200 && status !== 304) fail('STATUS_REJECTED');
            const encoding = res.headers['content-encoding'];
            if (encoding !== undefined && (typeof encoding !== 'string' || encoding.toLowerCase() !== 'identity')) fail('ENCODING_REJECTED');
            const validators = responseValidators(res);
            if (status === 304) { if (!cache) fail('CACHE_INVALID'); finish(undefined, { status, ...validators }); return; }
            const contentType = responseType(res.headers['content-type']);
            const length = res.headers['content-length'];
            if (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length))) fail('HEADERS_INVALID');
            if (length !== undefined && Number(length) > KNOWLEDGE_WEB_READER_POLICY.maxBytes) fail('BODY_TOO_LARGE');
            const chunks: Buffer[] = [];
            let size = 0;
            const armRead = () => { clearTimeout(timer); timer = setTimeout(() => finish(new KnowledgeWebReaderError('READ_TIMEOUT')), this.#timeouts.readMs); };
            armRead();
            onData = (chunk: Buffer) => {
              if (settled) return;
              size += chunk.length;
              if (size > KNOWLEDGE_WEB_READER_POLICY.maxBytes) { finish(new KnowledgeWebReaderError('BODY_TOO_LARGE')); return; }
              chunks.push(chunk);
              armRead();
            };
            res.on('data', onData);
            onEnd = () => {
              if (!res.complete || (length !== undefined && size !== Number(length))) finish(new KnowledgeWebReaderError('BODY_INVALID'));
              else finish(undefined, { status, contentType, ...validators, bytes: Buffer.concat(chunks, size) });
            };
            res.on('end', onEnd);
          } catch (error) { finish(error); }
        });
        req.on('error', onError);
        req.once('close', () => { req?.off('error', onError); });
        req.on('information', onInformation);
        req.on('upgrade', onUpgrade);
        req.maxHeadersCount = 0; // Size bounded by parser; count checked without silent truncation.
        req.end();
      } catch (error) { finish(error); }
    });
  }
}
/** Real DNS + pinned HTTPS/TLS implementation; no environment switch or caller connection configuration. */
export const knowledgeWebReader = new KnowledgeWebReader();
