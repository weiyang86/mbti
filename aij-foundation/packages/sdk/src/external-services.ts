import type { ClientApi } from './index.js';
export type ExternalServiceField = {
    key: string;
    label: string;
    kind: 'text' | 'url' | 'number' | 'select';
    required: boolean;
    maxLength: number;
    options?: {
        value: string;
        label: string;
    }[];
};
export type ExternalServiceProvider = {
    code: string;
    label: string;
    category: 'model' | 'storage' | 'payment' | 'notification';
    fields: ExternalServiceField[];
    credentials: {
        key: string;
        label: string;
        required: boolean;
    }[];
};
export type ExternalServiceCatalog = {
    schemaVersion: 1;
    providers: ExternalServiceProvider[];
};
export type ExternalServiceSave = {
    expectedVersion: number;
    fields: Record<string, string>;
    credentialRefs?: Record<string, string | null>;
};
export type ExternalServiceView = {
    providerCode: string;
    version: number;
    fields: Record<string, string>;
    credentialStates: Record<string, boolean>;
    missingFields: string[];
    configurationStatus: 'not_configured' | 'draft' | 'credentials_ready';
    runtimeEnabled: false;
    externalVerification: 'not_run';
};
const codes = ['deepseek', 'aliyun', 'qiniu', 'wechat-pay', 'alipay', 'douyin-pay', 'email', 'sms', 'wechat-official', 'wechat-miniapp', 'wecom', 'dingtalk', 'feishu', 'webhook'];
function invalid(): never { throw new TypeError('Invalid external service data'); }
function record(v: unknown, allowed?: readonly string[], required: readonly string[] = []): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Reflect.ownKeys(v).some(k => typeof k !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(k) || (allowed && !allowed.includes(k)) || !Object.getOwnPropertyDescriptor(v, k)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(v, k)!, 'value')) || required.some(k => !Object.hasOwn(v, k)))
        invalid();
    return v as Record<string, unknown>;
}
function text(v: unknown, max = 512): string { if (typeof v !== 'string' || v.length > max || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(v) || v !== v.trim())
    invalid(); return v; }
function key(v: unknown): string { const s = text(v, 64); if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(s))
    invalid(); return s; }
function code(v: unknown): string { if (typeof v !== 'string' || !codes.includes(v))
    invalid(); return v; }
function version(v: unknown): number { if (!Number.isSafeInteger(v) || (v as number) < 0 || (v as number) > 2147483647)
    invalid(); return v as number; }
function fields(v: unknown): Record<string, string> { const b = record(v); if (Object.keys(b).length > 16)
    invalid(); const r: Record<string, string> = {}; for (const [k, v] of Object.entries(b))
    r[key(k)] = text(v); return r; }
function bounded<T>(v: unknown, max: number, parse: (v: unknown) => T): T[] { if (!Array.isArray(v) || v.length > max)
    invalid(); return v.map(parse); }
function unique(v: string[]) { if (new Set(v).size !== v.length)
    invalid(); return v; }
