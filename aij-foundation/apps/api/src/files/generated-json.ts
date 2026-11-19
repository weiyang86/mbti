/** Bounded file-format validation. This core utility does not execute AI or scripts. */
export function generatedJsonValid(bytes: Buffer): boolean {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 65536) return false;
    const raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const value: unknown = JSON.parse(raw);
    const stack: { keys: Set<string> | null; key: boolean }[] = [];
    for (const token of raw.match(/"(?:\\.|[^"\\])*"|[{}[\]:,]/g) ?? []) {
      const top = stack.at(-1);
      if (token === '{' || token === '[') {
        stack.push({ keys: token === '{' ? new Set() : null, key: true });
        if (stack.length > 17) return false;
      } else if (token === '}' || token === ']') stack.pop();
      else if (token === ':') { if (top) top.key = false; }
      else if (token === ',') { if (top) top.key = true; }
      else if (top?.keys && top.key) {
        const key: string = JSON.parse(token);
        if (top.keys.has(key)) return false;
        top.keys.add(key);
      }
    }
    let entries = 0;
    const text = (s: string) => Buffer.from(s).toString('utf8') === s;
    const walk = (v: unknown, depth: number): boolean => {
      if (depth > 16) return false;
      if (v === null || typeof v === 'boolean') return true;
      if (typeof v === 'number') return Number.isFinite(v);
      if (typeof v === 'string') return text(v);
      if (!v || typeof v !== 'object') return false;
      const keys = Object.keys(v);
      entries += keys.length;
      if (entries > 2048) return false;
      return keys.every(k => text(k) && !['__proto__', 'constructor', 'prototype'].includes(k) &&
        walk((v as Record<string, unknown>)[k], depth + 1));
    };
    return walk(value, 0);
  } catch { return false; }
}
