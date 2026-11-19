import { BadRequestException } from '@nestjs/common';
import type { AiCenterModel, AiCenterProvider } from '@aij/contracts';

// Protocol evidence checked 2026-11-05; exact sources and scope in AF-150-candidate.md.
// This is a protocol policy, not a vendor executor, model discovery service or price list.
export const ALIYUN_TEXT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DEEPSEEK_TEXT_BASE = 'https://api.deepseek.com/v1';
export const OPENAI_BASE = 'https://api.openai.com/v1';
export const AI_VENDOR_BASES = { openai: OPENAI_BASE, deepseek: DEEPSEEK_TEXT_BASE, aliyun: ALIYUN_TEXT_BASE } as const;
type TextProfile = Readonly<{
    vendor: 'deepseek' | 'aliyun';
    tokenParameter: AiCenterModel['tokenParameter'];
    formats: readonly ['text', 'json'];
    requestFields: Readonly<Record<string, unknown>>;
}>;
const deepseek: TextProfile = { vendor: 'deepseek', tokenParameter: 'max_tokens', formats: ['text', 'json'], requestFields: { thinking: { type: 'disabled' } } };
const aliyun: TextProfile = { vendor: 'aliyun', tokenParameter: 'max_completion_tokens', formats: ['text', 'json'], requestFields: { enable_thinking: false } };

/** Recognize exact first-party bases even under a compatible alias. No host wildcard. */
export function aiTextProfile(provider: Pick<AiCenterProvider, 'vendor' | 'baseUrl'>): TextProfile | undefined {
    if (provider.vendor !== 'compatible' && provider.baseUrl !== AI_VENDOR_BASES[provider.vendor])
        throw new BadRequestException('AI vendor base URL mismatch');
    if (provider.vendor === 'deepseek' || new URL(provider.baseUrl).hostname === 'api.deepseek.com') return deepseek;
    if (provider.vendor === 'aliyun' || provider.baseUrl === ALIYUN_TEXT_BASE) return aliyun;
    return undefined;
}

/** TEXT + JSON final answer only. Alibaba starts with this verified synchronous model. */
export function validateAiVendorModel(provider: AiCenterProvider, model: AiCenterModel) {
    const profile = aiTextProfile(provider);
    if (profile && (model.capability !== 'text' || model.tokenParameter !== profile.tokenParameter ||
        (profile.vendor === 'aliyun' && model.upstreamModel !== 'qwen3.8-max')))
        throw new BadRequestException('Unsupported AI vendor model protocol');
    return profile;
}

export function aiVendorTextFields(provider: AiCenterProvider, model: AiCenterModel, outputFormat: 'text' | 'json') {
    const profile = validateAiVendorModel(provider, model);
    // OpenAI/other compatible requests retain their existing body, including token parameter.
    if (!profile) return {};
    if (!profile.formats.includes(outputFormat)) throw new BadRequestException('Unsupported AI output format');
    return { ...profile.requestFields, ...(outputFormat === 'json' ? { response_format: { type: 'json_object' } } : {}) };
}
