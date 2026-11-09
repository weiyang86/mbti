// F00 M06: directed adaptation of source secret-ref.ts; no legacy arbitrary env names.
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
export type SecretProvider = "env" | "local";
export type ParsedSecretRef = Readonly<{ ref: string; provider: SecretProvider; name: string }>;
export type SecretIdentity = Readonly<{ projectId: string; environment: string; namespace: string; repositoryRoot: string }>;
export function prefixes(identity: SecretIdentity) {
  return { env: "env://AIJ_SECRET_" + identity.projectId.toUpperCase().replace(/-/g, "_") + "_" + identity.environment.toUpperCase() + "_", local: "local://" + identity.projectId + "/" + identity.environment + "/" };
}
// Syntax validation is also reused by configuration. It does not access a provider.
export function parseSecretRef(input: string): ParsedSecretRef {
  if (/^env:\/\/AIJ_[A-Z0-9_]{3,127}$/.test(input)) return { ref: input, provider: "env", name: input.slice(6) };
  const match = /^local:\/\/([a-z][a-z0-9-]{1,62})\/(development|test|production)\/([A-Z][A-Z0-9_]{2,63})$/.exec(input);
  if (match) return { ref: input, provider: "local", name: match[3] };
  throw new BadRequestException("Invalid secret reference");
}
export function assertOwnedRef(input: string, identity: SecretIdentity): ParsedSecretRef {
  const parsed = parseSecretRef(input), prefix = prefixes(identity)[parsed.provider];
  if (!input.startsWith(prefix) || !/^[A-Z][A-Z0-9_]{2,63}$/.test(input.slice(prefix.length))) throw new ForbiddenException("Secret reference namespace denied");
  return parsed;
}
// Server-side dependency port only. No HTTP method returns its resolved result.
export abstract class SecretRefPort {
  abstract resolveTrusted(ref: string): Promise<string>;
  abstract resolveTrustedForPlugin(pluginCode: string, ref: string): Promise<string>;
  /** Returns only whether an owned active reference is backed by a value; never returns that value. */
  abstract configuredTrusted(tx: Prisma.TransactionClient, ref: string): Promise<boolean>;
}
