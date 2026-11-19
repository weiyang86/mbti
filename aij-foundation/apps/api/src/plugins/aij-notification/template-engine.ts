import { BadRequestException } from "@nestjs/common";

const VARIABLE = /{{\s*([A-Za-z][A-Za-z0-9_.]*)\s*}}/g;
const FORBIDDEN_VARIABLE = /(secret|password|passwd|token|api.?key|private.?key|credential)/i;
const DANGEROUS_TEMPLATE = /{{{|}}}|<\s*script|javascript\s*:|on[a-z]+\s*=/i;
const SENSITIVE_VALUE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._-]+|\bsk-[A-Za-z0-9._-]{8,}|(?:api.?key|token|secret|password)\s*[:=]/i;

/** Validate and render declarative notification content; templates cannot read secrets or run code. */
export function renderNotificationTemplate(template: string, variables: Record<string, unknown>) {
  validateNotificationTemplate(template);
  const used = new Set<string>();
  const rendered = template.replace(VARIABLE, (_match, path: string) => {
    if (FORBIDDEN_VARIABLE.test(path)) throw new BadRequestException("Notification template cannot access credentials");
    used.add(path);
    const value = readPath(variables, path);
    if (value === undefined || value === null) throw new BadRequestException("Notification template variable is unavailable");
    if (!["string", "number", "boolean"].includes(typeof value)) throw new BadRequestException("Notification template variables must be scalar");
    const text = String(value);
    if (SENSITIVE_VALUE.test(text)) throw new BadRequestException("Notification content contains sensitive data");
    return escapeHtml(text);
  });
  if (/{{|}}/.test(rendered)) throw new BadRequestException("Notification template syntax is invalid");
  return { rendered, variables: [...used] };
}

export function validateNotificationTemplate(template: string): void {
  if (DANGEROUS_TEMPLATE.test(template)) throw new BadRequestException("Notification template syntax is unsafe");
  const stripped = template.replace(VARIABLE, (_match, path: string) => {
    if (FORBIDDEN_VARIABLE.test(path)) throw new BadRequestException("Notification template cannot access credentials");
    return "";
  });
  if (/{{|}}/.test(stripped)) throw new BadRequestException("Notification template syntax is invalid");
}

function readPath(input: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, input);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
