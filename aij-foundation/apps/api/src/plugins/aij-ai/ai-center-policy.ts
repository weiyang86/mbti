import { BadRequestException } from '@nestjs/common';
import type { AiCenterCatalog } from '@aij/contracts';
import { parseSecretRef } from '../../secret-center/secret-ref';
import { AI_VENDOR_BASES, aiTextProfile, validateAiVendorModel } from './ai-vendor-profiles';
export const AI_CENTER_CONFIG_KEY = 'ai.center.catalog';
export const EMPTY_AI_CATALOG: AiCenterCatalog = { providers: [], models: [], skills: [], agents: [], monthlyBudgetNanos: '10000000000', workspaceMonthlyBudgetNanos: '1000000000' };
const code = /^[a-z][a-z0-9-]{1,62}$/;
function reject(): never { throw new BadRequestException('Invalid AI center configuration'); }
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : reject();
const fields = (v: Record<string, unknown>, keys: string[]) => { if (Object.keys(v).sort().join() !== keys.sort().join())
    reject(); };
const string = (v: unknown, max = 8000) => { if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes(String.fromCharCode(0)))
    reject(); };
const integer = (v: unknown, max: number) => { if (!Number.isSafeInteger(v) || (v as number) < 1 || (v as number) > max)
    reject(); };
const bool = (v: unknown) => { if (typeof v !== 'boolean')
    reject(); };
const money = (v: unknown) => { if (typeof v !== 'string' || !/^[1-9][0-9]{0,14}$/.test(v))
    reject(); };
const inputFields = (v: unknown) => { if (!Array.isArray(v) || v.length > 20 || new Set(v).size !== v.length || v.some(x => typeof x !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(x) || ['__proto__', 'constructor', 'prototype'].includes(x)))
    reject(); };
const list = (v: unknown, keys: string[]) => {
    if (!Array.isArray(v) || v.length > 100)
        reject();
    const rows = (v as unknown[]).map(record);
    const seen = new Set();
    for (const row of rows) {
        fields(row, keys);
        if (typeof row.code !== 'string' || !code.test(row.code) || seen.has(row.code))
            reject();
        seen.add(row.code);
        string(row.name, 100);
        bool(row.enabled);
        integer(row.revision, 2147483647);
    }
    return rows;
};
/** URLs must match a server-owned exact HTTPS base URL, never a user-controlled endpoint. */
export function approvedAiBaseUrl(raw: string, extra: readonly string[] = []) {
    const allow = [...Object.values(AI_VENDOR_BASES), ...extra];
    let u: URL;
    try {
        u = new URL(raw);
    }
    catch {
        return reject();
    }
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || !allow.includes(raw) || raw.endsWith('/'))
        reject();
    return raw;
}
export function validateAiCatalog(value: unknown, approvedBases: readonly string[] = []): AiCenterCatalog {
    const c = record(value);
    fields(c, ['providers', 'models', 'skills', 'agents', 'monthlyBudgetNanos', 'workspaceMonthlyBudgetNanos']);
    money(c.monthlyBudgetNanos);
    money(c.workspaceMonthlyBudgetNanos);
    if (BigInt(c.workspaceMonthlyBudgetNanos as string) > BigInt(c.monthlyBudgetNanos as string))
        reject();
    const providers = list(c.providers, ['code', 'name', 'vendor', 'baseUrl', 'credentialRef', 'enabled', 'liveEnabled', 'revision']);
    for (const p of providers) {
        if (!['openai', 'deepseek', 'aliyun', 'compatible'].includes(p.vendor as string))
            reject();
        string(p.baseUrl, 300);
        approvedAiBaseUrl(p.baseUrl as string, approvedBases);
        parseSecretRef(p.credentialRef as string);
        bool(p.liveEnabled);
        aiTextProfile(p as unknown as AiCenterCatalog['providers'][number]);
    }
    const models = list(c.models, ['code', 'name', 'providerCode', 'upstreamModel', 'capability', 'enabled', 'contextTokens', 'maxOutputTokens', 'tokenParameter', 'inputNanosPerMillion', 'outputNanosPerMillion', 'imageNanos', 'imageSize', 'imageQuality', 'imageBase64Format', 'revision']);
    for (const m of models) {
        const p = providers.find(p => p.code === m.providerCode);
        if (!p || !['text', 'image'].includes(m.capability as string))
            reject();
        string(m.upstreamModel, 128);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(m.upstreamModel as string))
            reject();
        integer(m.contextTokens, 2000000);
        integer(m.maxOutputTokens, 32768);
        if ((m.maxOutputTokens as number) >= (m.contextTokens as number))
            reject();
        if (!['max_tokens', 'max_completion_tokens'].includes(m.tokenParameter as string))
            reject();
        for (const k of ['inputNanosPerMillion', 'outputNanosPerMillion', 'imageNanos'])
            money(m[k]);
        if (!['1024x1024', '1024x1536', '1536x1024'].includes(m.imageSize as string) || !['auto', 'low', 'medium', 'high'].includes(m.imageQuality as string))
            reject();
        bool(m.imageBase64Format);
        validateAiVendorModel(p as unknown as AiCenterCatalog['providers'][number], m as unknown as AiCenterCatalog['models'][number]);
    }
    const skills = list(c.skills, ['code', 'name', 'instructions', 'enabled', 'revision']);
    for (const s of skills)
        string(s.instructions, 8000);
    const agents = list(c.agents, ['code', 'name', 'modelCode', 'skillCodes', 'instructions', 'inputFields', 'outputFormat', 'outputFields', 'enabled', 'published', 'revision']);
    for (const a of agents) {
        const m = models.find(m => m.code === a.modelCode);
        if (!m)
            reject();
        string(a.instructions, 8000);
        bool(a.published);
        inputFields(a.inputFields);
        if (!(a.inputFields as unknown[]).length)
            reject();
        inputFields(a.outputFields);
        if (!['text', 'json'].includes(a.outputFormat as string) || (a.outputFormat === 'json' && !(a.outputFields as unknown[]).length) || (m.capability === 'image' && a.outputFormat !== 'text'))
            reject();
        if (!Array.isArray(a.skillCodes) || a.skillCodes.length > 12 || new Set(a.skillCodes).size !== a.skillCodes.length || a.skillCodes.some(k => !skills.some(s => s.code === k)))
            reject();
        if (a.published && (!a.enabled || !m.enabled || !providers.find(p => p.code === m.providerCode)?.enabled || (a.skillCodes as string[]).some(k => !skills.find(s => s.code === k)?.enabled)))
            reject();
    }
    return value as AiCenterCatalog;
}
