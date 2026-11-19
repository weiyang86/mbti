import { inspect } from 'node:util';

/** Internal protocol preparation only. This is NOT a registered product capability. */
export const ALIYUN_RETRIEVAL_POLICY = Object.freeze({
    version: 'aliyun-native-retrieval/1',
    configured: false,
    region: 'cn-beijing',
    embedding: Object.freeze({
        model: 'text-embedding-v4', dimension: 1024, maxTexts: 4, maxTextBytes: 2048,
        endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding',
    }),
    rerank: Object.freeze({
        model: 'qwen3-rerank', maxDocuments: 8, maxQueryBytes: 512, maxDocumentBytes: 2048,
        endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank',
    }),
    maxRequestBytes: 24 * 1024,
    maxResponseBytes: 256 * 1024,
    timeoutMs: 10_000,
});

/** AiCenterHttpTransport-compatible: fetch-decoded body, original HTTP headers. No new transport. */
export interface AliyunRetrievalTransport {
    request(url: string, init: RequestInit): Promise<Response>;
}
export type AliyunEmbeddingInput = { texts: readonly string[]; textType: 'query' | 'document' };
export type AliyunRerankInput = { query: string; documents: readonly string[]; topN: number };
export type AliyunRetrievalUsage = Readonly<
    { state: 'reported'; totalTokens: number } | { state: 'unknown' }
>;
export type AliyunRank = Readonly<{ index: number; score: number }>;
export type AliyunRetrievalErrorCode =
    | 'ALIYUN_INPUT_INVALID' | 'ALIYUN_CREDENTIAL_INVALID' | 'ALIYUN_SECRET_INPUT'
    | 'ALIYUN_CANCELLED' | 'ALIYUN_TIMEOUT' | 'ALIYUN_TRANSPORT_FAILED'
    | 'ALIYUN_RATE_LIMITED' | 'ALIYUN_AUTH_REJECTED' | 'ALIYUN_UPSTREAM_REJECTED'
    | 'ALIYUN_RESPONSE_INVALID' | 'ALIYUN_RESPONSE_TOO_LARGE' | 'ALIYUN_USAGE_INVALID';

export class AliyunRetrievalError extends Error {
    constructor(readonly code: AliyunRetrievalErrorCode) {
        super(code);
        this.name = 'AliyunRetrievalError';
    }
}
function fail(code: AliyunRetrievalErrorCode): never { throw new AliyunRetrievalError(code); }

