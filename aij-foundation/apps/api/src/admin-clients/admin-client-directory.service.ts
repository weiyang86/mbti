import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { CLIENT_DIRECTORY_READ_PERMISSION, CLIENT_SESSION_REVOKE_PERMISSION } from "../../../../scripts/client-directory-policy.cjs";
import { AuthService } from "../auth/auth.service";
import type { AdminSessionClaims } from "../auth/auth.types";
import { ClientAuthService } from "../client-auth/client-auth.service";
import { ManagementAccessService } from "../rbac/management-access.service";
import { PermissionsService } from "../rbac/permissions.service";
import { PrismaService } from "../prisma/prisma.service";
import { AdminClientDirectoryQueryDto, AdminClientHistoryQueryDto } from "./admin-client-directory.dto";

type LatestConsent = { memberId: string; consentType: string; granted: boolean; textVersion: string; capturedAt: Date };
const memberSelect = { id: true, email: true, nickname: true, status: true, emailVerifiedAt: true, createdAt: true, lastLoginAt: true } as const;
const maskEmail = (value: string | null) => {
  if (!value) return null;
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return "[REDACTED]";
  const local = value.slice(0, at);
  return (local.length < 3 ? local[0] : local.slice(0, 2)) + "***@" + value.slice(at + 1);
};

