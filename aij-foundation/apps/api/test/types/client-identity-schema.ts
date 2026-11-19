import type { Prisma, PrismaClient } from '@prisma/client';

// Generated public types only; no client instance, account, token or database write.
export const member: Prisma.MemberUserCreateInput = {
  nickname: 'AF007 synthetic type fixture',
  authSessions: { create: { namespace: 'type-fixture:customer', deviceHash: 'hash-only-fixture', deviceSummary: 'local fixture', ipHash: 'hash-only-fixture', expiresAt: new Date(0) } },
  authTokens: { create: { purpose: 'type-fixture', tokenHash: 'hash-only-fixture', expiresAt: new Date(0), consumedAt: null, revokedAt: null } },
  consentRecords: { create: { namespace: 'type-fixture:customer', consentType: 'type-fixture', granted: false, textVersion: 'type-fixture-v1', textDigest: 'hash-only-fixture', source: 'offline-typecheck' } },
};
export const revoke: Prisma.ClientAuthSessionUpdateInput = { status: 'revoked', revokedAt: new Date(0), revokeReason: 'type-fixture' };
export const consume: Prisma.ClientAuthOneTimeTokenUpdateInput = { consumedAt: new Date(0) };
export const rateKey: Prisma.ClientAuthRateBucketWhereUniqueInput = { scope_keyHash: { scope: 'type-fixture', keyHash: 'hash-only-fixture' } };

// Customer tenancy belongs to MemberUser but remains separate from administrator roles.
export const workspaceMembershipField: keyof Prisma.MemberUserCreateInput = 'workspaceMemberships';
// @ts-expect-error Client identity must not inherit administrator role assignments.
export const adminRole: keyof Prisma.MemberUserCreateInput = 'userRoles';
// @ts-expect-error No account export/deletion model was migrated.
export const lifecycle: keyof PrismaClient = 'clientAccountLifecycleRequest';
// @ts-expect-error Consent must explicitly record grant or denial.
export const missingConsent: Prisma.ClientConsentRecordCreateWithoutMemberInput = { consentType: 'type-fixture', namespace: 'aij-foundation:test', textVersion: 'v1', textDigest: 'hash-only-fixture', source: 'type-fixture' };
// @ts-expect-error A token requires its expiration timestamp.
export const missingExpiry: Prisma.ClientAuthOneTimeTokenCreateWithoutMemberInput = { purpose: 'type-fixture', tokenHash: 'hash-only-fixture' };