// Explicit extraction is required. Default JSON/inspection never serializes private vectors.
export class AliyunEmbeddingResult {
    #vectors: readonly (readonly number[])[];
    #usage: AliyunRetrievalUsage;
    constructor(vectors: number[][], usage: AliyunRetrievalUsage) {
        this.#vectors = Object.freeze(vectors.map(v => Object.freeze([...v])));
        this.#usage = usage;
        Object.freeze(this);
    }
    readVectors(): readonly (readonly number[])[] { return this.#vectors; }
    readUsage(): AliyunRetrievalUsage { return this.#usage; }
    toJSON() { return { kind: 'aliyun.embedding', private: true }; }
    [inspect.custom]() { return 'AliyunEmbeddingResult [private]'; }
}
export class AliyunRerankResult {
    #ranks: readonly AliyunRank[];
    #usage: AliyunRetrievalUsage;
    constructor(ranks: AliyunRank[], usage: AliyunRetrievalUsage) {
        this.#ranks = Object.freeze(ranks.map(r => Object.freeze({ ...r })));
        this.#usage = usage;
        Object.freeze(this);
    }
    readRanks(): readonly AliyunRank[] { return this.#ranks; }
    readUsage(): AliyunRetrievalUsage { return this.#usage; }
    toJSON() { return { kind: 'aliyun.rerank', private: true }; }
    [inspect.custom]() { return 'AliyunRerankResult [private]'; }
}

function record(value: unknown, code: AliyunRetrievalErrorCode): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
    return value as Record<string, unknown>;
}
function shape(value: unknown, required: string[], optional: string[], code: AliyunRetrievalErrorCode) {
    const obj = record(value, code);
    const keys = Reflect.ownKeys(obj);
    if (required.some(k => !Object.hasOwn(obj, k)) || keys.some(k =>
        typeof k !== 'string' || ![...required, ...optional].includes(k) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(obj, k) ?? {}, 'value'))) fail(code);
    return obj;
}
function credentialValue(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(value)) fail('ALIYUN_CREDENTIAL_INVALID');
    return value;
}
function guardedInput<T>(validate: () => T): T {
    try { return validate(); }
    catch (error) {
        if (error instanceof AliyunRetrievalError) throw error;
        // Accessors/proxies must not smuggle caller text through a native exception.
        fail('ALIYUN_INPUT_INVALID');
    }
}
function text(value: unknown, maxBytes: number, credential: string): string {
    // Preserve ordinary source formatting (TAB/LF/CR) byte-for-byte; refuse other
    // C0/C1 controls, unpaired surrogates, bidi and invisible format controls.
    if (typeof value !== 'string' || value.length > maxBytes || !value.trim() ||
        /(?![\t\n\r])[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) || Buffer.byteLength(value, 'utf8') > maxBytes)
        fail('ALIYUN_INPUT_INVALID');
    if (value.includes(credential) || /\bsk-[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9_.-]{8,}|-----BEGIN[^\r\n]*PRIVATE KEY-----/i.test(value))
        fail('ALIYUN_SECRET_INPUT');
    return value;
}
function texts(value: unknown, maxCount: number, maxBytes: number, credential: string): string[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > maxCount ||
        Reflect.ownKeys(value).length !== value.length + 1) fail('ALIYUN_INPUT_INVALID');
    return Array.from({ length: value.length }, (_, i) => {
        const d = Object.getOwnPropertyDescriptor(value, String(i));
        if (!d || !Object.hasOwn(d, 'value')) fail('ALIYUN_INPUT_INVALID');
        return text(d.value, maxBytes, credential);
    });
}
function usage(value: unknown): AliyunRetrievalUsage {
    if (value === undefined) return Object.freeze({ state: 'unknown' });
    const u = shape(value, [], ['total_tokens'], 'ALIYUN_USAGE_INVALID');
    if (!Object.hasOwn(u, 'total_tokens')) return Object.freeze({ state: 'unknown' });
    if (!Number.isSafeInteger(u.total_tokens) || (u.total_tokens as number) < 0 ||
        (u.total_tokens as number) > 2147483647) fail('ALIYUN_USAGE_INVALID');
    return Object.freeze({ state: 'reported', totalTokens: u.total_tokens as number });
}
function envelope(value: unknown) {
    const raw = record(value, 'ALIYUN_RESPONSE_INVALID');
    // Vendor messages, error bodies and request IDs must never enter errors or results.
    if (Object.hasOwn(raw, 'code') || Object.hasOwn(raw, 'message') || Object.hasOwn(raw, 'error'))
        fail('ALIYUN_UPSTREAM_REJECTED');
    const obj = shape(raw, ['output'], ['usage', 'request_id'], 'ALIYUN_RESPONSE_INVALID');
    if (Object.hasOwn(obj, 'request_id') && (typeof obj.request_id !== 'string' ||
        obj.request_id.length < 1 || obj.request_id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(obj.request_id)))
        fail('ALIYUN_RESPONSE_INVALID');
    return obj;
}
function embeddingResult(value: unknown, count: number): AliyunEmbeddingResult {
    const obj = envelope(value), out = shape(obj.output, ['embeddings'], [], 'ALIYUN_RESPONSE_INVALID');
    if (!Array.isArray(out.embeddings) || out.embeddings.length !== count) fail('ALIYUN_RESPONSE_INVALID');
    const vectors: number[][] = new Array(count), seen = new Set<number>();
    let indexField: string | undefined;
    for (const entry of out.embeddings) {
        const e = record(entry, 'ALIYUN_RESPONSE_INVALID');
        // Official native references show text_index; current SDK-oriented docs show index.
        // Accept exactly one documented spelling and never mix spellings in one response.
        const field = Object.hasOwn(e, 'text_index') ? 'text_index' : 'index';
        shape(e, [field, 'embedding'], [], 'ALIYUN_RESPONSE_INVALID');
        if (indexField && indexField !== field) fail('ALIYUN_RESPONSE_INVALID');
        indexField = field;
        const i = e[field];
        if (!Number.isSafeInteger(i) || (i as number) < 0 || (i as number) >= count || seen.has(i as number) ||
            !Array.isArray(e.embedding) || e.embedding.length !== ALIYUN_RETRIEVAL_POLICY.embedding.dimension ||
            !e.embedding.every(n => typeof n === 'number' && Number.isFinite(n))) fail('ALIYUN_RESPONSE_INVALID');
        seen.add(i as number);
        vectors[i as number] = e.embedding;
    }
    return new AliyunEmbeddingResult(vectors, usage(obj.usage));
}
function rerankResult(value: unknown, count: number, topN: number): AliyunRerankResult {
    const obj = envelope(value), out = shape(obj.output, ['results'], [], 'ALIYUN_RESPONSE_INVALID');
    if (!Array.isArray(out.results) || out.results.length !== topN) fail('ALIYUN_RESPONSE_INVALID');
    const seen = new Set<number>(), ranks: AliyunRank[] = [];
    let previousScore = 1;
    for (const entry of out.results) {
        // return_documents:false: any echoed document/text is refused, never used as identity.
        const e = shape(entry, ['index', 'relevance_score'], [], 'ALIYUN_RESPONSE_INVALID');
        const i = e.index, score = e.relevance_score;
        if (!Number.isSafeInteger(i) || (i as number) < 0 || (i as number) >= count || seen.has(i as number) ||
            typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > previousScore)
            fail('ALIYUN_RESPONSE_INVALID');
        seen.add(i as number);
        previousScore = score;
        ranks.push({ index: i as number, score });
    }
    return new AliyunRerankResult(ranks, usage(obj.usage));
}

