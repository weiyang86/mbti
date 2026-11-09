import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { IsDefined, IsInt, IsObject, Max, Min, ValidateBy } from 'class-validator';
import { externalProvider } from './external-services.catalog';
export function invalidExternalInput(): never { throw new BadRequestException('Invalid external service draft'); }
export function strictRecord(v: unknown, keys?: readonly string[]): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null, SaveExternalServiceDto.prototype].includes(Object.getPrototypeOf(v)) ||
        Reflect.ownKeys(v).some(k => typeof k !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(k) || (keys && !keys.includes(k)) || !Object.getOwnPropertyDescriptor(v, k)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(v, k)!, 'value')))
        invalidExternalInput();
    return v as Record<string, unknown>;
}
function dictionary(v: unknown, refs = false) {
    const b = strictRecord(v);
    if (Object.keys(b).length > 16)
        invalidExternalInput();
    for (const [k, value] of Object.entries(b))
        if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(k) || !(refs && value === null) && (typeof value !== 'string' || value.length > 512 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)))
            invalidExternalInput();
    return b;
}
export class SaveExternalServiceDto {
    @IsDefined()
    @IsInt()
    @Min(0)
    @Max(2147483646)
    expectedVersion!: number;
    @IsDefined()
    @IsObject()
    @ValidateBy({ name: 'safeFields', validator: { validate: v => { try {
                dictionary(v);
                return true;
            }
            catch {
                return false;
            } }, defaultMessage: () => 'Invalid external service draft' } })
    fields!: Record<string, string>;
    // IsOptional would accept null, so the custom validator handles absence explicitly.
    @ValidateBy({ name: 'safeRefs', validator: { validate: v => { try {
                if (v !== undefined)
                    dictionary(v, true);
                return true;
            }
            catch {
                return false;
            } }, defaultMessage: () => 'Invalid external service draft' } })
    credentialRefs?: Record<string, string | null>;
}
export function parseExternalSave(raw: unknown): SaveExternalServiceDto {
    const b = strictRecord(raw, ['expectedVersion', 'fields', 'credentialRefs']);
    if (!Number.isSafeInteger(b.expectedVersion) || (b.expectedVersion as number) < 0 || (b.expectedVersion as number) > 2147483646 || !Object.hasOwn(b, 'fields'))
        invalidExternalInput();
    dictionary(b.fields);
    if (Object.hasOwn(b, 'credentialRefs'))
        dictionary(b.credentialRefs, true);
    if (Buffer.byteLength(JSON.stringify(b), 'utf8') > 8192)
        invalidExternalInput();
    return { expectedVersion: b.expectedVersion as number, fields: { ...b.fields as Record<string, string> }, ...(b.credentialRefs === undefined ? {} : { credentialRefs: { ...b.credentialRefs as Record<string, string | null> } }) };
}
export function validateProviderDraft(code: string, raw: unknown): SaveExternalServiceDto {
    const d = parseExternalSave(raw), p = externalProvider(code);
    for (const [key, value] of Object.entries(d.fields)) {
        const f = p.fields.find(f => f.key === key);
        if (!f || value.length > f.maxLength || value !== value.trim())
            invalidExternalInput();
        if (!value)
            continue;
        if (f.kind === 'url') {
            let u: URL;
            try {
                u = new URL(value);
            }
            catch {
                invalidExternalInput();
            }
            if (u!.protocol !== 'https:' || u!.username || u!.password || u!.search || u!.hash)
                invalidExternalInput();
            if (key === 'downloadOrigin' && u!.origin !== value)
                invalidExternalInput();
        }
        if (f.kind === 'number' && (!/^[1-9][0-9]{0,4}$/.test(value) || Number(value) > 65535))
            invalidExternalInput();
        if (f.kind === 'select' && !f.options?.some(o => o.value === value))
            invalidExternalInput();
        if (key === 'from' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value))
            invalidExternalInput();
        if (key === 'host' && !/^(?=.{1,253}$)[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(value))
            invalidExternalInput();
    }
    if (Object.keys(d.credentialRefs ?? {}).some(k => !p.credentials.some(c => c.key === k)))
        invalidExternalInput();
    return d;
}
@Injectable()
export class ExternalServicesBodyPipe implements PipeTransform {
    transform(raw: unknown) { return parseExternalSave(raw); }
}
