// Source ClientAuth login/createSession/Guard/rate-bucket mechanisms, adapted to AIJ owner.
import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { readApplicationEnvironment } from "../../../../scripts/runtime-environment.cjs";
import { PrismaService } from "../prisma/prisma.service";
import { ClientConsentUpdateDto, ClientEmailVerificationRequestDto, ClientLoginDto, ClientPasswordChangeDto, ClientPasswordResetRequestDto, ClientRegisterDto } from "./dto";
import { CLIENT_JWT_SERVICE, CLIENT_SESSION_SECONDS, ClientClaims, createClientOneTimeToken, hashClientContext, hashClientOneTimeToken } from "./client-auth.security";
import { ClientAuthNotificationAdapter } from "./client-auth-notification.adapter";

const safeMember = { id: true, email: true, nickname: true } as const;
type LoginContext = { ip: string; userAgent: string; correlationId?: string };
type RateKey = { scope: string; keyHash: string; limit: number };
type LoginMember = Pick<Prisma.MemberUserGetPayload<Record<string, never>>, "id" | "email" | "nickname" | "passwordHash" | "tokenVersion" | "status" | "deletedAt">;
@Injectable()
export class ClientAuthService {
  private readonly dummyHash = bcrypt.hash(randomBytes(32).toString("hex"), 12);
  private readonly rateSecret: string;
  private readonly tokenSecret: string;
  constructor(private readonly prisma: PrismaService, @Inject(CLIENT_JWT_SERVICE) private readonly jwt: JwtService, private readonly config: ConfigService,
    private readonly notifications: ClientAuthNotificationAdapter) {
    const environment = readApplicationEnvironment();
    const rateSecret = environment.CLIENT_AUTH_RATE_LIMIT_SECRET, tokenSecret = environment.CLIENT_AUTH_TOKEN_SECRET;
    if (!rateSecret) throw new Error("CLIENT_AUTH_RATE_LIMIT_SECRET is required");
    if (!tokenSecret) throw new Error("CLIENT_AUTH_TOKEN_SECRET is required");
    this.rateSecret = rateSecret;
    this.tokenSecret = tokenSecret;
  }
  private hash(scope: string, value: string) { return hashClientContext(this.rateSecret, this.config.getOrThrow("namespace"), scope, value); }
  private async ensureDatabase() { if (!(await this.prisma.readiness()).ready) throw new ServiceUnavailableException("Client authentication unavailable"); }
  private audit(tx: Prisma.TransactionClient, action: "registration_requested" | "registration_rate_limited" | "verification_requested" | "verification_rate_limited" | "verification_failed" | "email_verified" | "password_reset_requested" | "password_reset_rate_limited" | "password_reset_failed" | "password_reset_completed" | "login" | "login_failed" | "login_rate_limited" | "logout" | "sessions_revoked" | "password_changed" | "password_change_failed" | "password_change_rate_limited" | "consent_changed" | "consent_withdrawn", memberId: string | undefined, correlationId?: string, path = "/api/client/auth/login") {
    return tx.auditLog.create({ data: { module: "client-auth", action, status: ["registration_requested", "verification_requested", "email_verified", "password_reset_requested", "password_reset_completed", "login", "logout", "sessions_revoked", "password_changed", "consent_changed", "consent_withdrawn"].includes(action) ? "success" : "failed", resourceType: action.startsWith("consent_") ? "client_consent" : "member_auth", resourceId: memberId,
      path, method: action.startsWith("consent_") ? "PATCH" : "POST", requestSummary: { correlationId: correlationId || "unavailable" } } });
  }
  // Atomic reservations bound concurrent guesses; no plaintext identity/IP in rate buckets.
  private reserveKeys(keys: RateKey[]) {
    return this.prisma.$transaction(async tx => {
      const now = new Date();
      for (const key of [...keys].sort((a, b) => a.keyHash.localeCompare(b.keyHash))) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key.scope + ":" + key.keyHash}, 0))`;
      for (const key of keys) {
        const bucket = await tx.clientAuthRateBucket.findUnique({ where: { scope_keyHash: { scope: key.scope, keyHash: key.keyHash } } });
        if (bucket?.blockedUntil && bucket.blockedUntil > now) return false;
      }
      for (const key of keys) {
        const where = { scope_keyHash: { scope: key.scope, keyHash: key.keyHash } }, bucket = await tx.clientAuthRateBucket.findUnique({ where });
        const expired = !bucket || now.getTime() - bucket.windowStartedAt.getTime() >= 900000;
        const attemptCount = expired ? 1 : bucket.attemptCount + 1;
        const data = { attemptCount, windowStartedAt: expired ? now : bucket.windowStartedAt, lastAttemptAt: now, blockedUntil: attemptCount >= key.limit ? new Date(now.getTime() + 900000) : null, deletedAt: null };
        await tx.clientAuthRateBucket.upsert({ where, create: { scope: key.scope, keyHash: key.keyHash, ...data }, update: data });
      }
      return true;
    });
  }
  private reserveLogin(identity: string, ip: string) {
    return this.reserveKeys([{ scope: "login_identity", keyHash: this.hash("login_identity", identity), limit: 5 }, { scope: "login_ip", keyHash: this.hash("login_ip", ip), limit: 30 }]);
  }
  private passwordChangeKeys(memberId: string, ip: string): RateKey[] {
    return [{ scope: "password_change_identity", keyHash: this.hash("password_change_identity", memberId), limit: 5 }, { scope: "password_change_ip", keyHash: this.hash("password_change_ip", ip), limit: 30 }];
  }
  async register(dto: ClientRegisterDto, context: LoginContext) {
    const email = dto.email.trim().toLowerCase(), nickname = dto.nickname.trim();
    if (Buffer.byteLength(dto.password, "utf8") > 72) throw new BadRequestException("Invalid request");
    await this.ensureDatabase();
    try {
      if (!(await this.reserveKeys([{ scope: "registration_ip", keyHash: this.hash("registration_ip", context.ip), limit: 30 }]))) {
        await this.prisma.$transaction(tx => this.audit(tx, "registration_rate_limited", undefined, context.correlationId, "/api/client/auth/register"));
        throw new HttpException("Too many registration attempts", 429);
      }
      const passwordHash = await bcrypt.hash(dto.password, 12), namespace = this.config.getOrThrow("namespace");
      await this.prisma.$transaction(async tx => {
        const identityLock = `${namespace}:registration:${this.hash("register_identity", email)}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${identityLock}, 0))`;
        const existing = await tx.memberUser.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
        const member = existing ? undefined : await tx.memberUser.create({
          data: { email, nickname, passwordHash, passwordChangedAt: new Date(), status: "pending_verification", emailVerifiedAt: null },
          select: { id: true }
        });
        // Duplicate and new identities produce the same public response. The audit
        // row records only the generic event and correlation ID, never the email/IP.
        await this.audit(tx, "registration_requested", member?.id ?? existing?.id, context.correlationId, "/api/client/auth/register");
      });
      return { accepted: true };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // The transaction-level identity lock handles normal concurrency; this
        // fallback still keeps a unique-index race indistinguishable to callers.
        try {
          await this.prisma.$transaction(tx => this.audit(tx, "registration_requested", undefined, context.correlationId, "/api/client/auth/register"));
          return { accepted: true };
        } catch { throw new ServiceUnavailableException("Client registration unavailable"); }
      }
      throw new ServiceUnavailableException("Client registration unavailable");
    }
  }

  private emailVerificationPurpose(namespace: string) {
    return `client-email-verification:${namespace}`;
  }

  async requestEmailVerification(dto: ClientEmailVerificationRequestDto, context: LoginContext) {
    const email = dto.email.trim().toLowerCase();
    await this.ensureDatabase();
    try {
      const namespace = this.config.getOrThrow("namespace");
      const rateAllowed = await this.reserveKeys([
        { scope: "verification_request_identity", keyHash: this.hash("verification_request_identity", email), limit: 5 },
        { scope: "verification_request_ip", keyHash: this.hash("verification_request_ip", context.ip), limit: 30 }
      ]);
      if (!rateAllowed) {
        await this.prisma.$transaction(tx => this.audit(tx, "verification_rate_limited", undefined, context.correlationId, "/api/client/auth/email/verification/request"));
        throw new HttpException("Too many verification requests", 429);
      }
      const member = await this.prisma.memberUser.findFirst({
        where: { email: { equals: email, mode: "insensitive" }, status: { in: ["pending_verification", "active"] }, emailVerifiedAt: null, deletedAt: null },
        select: { id: true, email: true }
      });
      // Unknown, already-verified and unavailable-delivery accounts share the
      // same response. No token row is created unless a trusted adapter exists.
      if (!member || !member.email || !this.notifications.available) return { accepted: true };

      const purpose = this.emailVerificationPurpose(namespace), token = createClientOneTimeToken();
      const now = new Date(), expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
      const created = await this.prisma.$transaction(async tx => {
        const lockKey = `${namespace}:email-verification:${member.id}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        const current = await tx.memberUser.findFirst({ where: { id: member.id, status: { in: ["pending_verification", "active"] }, emailVerifiedAt: null, deletedAt: null }, select: { id: true } });
        if (!current) return false;
        await tx.clientAuthOneTimeToken.updateMany({
          where: { memberId: member.id, purpose, consumedAt: null, revokedAt: null, deletedAt: null },
          data: { revokedAt: now }
        });
        await tx.clientAuthOneTimeToken.create({
          data: { memberId: member.id, purpose, tokenHash: hashClientOneTimeToken(this.tokenSecret, purpose, token), expiresAt }
        });
        await this.audit(tx, "verification_requested", member.id, context.correlationId, "/api/client/auth/email/verification/request");
        return true;
      });
      if (!created) return { accepted: true };
      try {
        const delivered = await this.notifications.deliver({ purpose: "email_verification", memberId: member.id, email: member.email, token, expiresAt });
        if (delivered === "accepted") return { accepted: true };
      } catch {
        // Do not expose delivery state or identity existence through this endpoint.
      }
      await this.prisma.clientAuthOneTimeToken.updateMany({
        where: { memberId: member.id, purpose, tokenHash: hashClientOneTimeToken(this.tokenSecret, purpose, token), consumedAt: null, revokedAt: null, deletedAt: null },
        data: { revokedAt: new Date() }
      });
      return { accepted: true };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Client verification unavailable");
    }
  }

  async confirmEmailVerification(rawToken: string, context: Pick<LoginContext, "ip" | "correlationId">) {
    if (typeof rawToken !== "string" || !/^[A-Za-z0-9_-]{40,100}$/.test(rawToken)) throw new BadRequestException("Invalid or expired verification token");
    await this.ensureDatabase();
    try {
      const namespace = this.config.getOrThrow("namespace"), purpose = this.emailVerificationPurpose(namespace);
      const tokenHash = hashClientOneTimeToken(this.tokenSecret, purpose, rawToken);
      const allowed = await this.reserveKeys([
        { scope: "verification_confirm_token", keyHash: this.hash("verification_confirm_token", tokenHash), limit: 5 },
        { scope: "verification_confirm_ip", keyHash: this.hash("verification_confirm_ip", context.ip), limit: 30 }
      ]);
      if (!allowed) {
        await this.prisma.$transaction(tx => this.audit(tx, "verification_rate_limited", undefined, context.correlationId, "/api/client/auth/email/verification/confirm"));
        throw new HttpException("Too many verification attempts", 429);
      }
      const token = await this.prisma.clientAuthOneTimeToken.findUnique({ where: { tokenHash }, select: { id: true, memberId: true, purpose: true, expiresAt: true, consumedAt: true, revokedAt: true, deletedAt: true } });
      const now = new Date();
      if (!token || token.purpose !== purpose || token.deletedAt || token.revokedAt || token.consumedAt || token.expiresAt <= now) {
        throw new BadRequestException("Invalid or expired verification token");
      }
      await this.prisma.$transaction(async tx => {
        const claimed = await tx.clientAuthOneTimeToken.updateMany({
          where: { id: token.id, memberId: token.memberId, purpose, consumedAt: null, revokedAt: null, deletedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now }
        });
        if (claimed.count !== 1) throw new BadRequestException("Invalid or expired verification token");
        const activated = await tx.memberUser.updateMany({
          where: { id: token.memberId, status: { in: ["pending_verification", "active"] }, emailVerifiedAt: null, deletedAt: null },
          data: { status: "active", emailVerifiedAt: now }
        });
        if (activated.count !== 1) throw new BadRequestException("Invalid or expired verification token");
        await this.audit(tx, "email_verified", token.memberId, context.correlationId, "/api/client/auth/email/verification/confirm");
      });
      return { verified: true };
    } catch (error) {
      if (error instanceof BadRequestException) {
        try {
          await this.prisma.$transaction(tx => this.audit(tx, "verification_failed", undefined, context.correlationId, "/api/client/auth/email/verification/confirm"));
        } catch {
          throw new ServiceUnavailableException("Client verification unavailable");
        }
      }
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Client verification unavailable");
    }
  }

  private passwordResetPurpose(namespace: string) {
    return `client-password-reset:${namespace}`;
  }

  async requestPasswordReset(dto: ClientPasswordResetRequestDto, context: LoginContext) {
    const email = dto.email.trim().toLowerCase();
    await this.ensureDatabase();
    const namespace = this.config.getOrThrow("namespace"), path = "/api/client/auth/password/reset/request";
    try {
      const allowed = await this.reserveKeys([
        { scope: "password_reset_request_identity", keyHash: this.hash("password_reset_request_identity", email), limit: 5 },
        { scope: "password_reset_request_ip", keyHash: this.hash("password_reset_request_ip", context.ip), limit: 30 }
      ]);
      if (!allowed) {
        await this.prisma.$transaction(tx => this.audit(tx, "password_reset_rate_limited", undefined, context.correlationId, path));
        return { accepted: true };
      }
      const member = await this.prisma.memberUser.findFirst({
        where: { email: { equals: email, mode: "insensitive" }, status: "active", emailVerifiedAt: { not: null }, deletedAt: null },
        select: { id: true, email: true }
      });
      // Keep the response and token state indistinguishable for unknown,
      // disabled, unverified and adapter-unavailable identities.
      if (!member?.email || !this.notifications.available) {
        await this.prisma.$transaction(tx => this.audit(tx, "password_reset_requested", undefined, context.correlationId, path));
        return { accepted: true };
      }

      const purpose = this.passwordResetPurpose(namespace), token = createClientOneTimeToken();
      const now = new Date(), expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
      const created = await this.prisma.$transaction(async tx => {
        const lockKey = `${namespace}:password-reset:${member.id}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        const current = await tx.memberUser.findFirst({ where: { id: member.id, status: "active", emailVerifiedAt: { not: null }, deletedAt: null }, select: { id: true } });
        if (!current) return false;
        await tx.clientAuthOneTimeToken.updateMany({
          where: { memberId: member.id, purpose, consumedAt: null, revokedAt: null, deletedAt: null },
          data: { revokedAt: now }
        });
        await tx.clientAuthOneTimeToken.create({
          data: { memberId: member.id, purpose, tokenHash: hashClientOneTimeToken(this.tokenSecret, purpose, token), expiresAt }
        });
        await this.audit(tx, "password_reset_requested", undefined, context.correlationId, path);
        return true;
      });
      if (!created) return { accepted: true };
      try {
        if (await this.notifications.deliver({ purpose: "password_reset", memberId: member.id, email: member.email, token, expiresAt }) === "accepted") return { accepted: true };
      } catch {
        // Do not expose identity existence or adapter state.
      }
      await this.prisma.clientAuthOneTimeToken.updateMany({
        where: { memberId: member.id, purpose, tokenHash: hashClientOneTimeToken(this.tokenSecret, purpose, token), consumedAt: null, revokedAt: null, deletedAt: null },
        data: { revokedAt: new Date() }
      });
      return { accepted: true };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Password reset unavailable");
    }
  }

  async confirmPasswordReset(rawToken: string, newPassword: string, context: Pick<LoginContext, "ip" | "correlationId">) {
    if (typeof rawToken !== "string" || !/^[A-Za-z0-9_-]{40,100}$/.test(rawToken) || Buffer.byteLength(newPassword, "utf8") > 72) {
      throw new BadRequestException("Invalid or expired reset request");
    }
    await this.ensureDatabase();
    const namespace = this.config.getOrThrow("namespace"), purpose = this.passwordResetPurpose(namespace);
    const tokenHash = hashClientOneTimeToken(this.tokenSecret, purpose, rawToken);
    const path = "/api/client/auth/password/reset/confirm";
    try {
      const allowed = await this.reserveKeys([
        { scope: "password_reset_confirm_token", keyHash: this.hash("password_reset_confirm_token", tokenHash), limit: 5 },
        { scope: "password_reset_confirm_ip", keyHash: this.hash("password_reset_confirm_ip", context.ip), limit: 30 }
      ]);
      if (!allowed) {
        await this.prisma.$transaction(tx => this.audit(tx, "password_reset_rate_limited", undefined, context.correlationId, path));
        throw new HttpException("Too many reset attempts", 429);
      }
      const candidate = await this.prisma.clientAuthOneTimeToken.findUnique({
        where: { tokenHash }, select: { id: true, memberId: true, purpose: true, expiresAt: true, consumedAt: true, revokedAt: true, deletedAt: true }
      });
      const now = new Date();
      if (!candidate || candidate.purpose !== purpose || candidate.deletedAt || candidate.revokedAt || candidate.consumedAt || candidate.expiresAt <= now) {
        throw new BadRequestException("Invalid or expired reset request");
      }
      await this.prisma.$transaction(async tx => {
        // Serialize password resets on the member row before claiming a token.
        // This keeps competing project namespaces on the same credential boundary.
        await tx.$queryRaw`SELECT id FROM public.member_user WHERE id=${candidate.memberId} FOR UPDATE`;
        const claimed = await tx.clientAuthOneTimeToken.updateMany({
          where: { id: candidate.id, memberId: candidate.memberId, purpose, consumedAt: null, revokedAt: null, deletedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now }
        });
        if (claimed.count !== 1) throw new BadRequestException("Invalid or expired reset request");
        const member = await tx.memberUser.findFirst({ where: { id: candidate.memberId, status: "active", emailVerifiedAt: { not: null }, deletedAt: null },
          select: { id: true, passwordHash: true, tokenVersion: true } });
        if (!member?.passwordHash) throw new BadRequestException("Invalid or expired reset request");
        if (await bcrypt.compare(newPassword, member.passwordHash)) throw new ConflictException("New password must differ from current password");
        const passwordHash = await bcrypt.hash(newPassword, 12);
        const changed = await tx.memberUser.updateMany({
          where: { id: member.id, passwordHash: member.passwordHash, tokenVersion: member.tokenVersion, status: "active", deletedAt: null },
          data: { passwordHash, passwordChangedAt: now, tokenVersion: { increment: 1 } }
        });
        if (changed.count !== 1) throw new BadRequestException("Invalid or expired reset request");
        // Credentials belong to the member identity, so revoke sessions in every
        // project namespace and all competing reset tokens in the same transaction.
        await tx.clientAuthSession.updateMany({ where: { memberId: member.id, status: "active", revokedAt: null, deletedAt: null },
          data: { status: "revoked", revokedAt: now, revokeReason: "password_reset" } });
        await tx.clientAuthOneTimeToken.updateMany({ where: { memberId: member.id, purpose: { startsWith: "client-password-reset:" }, id: { not: candidate.id }, consumedAt: null, revokedAt: null, deletedAt: null },
          data: { revokedAt: now } });
        await this.audit(tx, "password_reset_completed", member.id, context.correlationId, path);
      });
      return { reset: true };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) {
        try { await this.prisma.$transaction(tx => this.audit(tx, "password_reset_failed", undefined, context.correlationId, path)); }
        catch { throw new ServiceUnavailableException("Password reset unavailable"); }
      }
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Password reset unavailable");
    }
  }

  async login(dto: ClientLoginDto, context: LoginContext) {
    // Keep direct service callers on the same exclusive-identity boundary as the DTO.
    const useEmail = dto.email !== undefined, rawIdentity = useEmail ? dto.email : dto.username;
    if (useEmail === (dto.username !== undefined) || typeof rawIdentity !== "string" || !rawIdentity.trim() || rawIdentity.trim().length > 254) {
      throw new BadRequestException("Invalid request");
    }
    const identity = rawIdentity.trim().toLowerCase();
    if (Buffer.byteLength(dto.password, "utf8") > 72) throw new BadRequestException("Invalid request");
    await this.ensureDatabase();
    try {
      if (!(await this.reserveLogin(identity, context.ip))) {
        await this.prisma.$transaction(tx => this.audit(tx, "login_rate_limited", undefined, context.correlationId));
        throw new HttpException("Too many login attempts", 429);
      }
      // Prisma insensitive equals uses ILIKE in this connector. Identity values
      // are literals, including %, _ and backslash; only these static SQL columns vary.
      // Keep inactive/deleted variants in the bounded ambiguity check.
      const column = useEmail ? Prisma.sql`email` : Prisma.sql`username`;
      const matches = await this.prisma.$queryRaw<LoginMember[]>(Prisma.sql`
        SELECT id, email, nickname, password_hash AS "passwordHash", token_version AS "tokenVersion", status, deleted_at AS "deletedAt"
        FROM public.member_user WHERE lower(${column}) = lower(${identity}) LIMIT 2`);
      const candidate = matches.length === 1 ? matches[0] : undefined;
      // The existing identity/IP buckets protect unknown identities. This extra
      // member bucket shares the same five-attempt window across email and username.
      if (candidate && !(await this.reserveKeys([{ scope: "login_account", keyHash: this.hash("login_account", candidate.id), limit: 5 }]))) {
        await this.prisma.$transaction(tx => this.audit(tx, "login_rate_limited", undefined, context.correlationId));
        throw new HttpException("Too many login attempts", 429);
      }
      const member = candidate?.status === "active" && !candidate.deletedAt ? candidate : undefined;
      if (!member?.passwordHash || !(await bcrypt.compare(dto.password, member.passwordHash || await this.dummyHash))) {
        // Always run a comparison for identities without a usable password.
        if (!member?.passwordHash) await bcrypt.compare(dto.password, await this.dummyHash);
        await this.prisma.$transaction(tx => this.audit(tx, "login_failed", member?.id, context.correlationId));
        throw new UnauthorizedException("Invalid credentials");
      }
      const now = new Date(), expiresAt = new Date(now.getTime() + CLIENT_SESSION_SECONDS * 1000);
      return await this.prisma.$transaction(async tx => {
        const changed = await tx.memberUser.updateMany({ where: { id: member.id, passwordHash: member.passwordHash, tokenVersion: member.tokenVersion, status: "active", deletedAt: null }, data: { lastLoginAt: now } });
        if (changed.count !== 1) throw new UnauthorizedException("Invalid credentials");
        const session = await tx.clientAuthSession.create({ data: { memberId: member.id, namespace: this.config.getOrThrow("namespace"), status: "active", deviceHash: this.hash("device", context.userAgent.slice(0, 2048)), deviceSummary: "Browser session",
          ipHash: this.hash("session_ip", context.ip), issuedAt: now, lastSeenAt: now, expiresAt }, select: { id: true } });
        // Sign before commit: a signing/audit failure must not leave a usable orphan session.
        const token = await this.jwt.signAsync({ sub: member.id, tokenKind: "client", projectId: this.config.getOrThrow("projectId"), environment: this.config.getOrThrow("environment"),
          tokenVersion: member.tokenVersion, sessionId: session.id }, { jwtid: randomUUID() });
        await this.audit(tx, "login", member.id, context.correlationId);
        await tx.clientAuthRateBucket.updateMany({ where: { OR: [
          { scope: "login_identity", keyHash: this.hash("login_identity", identity) },
          { scope: "login_account", keyHash: this.hash("login_account", member.id) }
        ] }, data: { attemptCount: 0, blockedUntil: null, windowStartedAt: now } });
        return { token, member: { id: member.id, email: member.email, nickname: member.nickname } };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Client authentication unavailable");
    }
  }
  /** Read-only final fence for an already authenticated operation after external IO. */
  async assertActiveSessionInTransaction(tx: Prisma.TransactionClient, claims: ClientClaims): Promise<void> {
    if (!claims || typeof claims.sub !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(claims.sub)
      || typeof claims.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(claims.sessionId)
      || !Number.isSafeInteger(claims.tokenVersion) || claims.tokenVersion < 0) throw new UnauthorizedException("Invalid client session");
    try {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM public.client_auth_session s JOIN public.member_user u ON u.id = s.member_id
        WHERE s.id = ${claims.sessionId} AND s.member_id = ${claims.sub}
          AND s.namespace = ${this.config.getOrThrow<string>("namespace")}
          AND s.status = 'active' AND s.revoked_at IS NULL AND s.deleted_at IS NULL
          AND s.issued_at <= CURRENT_TIMESTAMP AND s.expires_at > CURRENT_TIMESTAMP
          AND u.status = 'active' AND u.deleted_at IS NULL AND u.token_version = ${claims.tokenVersion}
        FOR SHARE OF s, u`;
      if (!rows.length) throw new UnauthorizedException("Invalid client session");
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException("Client authentication unavailable");
    }
  }

  /** Recheck an already verified request in its caller's short commit transaction.
   * Session revocation/password changes serialize on these original identity rows;
   * no nested transaction, second auth owner, or session data returned to the caller.
   */
  async assertSessionInTransaction(tx: Prisma.TransactionClient, claims: ClientClaims): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT s.id FROM public.client_auth_session s JOIN public.member_user m ON m.id=s.member_id
      WHERE s.id=${claims.sessionId} AND s.member_id=${claims.sub} AND s.namespace=${this.config.getOrThrow<string>("namespace")}
        AND s.status='active' AND s.revoked_at IS NULL AND s.deleted_at IS NULL
        AND s.issued_at<=clock_timestamp() AND s.expires_at>clock_timestamp()
        AND m.token_version=${claims.tokenVersion} AND m.status='active' AND m.deleted_at IS NULL
      FOR SHARE OF m,s`;
    if (rows.length !== 1) throw new UnauthorizedException("Invalid client session");
    // A FOR SHARE statement may have waited on an unchanged locked tuple. Check the
    // real clock again after acquiring the original session/member locks.
    const current = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.client_auth_session
      WHERE id=${claims.sessionId} AND issued_at<=clock_timestamp() AND expires_at>clock_timestamp()`;
    if (current.length !== 1) throw new UnauthorizedException("Invalid client session");
  }

  async authenticate(claims: ClientClaims) {
    await this.ensureDatabase();
    try {
      return await this.prisma.$transaction(async tx => {
        // Synchronize with identity/password writes; tokenVersion and status are DB truth.
        await tx.$queryRaw`SELECT id FROM public.member_user WHERE id=${claims.sub} FOR SHARE`;
        const member = await tx.memberUser.findFirst({ where: { id: claims.sub, tokenVersion: claims.tokenVersion, status: "active", deletedAt: null }, select: safeMember });
        if (!member) throw new UnauthorizedException("Invalid client session");
        const updated = await tx.clientAuthSession.updateMany({ where: { id: claims.sessionId, memberId: member.id, namespace: this.config.getOrThrow("namespace"), status: "active", revokedAt: null, deletedAt: null, issuedAt: { lte: new Date() }, expiresAt: { gt: new Date() } }, data: { lastSeenAt: new Date() } });
        if (updated.count !== 1) throw new UnauthorizedException("Invalid client session");
        return member;
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException("Client authentication unavailable");
    }
  }

  async logoutCurrent(memberId: string, sessionId: string, correlationId?: string) {
    await this.ensureDatabase();
    try {
      await this.prisma.$transaction(async tx => {
        const now = new Date();
        const result = await tx.clientAuthSession.updateMany({ where: { id: sessionId, memberId, namespace: this.config.getOrThrow("namespace"), status: "active", revokedAt: null, deletedAt: null },
          data: { status: "revoked", revokedAt: now, revokeReason: "client_logout" } });
        if (result.count !== 1) throw new UnauthorizedException("Invalid client session");
        await this.audit(tx, "logout", memberId, correlationId, "/api/client/auth/logout");
      });
      return { signedOut: true };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException("Client authentication unavailable");
    }
  }

  async revokeAll(memberId: string, correlationId?: string) {
    await this.ensureDatabase();
    try {
      return await this.prisma.$transaction(async tx => {
        // Serialize with login's member UPDATE before taking the session snapshot.
        // A login already issuing a session commits before this namespace revocation.
        await tx.$queryRaw`SELECT id FROM public.member_user WHERE id=${memberId} FOR UPDATE`;
        const now = new Date();
        const result = await tx.clientAuthSession.updateMany({ where: { memberId, namespace: this.config.getOrThrow("namespace"), status: "active", revokedAt: null, deletedAt: null },
          data: { status: "revoked", revokedAt: now, revokeReason: "client_logout_all" } });
        await this.audit(tx, "sessions_revoked", memberId, correlationId, "/api/client/auth/sessions/revoke-all");
        return { signedOut: true, revokedCount: result.count };
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException("Client authentication unavailable");
    }
  }

  async revokeSessionByAdministratorInTransaction(tx: Prisma.TransactionClient, input: { memberId: string; sessionId: string; operatorId: string; correlationId?: string }) {
    const namespace = this.config.getOrThrow<string>("namespace"), now = new Date();
    const where = { id: input.sessionId, memberId: input.memberId, namespace, status: "active", revokedAt: null, deletedAt: null, expiresAt: { gt: now } };
    const session = await tx.clientAuthSession.findFirst({ where, select: { id: true } });
    if (!session) throw new NotFoundException("Client session not found");
    const changed = await tx.clientAuthSession.updateMany({ where, data: { status: "revoked", revokedAt: now, revokeReason: "admin_revoked" } });
    if (changed.count !== 1) throw new NotFoundException("Client session not found");
    await tx.auditLog.create({ data: { module: "client-auth", action: "admin_session_revoked", status: "success", resourceType: "client_auth_session",
      userId: input.operatorId, resourceId: session.id, path: "/api/admin/clients/sessions/revoke", method: "POST",
      requestSummary: { correlationId: input.correlationId || "unavailable", fields: ["sessionId"] } } });
    return { revoked: true, sessionId: session.id };
  }

  async changePassword(memberId: string, dto: ClientPasswordChangeDto, context: Pick<LoginContext, "ip" | "correlationId">) {
    if (Buffer.byteLength(dto.currentPassword, "utf8") > 72 || Buffer.byteLength(dto.newPassword, "utf8") > 72) throw new BadRequestException("Invalid request");
    await this.ensureDatabase();
    const rateKeys = this.passwordChangeKeys(memberId, context.ip);
    try {
      if (!(await this.reserveKeys(rateKeys))) {
        await this.prisma.$transaction(tx => this.audit(tx, "password_change_rate_limited", memberId, context.correlationId, "/api/client/auth/password"));
        throw new HttpException("Too many password change attempts", 429);
      }
      const outcome = await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM public.member_user WHERE id=${memberId} FOR UPDATE`;
        const member = await tx.memberUser.findFirst({ where: { id: memberId, status: "active", deletedAt: null }, select: { id: true, passwordHash: true, tokenVersion: true } });
        const currentMatches = member?.passwordHash ? await bcrypt.compare(dto.currentPassword, member.passwordHash) : await bcrypt.compare(dto.currentPassword, await this.dummyHash);
        if (!member?.passwordHash || !currentMatches) {
          await this.audit(tx, "password_change_failed", memberId, context.correlationId, "/api/client/auth/password");
          return "invalid" as const;
        }
        if (await bcrypt.compare(dto.newPassword, member.passwordHash)) {
          await this.audit(tx, "password_change_failed", memberId, context.correlationId, "/api/client/auth/password");
          return "reused" as const;
        }
        const now = new Date(), passwordHash = await bcrypt.hash(dto.newPassword, 12);
        const changed = await tx.memberUser.updateMany({ where: { id: member.id, passwordHash: member.passwordHash, tokenVersion: member.tokenVersion, status: "active", deletedAt: null },
          data: { passwordHash, passwordChangedAt: now, tokenVersion: { increment: 1 } } });
        if (changed.count !== 1) {
          await this.audit(tx, "password_change_failed", memberId, context.correlationId, "/api/client/auth/password");
          return "invalid" as const;
        }
        // A password is a MemberUser-wide credential, so every old project session is invalidated together.
        await tx.clientAuthSession.updateMany({ where: { memberId: member.id, status: "active", revokedAt: null, deletedAt: null },
          data: { status: "revoked", revokedAt: now, revokeReason: "password_changed" } });
        await tx.clientAuthRateBucket.updateMany({ where: { scope: "password_change_identity", keyHash: this.hash("password_change_identity", member.id) },
          data: { attemptCount: 0, blockedUntil: null, windowStartedAt: now, lastAttemptAt: now } });
        await this.audit(tx, "password_changed", member.id, context.correlationId, "/api/client/auth/password");
        return "changed" as const;
      });
      if (outcome === "invalid") throw new UnauthorizedException("Current password is invalid");
      if (outcome === "reused") throw new ConflictException("New password must differ from current password");
      return { changed: true };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Client authentication unavailable");
    }
  }

  private consentView(row: Prisma.ClientConsentRecordGetPayload<Record<string, never>>) {
    return { consentType: row.consentType, granted: row.granted, textVersion: row.textVersion, textDigest: row.textDigest, source: row.source, capturedAt: row.capturedAt };
  }

  async getConsents(memberId: string) {
    await this.ensureDatabase();
    try {
      const rows = await this.prisma.clientConsentRecord.findMany({
        where: { memberId, namespace: this.config.getOrThrow("namespace"), deletedAt: null },
        orderBy: [{ consentType: "asc" }, { capturedAt: "desc" }, { id: "desc" }]
      });
      const latest = new Map<string, typeof rows[number]>();
      for (const row of rows) if (!latest.has(row.consentType)) latest.set(row.consentType, row);
      return [...latest.values()].map(row => this.consentView(row));
    } catch {
      throw new ServiceUnavailableException("Client consent unavailable");
    }
  }

  async updateConsent(memberId: string, dto: ClientConsentUpdateDto, correlationId?: string) {
    await this.ensureDatabase();
    const namespace = this.config.getOrThrow("namespace");
    try {
      return await this.prisma.$transaction(async tx => {
        const lockKey = `client-consent:${namespace}:${memberId}:${dto.consentType}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        const latest = await tx.clientConsentRecord.findFirst({
          where: { memberId, namespace, consentType: dto.consentType, deletedAt: null },
          orderBy: [{ capturedAt: "desc" }, { id: "desc" }]
        });
        const sameState = latest && latest.granted === dto.granted && latest.textVersion === dto.textVersion && latest.textDigest === dto.textDigest;
        if (sameState) return { ...this.consentView(latest), unchanged: true };

        const capturedAt = new Date(Math.max(Date.now(), (latest?.capturedAt.getTime() ?? 0) + 1));
        const row = await tx.clientConsentRecord.create({ data: {
          memberId, namespace, consentType: dto.consentType, granted: dto.granted,
          textVersion: dto.textVersion, textDigest: dto.textDigest, source: "client_settings_api", capturedAt
        } });
        await this.audit(tx, dto.granted ? "consent_changed" : "consent_withdrawn", memberId, correlationId, "/api/client/auth/consents");
        return { ...this.consentView(row), unchanged: false };
      });
    } catch {
      throw new ServiceUnavailableException("Client consent unavailable");
    }
  }
}