/** No env reads, registration, secret resolution, ledger, retries or failover. */
export class AliyunRetrievalProtocol {
    #transport: AliyunRetrievalTransport;
    constructor(transport: AliyunRetrievalTransport) { this.#transport = transport; }

    async embed(input: AliyunEmbeddingInput, credential: string, signal?: AbortSignal): Promise<AliyunEmbeddingResult> {
        const key = credentialValue(credential);
        const p = ALIYUN_RETRIEVAL_POLICY.embedding;
        const { batch, textType } = guardedInput(() => {
            const raw = shape(input, ['texts', 'textType'], [], 'ALIYUN_INPUT_INVALID');
            if (raw.textType !== 'query' && raw.textType !== 'document') fail('ALIYUN_INPUT_INVALID');
            return { batch: texts(raw.texts, p.maxTexts, p.maxTextBytes, key), textType: raw.textType };
        });
        const body = { model: p.model, input: { texts: batch }, parameters: {
            text_type: textType, dimension: p.dimension, output_type: 'dense',
        } };
        const response = await this.#request(p.endpoint, body, key, signal);
        if (signal?.aborted) fail('ALIYUN_CANCELLED');
        return embeddingResult(response, batch.length);
    }

    async rerank(input: AliyunRerankInput, credential: string, signal?: AbortSignal): Promise<AliyunRerankResult> {
        const key = credentialValue(credential), p = ALIYUN_RETRIEVAL_POLICY.rerank;
        const { query, documents, topN } = guardedInput(() => {
            const raw = shape(input, ['query', 'documents', 'topN'], [], 'ALIYUN_INPUT_INVALID');
            const query = text(raw.query, p.maxQueryBytes, key);
            const documents = texts(raw.documents, p.maxDocuments, p.maxDocumentBytes, key);
            if (!Number.isSafeInteger(raw.topN) || (raw.topN as number) < 1 || (raw.topN as number) > documents.length)
                fail('ALIYUN_INPUT_INVALID');
            return { query, documents, topN: raw.topN as number };
        });
        const body = { model: p.model, input: { query, documents }, parameters: { top_n: topN, return_documents: false } };
        const response = await this.#request(p.endpoint, body, key, signal);
        if (signal?.aborted) fail('ALIYUN_CANCELLED');
        return rerankResult(response, documents.length, topN);
    }

    async #request(endpoint: string, body: unknown, key: string, signal?: AbortSignal): Promise<unknown> {
        const serialized = JSON.stringify(body);
        if (Buffer.byteLength(serialized) > ALIYUN_RETRIEVAL_POLICY.maxRequestBytes) fail('ALIYUN_INPUT_INVALID');
        if (signal?.aborted) fail('ALIYUN_CANCELLED');
        const controller = new AbortController();
        let abortCode: 'ALIYUN_CANCELLED' | 'ALIYUN_TIMEOUT' = 'ALIYUN_CANCELLED';
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => { abortCode = 'ALIYUN_TIMEOUT'; controller.abort(); }, ALIYUN_RETRIEVAL_POLICY.timeoutMs);
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let response: Response | undefined;
        // Race every await so even a boundary ignoring cancellation cannot return a late result.
        const bounded = <T>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
            const onAbort = () => reject(new AliyunRetrievalError(abortCode));
            if (controller.signal.aborted) onAbort();
            else controller.signal.addEventListener('abort', onAbort, { once: true });
            promise.then(v => { controller.signal.removeEventListener('abort', onAbort); resolve(v); },
                () => { controller.signal.removeEventListener('abort', onAbort); reject(new AliyunRetrievalError('ALIYUN_TRANSPORT_FAILED')); });
        });
        try {
            const pending = this.#transport.request(endpoint, {
                method: 'POST', redirect: 'error', headers: {
                    'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + key,
                }, body: serialized, signal: controller.signal,
            });
            // Clean up a late response from a non-cooperating injected transport.
            void pending.then(r => { if (controller.signal.aborted) void r.body?.cancel().catch(() => undefined); }, () => undefined);
            response = await bounded(pending);
            if (controller.signal.aborted) fail(abortCode);
            if (response.status === 429) fail('ALIYUN_RATE_LIMITED');
            if (response.status === 401 || response.status === 403) fail('ALIYUN_AUTH_REJECTED');
            if (response.status !== 200 || response.redirected) fail('ALIYUN_UPSTREAM_REJECTED');
            if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('content-type') ?? ''))
                fail('ALIYUN_RESPONSE_INVALID');
            // Fetch already decodes these single content codings, but retains the
            // encoded Content-Length. Reject unknown/stacked codings explicitly.
            const encodingHeader = response.headers.get('content-encoding');
            const encoding = encodingHeader === null ? 'identity' : encodingHeader.trim().toLowerCase();
            if (!['identity', 'gzip', 'deflate', 'br'].includes(encoding)) fail('ALIYUN_RESPONSE_INVALID');
            const length = response.headers.get('content-length');
            if (length !== null && (!/^\d{1,10}$/.test(length) || Number(length) > ALIYUN_RETRIEVAL_POLICY.maxResponseBytes))
                fail('ALIYUN_RESPONSE_TOO_LARGE');
            reader = response.body?.getReader();
            if (!reader) fail('ALIYUN_RESPONSE_INVALID');
            const parts: Uint8Array[] = [];
            let size = 0;
            for (;;) {
                const part = await bounded(reader.read());
                if (controller.signal.aborted) fail(abortCode);
                if (part.done) break;
                size += part.value.byteLength;
                if (size > ALIYUN_RETRIEVAL_POLICY.maxResponseBytes) fail('ALIYUN_RESPONSE_TOO_LARGE');
                parts.push(part.value);
            }
            // Always cap decoded bytes above; cap encoded length declarations before
            // reading. Only identity's declared bytes can be compared to decoded size.
            // Raw compressed bytes/CRC/trailers are not exposed by this Response API;
            // observable HTTP/decoder failures still reject through bounded(reader.read()).
            if (!size || (encoding === 'identity' && length !== null && Number(length) !== size))
                fail('ALIYUN_RESPONSE_INVALID');
            try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
            catch { fail('ALIYUN_RESPONSE_INVALID'); }
        }
        catch (error) {
            if (controller.signal.aborted) fail(abortCode);
            if (error instanceof AliyunRetrievalError) throw error;
            fail('ALIYUN_TRANSPORT_FAILED');
        }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            controller.abort();
            // Do not let a broken stream's cancellation stall settlement or expose its errors.
            if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
            else if (response) void response.body?.cancel().catch(() => undefined);
        }
    }
}
