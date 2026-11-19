export const DICTIONARY_PERMISSION: "admin.dict.manage";
export const DICTIONARY_DEFINITION: Readonly<{ code: string; name: string; action: string; path: string }>;
export const DICTIONARY_READ_PERMISSION: "admin.dict.read";
export const DICTIONARY_READ_DEFINITION: Readonly<{ code: string; name: string; action: string; path: string }>;
export function dictionaryEffectivePermissions(granted: readonly string[], activeCodes: readonly string[]): string[];
