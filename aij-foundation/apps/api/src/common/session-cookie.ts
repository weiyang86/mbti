// Shared strict parser: ambiguous duplicate cookies never authenticate.
export function readSessionCookie(header: string | undefined, name: string): string | null {
  if (!header || header.length > 16384) return null;
  const values = header.split(";").map(pair => pair.trim()).filter(pair => pair.slice(0, pair.indexOf("=")) === name);
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return value.length <= 4096 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) ? value : null;
}