export function parseExternalServiceCatalog(raw: unknown): ExternalServiceCatalog {
    const b = record(raw, ['schemaVersion', 'providers'], ['schemaVersion', 'providers']);
    if (b.schemaVersion !== 1)
        invalid();
    const providers = bounded(b.providers, 14, v => {
        const p = record(v, ['code', 'label', 'category', 'fields', 'credentials'], ['code', 'label', 'category', 'fields', 'credentials']), c = code(p.code);
        const category = c === 'deepseek' || c === 'aliyun' ? 'model' : c === 'qiniu' ? 'storage' : c.endsWith('-pay') || c === 'alipay' ? 'payment' : 'notification';
        if (p.category !== category)
            invalid();
        const fs = bounded(p.fields, 16, v => {
            const f = record(v, ['key', 'label', 'kind', 'required', 'maxLength', 'options'], ['key', 'label', 'kind', 'required', 'maxLength']);
            if (!['text', 'url', 'number', 'select'].includes(f.kind as string) || typeof f.required !== 'boolean' || !Number.isInteger(f.maxLength) || (f.maxLength as number) < 1 || (f.maxLength as number) > 512)
                invalid();
            const opts = f.options === undefined ? undefined : bounded(f.options, 32, v => { const o = record(v, ['value', 'label'], ['value', 'label']); return { value: text(o.value, 128), label: text(o.label, 128) }; });
            if (f.kind === 'select' && !opts?.length || f.kind !== 'select' && opts !== undefined)
                invalid();
            if (opts)
                unique(opts.map(o => o.value));
            return { key: key(f.key), label: text(f.label, 128), kind: f.kind as ExternalServiceField['kind'], required: f.required as boolean, maxLength: f.maxLength as number, ...(opts ? { options: opts } : {}) };
        });
        const cs = bounded(p.credentials, 16, v => { const c = record(v, ['key', 'label', 'required'], ['key', 'label', 'required']); if (typeof c.required !== 'boolean')
            invalid(); return { key: key(c.key), label: text(c.label, 128), required: c.required as boolean }; });
        unique([...fs.map(f => f.key), ...cs.map(c => c.key)]);
        return { code: c, label: text(p.label, 128), category, fields: fs, credentials: cs } as ExternalServiceProvider;
    });
    if (providers.length !== 14)
        invalid();
    unique(providers.map(p => p.code));
    return { schemaVersion: 1, providers };
}
export function parseExternalServiceView(raw: unknown): ExternalServiceView {
    const ks = ['providerCode', 'version', 'fields', 'credentialStates', 'missingFields', 'configurationStatus', 'runtimeEnabled', 'externalVerification'];
    const b = record(raw, ks, ks), c = code(b.providerCode), n = version(b.version), fs = fields(b.fields), states = record(b.credentialStates), cs: Record<string, boolean> = {};
    if (Object.keys(states).length > 16)
        invalid();
    for (const [k, v] of Object.entries(states)) {
        if (typeof v !== 'boolean')
            invalid();
        cs[key(k)] = v;
    }
    const missing = unique(bounded(b.missingFields, 32, key));
    if (!['not_configured', 'draft', 'credentials_ready'].includes(b.configurationStatus as string) || b.runtimeEnabled !== false || b.externalVerification !== 'not_run' || n === 0 && (b.configurationStatus !== 'not_configured' || Object.keys(fs).length !== 0 || Object.values(cs).some(Boolean)) || n > 0 && b.configurationStatus === 'not_configured' || (b.configurationStatus === 'credentials_ready') !== (n > 0 && missing.length === 0))
        invalid();
    if (missing.some(k => Object.hasOwn(cs, k) ? cs[k] : Boolean(fs[k])))
        invalid();
    return { providerCode: c, version: n, fields: fs, credentialStates: cs, missingFields: missing, configurationStatus: b.configurationStatus as ExternalServiceView['configurationStatus'], runtimeEnabled: false, externalVerification: 'not_run' };
}
function saveDto(raw: unknown): ExternalServiceSave {
    const b = record(raw, ['expectedVersion', 'fields', 'credentialRefs'], ['expectedVersion', 'fields']), n = version(b.expectedVersion);
    if (n > 2147483646)
        invalid();
    const fs = fields(b.fields), refs: Record<string, string | null> = {};
    if (Object.hasOwn(b, 'credentialRefs')) {
        const rs = record(b.credentialRefs);
        if (Object.keys(rs).length > 16)
            invalid();
        for (const [k, v] of Object.entries(rs)) {
            if (v === null)
                refs[key(k)] = null;
            else {
                const s = text(v);
                if (!/^env:\/\/AIJ_SECRET_[A-Z0-9_]{3,127}$/.test(s) && !/^local:\/\/[a-z][a-z0-9-]{1,62}\/(development|test|production)\/[A-Z][A-Z0-9_]{2,63}$/.test(s))
                    invalid();
                refs[key(k)] = s;
            }
        }
    }
    const dto = { expectedVersion: n, fields: fs, ...(Object.hasOwn(b, 'credentialRefs') ? { credentialRefs: refs } : {}) };
    if (new TextEncoder().encode(JSON.stringify(dto)).length > 8192)
        invalid();
    return dto;
}
class ExternalServiceInputFailure extends TypeError {
    readonly status = 400;
    constructor() { super('Invalid external service request'); }
}
function input<T>(parse: () => T): T { try {
    return parse();
}
catch {
    throw new ExternalServiceInputFailure();
} }
/** Explicit calls only: no persistence, value resolution, retries or network other than the supplied app API. */
export function createExternalServicesApi(api: ClientApi) {
    const base = '/admin/external-services';
    const request = (path: string, method: string, signal?: AbortSignal, body?: unknown) => api<unknown>(path, { method, signal, cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const path = (c: string) => base + '/' + input(() => code(c));
    const view = (raw: unknown, c: string) => { const v = parseExternalServiceView(raw); if (v.providerCode !== c)
        invalid(); return v; };
    return {
        async catalog(signal?: AbortSignal): Promise<ExternalServiceCatalog> { return parseExternalServiceCatalog(await request(base + '/catalog', 'GET', signal)); },
        async list(signal?: AbortSignal): Promise<{
            projectId: string;
            items: ExternalServiceView[];
        }> { const b = record(await request(base, 'GET', signal), ['projectId', 'items'], ['projectId', 'items']); const id = text(b.projectId, 128); if (!/^[A-Za-z0-9_-]{1,128}$/.test(id))
            invalid(); const items = bounded(b.items, 14, parseExternalServiceView); if (items.length !== 14)
            invalid(); unique(items.map(i => i.providerCode)); return { projectId: id, items }; },
        async get(providerCode: string, signal?: AbortSignal): Promise<ExternalServiceView> { return view(await request(path(providerCode), 'GET', signal), providerCode); },
        async save(providerCode: string, dto: ExternalServiceSave, signal?: AbortSignal): Promise<ExternalServiceView> { const p = path(providerCode), d = input(() => saveDto(dto)), v = view(await request(p, 'PUT', signal, d), providerCode); if (![d.expectedVersion, d.expectedVersion + 1].includes(v.version) || JSON.stringify(Object.entries(v.fields).sort()) !== JSON.stringify(Object.entries(d.fields).sort()))
            invalid(); return v; }
    };
}
export type ExternalServicesApi = ReturnType<typeof createExternalServicesApi>;