@Injectable()
export class AdminClientDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ManagementAccessService,
    private readonly permissions: PermissionsService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly clientAuth: ClientAuthService
  ) {}

  private async ensureScopedMember(tx: Prisma.TransactionClient, memberId: string, namespace: string) {
    const purposes = [`client-email-verification:${namespace}`, `client-password-reset:${namespace}`];
    const member = await tx.memberUser.findFirst({ where: { id: memberId, deletedAt: null, OR: [
      { authSessions: { some: { namespace, deletedAt: null } } },
      { consentRecords: { some: { namespace, deletedAt: null } } },
      { authTokens: { some: { purpose: { in: purposes }, deletedAt: null } } }
    ] }, select: { id: true } });
    if (!member) throw new NotFoundException("Client not found");
  }

  list(query: AdminClientDirectoryQueryDto, operatorId: string) {
    const namespace = this.config.getOrThrow<string>("namespace");
    const verificationPurpose = "client-email-verification:" + namespace;
    const resetPurpose = "client-password-reset:" + namespace;
    const q = query.q?.trim();
    const filters: Prisma.MemberUserWhereInput[] = [];
    if (query.status) filters.push({ status: query.status });
    if (q) filters.push({ OR: [
      { nickname: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } }
    ] });
    const where: Prisma.MemberUserWhereInput = {
      deletedAt: null,
      AND: [
        { OR: [
          { authSessions: { some: { namespace, deletedAt: null } } },
          { authTokens: { some: { purpose: { in: [verificationPurpose, resetPurpose] }, deletedAt: null } } },
          { consentRecords: { some: { namespace, deletedAt: null } } }
        ] },
        ...filters
      ]
    };
    const page = query.page ?? 1, pageSize = query.pageSize ?? 20;
    return this.access.database(() => this.prisma.$transaction(async tx => {
      await this.permissions.authorizeInTransaction(tx, operatorId, [CLIENT_DIRECTORY_READ_PERMISSION]);
      const [members, total] = await Promise.all([
        tx.memberUser.findMany({ where, select: memberSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
        tx.memberUser.count({ where })
      ]);
      const ids = members.map(member => member.id);
      if (!ids.length) return { items: [], total, page, pageSize };
      const now = new Date();
      const [sessions, latestConsents] = await Promise.all([
        tx.clientAuthSession.groupBy({
          by: ["memberId"],
          where: { namespace, memberId: { in: ids }, status: "active", revokedAt: null, deletedAt: null, expiresAt: { gt: now } },
          _count: { _all: true }
        }),
        tx.$queryRaw<LatestConsent[]>`
          SELECT DISTINCT ON (member_id)
            member_id AS "memberId", consent_type AS "consentType", granted,
            text_version AS "textVersion", (captured_at AT TIME ZONE 'UTC') AS "capturedAt"
          FROM public.client_consent_record
          WHERE namespace = ${namespace} AND member_id = ANY(${ids}::text[]) AND deleted_at IS NULL
          ORDER BY member_id, captured_at DESC, id DESC
        `
      ]);
      const sessionCounts = new Map(sessions.map(row => [row.memberId, row._count._all]));
      const consentByMember = new Map(latestConsents.map(row => [row.memberId, {
        type: row.consentType, granted: row.granted, version: row.textVersion, capturedAt: row.capturedAt
      }]));
      return {
        items: members.map(member => ({
          id: member.id,
          nickname: member.nickname,
          emailMasked: maskEmail(member.email),
          status: member.status,
          emailVerified: member.emailVerifiedAt !== null,
          createdAt: member.createdAt,
          lastLoginAt: member.lastLoginAt,
          activeSessionCount: sessionCounts.get(member.id) ?? 0,
          latestConsent: consentByMember.get(member.id) ?? null
        })),
        total,
        page,
        pageSize
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 }));
  }

  listSessions(memberId: string, query: AdminClientHistoryQueryDto, operatorId: string) {
    const namespace = this.config.getOrThrow<string>("namespace"), page = query.page ?? 1, pageSize = query.pageSize ?? 20;
    return this.access.database(() => this.prisma.$transaction(async tx => {
      await this.permissions.authorizeInTransaction(tx, operatorId, [CLIENT_DIRECTORY_READ_PERMISSION]);
      await this.ensureScopedMember(tx, memberId, namespace);
      const where = { memberId, namespace, deletedAt: null };
      const [rows, total] = await Promise.all([
        tx.clientAuthSession.findMany({ where, orderBy: [{ issuedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize,
          select: { id: true, status: true, issuedAt: true, expiresAt: true, lastSeenAt: true, revokedAt: true, revokeReason: true } }),
        tx.clientAuthSession.count({ where })
      ]);
      const now = new Date();
      const safeReasons = new Set(["client_logout", "client_logout_all", "password_changed", "password_reset", "admin_revoked"]);
      return { items: rows.map(row => ({ id: row.id,
        status: row.revokedAt || row.status !== "active" ? "revoked" : row.expiresAt <= now ? "expired" : "active",
        issuedAt: row.issuedAt, expiresAt: row.expiresAt, lastSeenAt: row.lastSeenAt, revokedAt: row.revokedAt,
        revokeReason: row.revokeReason === null ? null : safeReasons.has(row.revokeReason) ? row.revokeReason : "other" })), total, page, pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 }));
  }

  listConsents(memberId: string, query: AdminClientHistoryQueryDto, operatorId: string) {
    const namespace = this.config.getOrThrow<string>("namespace"), page = query.page ?? 1, pageSize = query.pageSize ?? 20;
    return this.access.database(() => this.prisma.$transaction(async tx => {
      await this.permissions.authorizeInTransaction(tx, operatorId, [CLIENT_DIRECTORY_READ_PERMISSION]);
      await this.ensureScopedMember(tx, memberId, namespace);
      const where = { memberId, namespace, deletedAt: null };
      const [rows, total] = await Promise.all([
        tx.clientConsentRecord.findMany({ where, orderBy: [{ capturedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize,
          select: { id: true, consentType: true, granted: true, textVersion: true, source: true, capturedAt: true } }),
        tx.clientConsentRecord.count({ where })
      ]);
      return { items: rows.map(row => ({ id: row.id, consentType: row.consentType, granted: row.granted, textVersion: row.textVersion,
        source: row.source === "client_settings_api" ? row.source : "other", capturedAt: row.capturedAt })), total, page, pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 }));
  }

  revokeSession(memberId: string, sessionId: string, operatorId: string, claims: AdminSessionClaims, currentPassword: string, correlationId?: string) {
    return this.access.write(operatorId, [CLIENT_DIRECTORY_READ_PERMISSION, CLIENT_SESSION_REVOKE_PERMISSION], async (tx, actor) => {
      const reauthenticated = await this.auth.reauthenticateClientSessionActionInTransaction(tx, claims, currentPassword, correlationId);
      if (!reauthenticated) return { reauthenticated: false as const };
      await this.ensureScopedMember(tx, memberId, this.config.getOrThrow<string>("namespace"));
      const result = await this.clientAuth.revokeSessionByAdministratorInTransaction(tx, { memberId, sessionId, operatorId: actor.id, correlationId });
      return { reauthenticated: true as const, ...result };
    });
  }
}
