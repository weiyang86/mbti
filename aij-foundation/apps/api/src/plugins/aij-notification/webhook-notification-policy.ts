import { isIP } from "node:net";

export const WEBHOOK_PAYLOAD_LIMIT = 128 * 1024;
export const WEBHOOK_RESPONSE_LIMIT = 8 * 1024;
export const WEBHOOK_DEADLINE_MS = 10_000;
export const WEBHOOK_UNKNOWN = "WEBHOOK_OUTCOME_UNKNOWN_MANUAL_RECONCILIATION_REQUIRED";
export const WEBHOOK_DENIED = "WEBHOOK_ADMISSION_DENIED";

export function webhookError(code: typeof WEBHOOK_UNKNOWN | typeof WEBHOOK_DENIED): Error {
  return Object.assign(new Error(code), { runtimeRetryable: false });
}

/** Exact canonical endpoints are trusted server configuration, never recipient supplied policy. */
export class WebhookNotificationPolicy {
  private readonly approved: ReadonlySet<string>;
  constructor(endpoints: readonly string[]) {
    if (!Array.isArray(endpoints) || endpoints.length < 1 || endpoints.length > 8 || new Set(endpoints).size !== endpoints.length) {
      throw webhookError(WEBHOOK_DENIED);
    }
    this.approved = new Set(endpoints.map(endpoint => canonicalWebhookEndpoint(endpoint).href));
  }
  endpoint(recipientAddress: unknown): URL {
    // Membership must precede parsing, DNS, secret resolution and transport.
    if (typeof recipientAddress !== "string" || !this.approved.has(recipientAddress)) throw webhookError(WEBHOOK_DENIED);
    return canonicalWebhookEndpoint(recipientAddress);
  }
  static fromEnvironment(env: NodeJS.ProcessEnv): WebhookNotificationPolicy | null {
    if (env.AIJ_NOTIFICATION_WEBHOOK_ENABLED !== "true") return null;
    try {
      return new WebhookNotificationPolicy(JSON.parse(env.AIJ_NOTIFICATION_WEBHOOK_ENDPOINTS || "null"));
    } catch { throw webhookError(WEBHOOK_DENIED); }
  }
}

export function canonicalWebhookEndpoint(input: string): URL {
  try {
    const url = new URL(input);
    if (typeof input !== "string" || input.length > 500 || url.href !== input || url.protocol !== "https:" ||
        url.username || url.password || input.includes("?") || input.includes("#") || url.search || url.hash || url.port || isIP(url.hostname) ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname) ||
        /(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|corp|test|invalid|example|onion|arpa)$/.test(url.hostname) ||
        Array.from(input).some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === "\\") || /%(?![a-fA-F0-9]{2})/.test(input)) throw new Error();
    return url;
  } catch { throw webhookError(WEBHOOK_DENIED); }
}

/** Conservative global-unicast policy. Mixed public/private answers fail as a set. */
export function publicWebhookAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 ||
      a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
      a === 192 && (b === 0 && (c === 0 || c === 2) || b === 88 && c === 99 || b === 31 && c === 196 || b === 52 && c === 193 || b === 175 && c === 48 || b === 168) ||
      a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) !== 6 || address.includes("%") || address.includes(".")) return false;
  const halves = address.toLowerCase().split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  const [a, b, c] = groups.map(group => parseInt(group, 16));
  // Derived from IANA IPv6 Global Unicast allocations checked 2026-11-05
  // (registry revision 2025-10-10). Unlisted/reserved ranges stay denied until
  // an intentional policy update; 2000::/3 alone includes returned 6bone space.
  const allocated = a === 0x2001 && (b >= 0x0200 && b <= 0x0fff || b >= 0x1200 && b <= 0x5fff && !(b >= 0x4e00 && b <= 0x4fff) || b >= 0x8000 && b <= 0xbfff) ||
    a === 0x2003 && b < 0x4000 || a >= 0x2400 && a <= 0x241f || a >= 0x2600 && a <= 0x260f ||
    (a === 0x2610 || a === 0x2620) && b < 0x0200 || a >= 0x2630 && a <= 0x263f ||
    a >= 0x2800 && a <= 0x280f || a >= 0x2a00 && a <= 0x2a1f || a >= 0x2c00 && a <= 0x2c0f;
  // 2001::/23 includes transition, benchmarking and protocol-assignment ranges.
  return allocated && !(a === 0x2001 && (b < 0x0200 || b === 0x0db8)) &&
    a !== 0x2002 && !(a === 0x2620 && b === 0x004f && c === 0x8000) && !(a === 0x3fff && b <= 0x0fff);
}
