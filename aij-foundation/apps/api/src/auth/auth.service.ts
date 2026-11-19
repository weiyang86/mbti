// Directed bcrypt + SysUser + last-login/audit adaptation; source provenance section 13.
import { BadRequestException, ConflictException, HttpException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { LoginDto } from "./dto/login.dto";
import type { AdminPrincipal, AdminSessionClaims } from "./auth.types";
import { ADMIN_PASSWORD_COST, isAdminPassword } from "../../../../scripts/admin-policy.cjs";
import type { Prisma } from "@prisma/client";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { readApplicationEnvironment } from "../../../../scripts/runtime-environment.cjs";
import { csrfToken } from "./browser-session";
import { ADMIN_TOKEN_SECONDS } from "./auth.types";

const selectUser = { id: true, username: true, realName: true, isSuperAdmin: true } as const;
@Injectable()
export class AuthService {
  private readonly dummyHash = bcrypt.hash(randomBytes(32).toString("hex"), 12);
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly config: ConfigService) {}

  private async ensureDatabase() {
    if (!(await this.prisma.readiness()).ready) throw new ServiceUnavailableException("Authentication service unavailable");
  }
  async login(dto: LoginDto, correlationId?: string, transport: "bearer" | "cookie" = "bearer") {
    if (Buffer.byteLength(dto.password, "utf8") > 72) throw new BadRequestException("Invalid authentication request");
    await this.ensureDatabase();
    try {
      const user = await this.prisma.sysUser.findFirst({ where: { username: dto.username, status: "active", deletedAt: null }, select: { ...selectUser, passwordHash: true, tokenVersion: true } });
      const passed = await bcrypt.compare(dto.password, user?.passwordHash ?? await this.dummyHash);
      if (!user || !passed) {
        await this.prisma.auditLog.create({ data: { module: "auth", action: "login_failed", status: "failed", resourceType: "admin-auth", userId: user?.id, resourceId: user?.id,
          path: "/api/auth/login", method: "POST", errorMessage: "invalid_credentials", requestSummary: { correlationId: correlationId || "unavailable" } } });
        throw new UnauthorizedException("Invalid credentials");
      }
      return await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aij-admin-users-write'))`;
        const changed = await tx.sysUser.updateMany({ where: { id: user.id, status: "active", deletedAt: null, passwordHash: user.passwordHash, tokenVersion: user.tokenVersion }, data: { lastLoginAt: new Date() } });
        if (changed.count !== 1) throw new UnauthorizedException("Invalid credentials");
        await tx.auditLog.create({ data: { module: "auth", action: "login", status: "success", resourceType: "admin-auth", userId: user.id, resourceId: user.id,
          path: "/api/auth/login", method: "POST", requestSummary: { correlationId: correlationId || "unavailable" } } });
        const session = await tx.adminAuthSession.create({ data: { userId: user.id, namespace: this.config.getOrThrow("namespace"), transport, expiresAt: new Date(Date.now() + ADMIN_TOKEN_SECONDS * 1000) } });
        const accessToken = await this.jwt.signAsync({ sub: user.id, tokenKind: "admin", projectId: this.config.getOrThrow<string>("projectId"), environment: this.config.getOrThrow<string>("environment"),
          sessionId: session.id, tokenVersion: user.tokenVersion, transport }, { jwtid: randomUUID() });
        const principal: AdminPrincipal = { id: user.id, username: user.username, realName: user.realName, isSuperAdmin: user.isSuperAdmin };
        return { accessToken, tokenType: "Bearer", expiresIn: ADMIN_TOKEN_SECONDS, user: principal };
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException("Authentication service unavailable");
    }
  }
  browserCsrf(claims: AdminSessionClaims) {
    return csrfToken(readApplicationEnvironment().JWT_SECRET!, this.config.getOrThrow("namespace"), claims);
  }
  private async session(tx: Prisma.TransactionClient, claims: AdminSessionClaims): Promise<AdminPrincipal> {
    await tx.$queryRaw`SELECT id FROM public.sys_user WHERE id=${claims.sub} FOR SHARE`;
    const user = await tx.sysUser.findFirst({ where: { id: claims.sub, status: "active", deletedAt: null, tokenVersion: claims.tokenVersion }, select: selectUser });
    const session = await tx.adminAuthSession.findFirst({ where: { id: claims.sessionId, userId: claims.sub, namespace: this.config.getOrThrow("namespace"), transport: claims.transport,
      revokedAt: null, issuedAt: { lte: new Date() }, expiresAt: { gt: new Date() } }, select: { id: true } });
    if (!user || !session) throw new UnauthorizedException("Invalid administrator session");
    return user;
  }
  async authenticate(claims: AdminSessionClaims): Promise<AdminPrincipal> {
    await this.ensureDatabase();
    try { return await this.prisma.$transaction(tx => this.session(tx, claims)); }
    catch (error) { if (error instanceof UnauthorizedException) throw error; throw new ServiceUnavailableException("Authentication service unavailable"); }
  }
  private audit(tx: Prisma.TransactionClient, userId: string, action: string, path: string, correlationId?: string) {
    return tx.auditLog.create({ data: { module: "auth", action, status: action === "password_change_failed" ? "failed" : "success", resourceType: "admin-auth", userId, resourceId: userId,
      path, method: "POST", requestSummary: { correlationId: correlationId || "unavailable" } } });
  }
  async reauthenticateClientSessionActionInTransaction(tx: Prisma.TransactionClient, claims: AdminSessionClaims, password: string, correlationId?: string) {
    let valid = Buffer.byteLength(password, "utf8") <= 72;
    if (valid) {
      try {
        await this.session(tx, claims);
        const user = await tx.sysUser.findFirst({ where: { id: claims.sub, status: "active", deletedAt: null, tokenVersion: claims.tokenVersion }, select: { passwordHash: true } });
        valid = Boolean(user && await bcrypt.compare(password, user.passwordHash));
      } catch (error) {
        if (error instanceof UnauthorizedException) valid = false;
        else throw error;
      }
    }
    await tx.auditLog.create({ data: { module: "auth", action: valid ? "admin_client_session_reauthenticated" : "admin_client_session_reauthentication_failed",
      status: valid ? "success" : "failed", resourceType: "admin-auth", userId: claims.sub, resourceId: claims.sub,
      path: "/api/admin/clients/sessions/revoke", method: "POST", requestSummary: { correlationId: correlationId || "unavailable" } } });
    return valid;
  }
  async logout(claims: AdminSessionClaims, correlationId?: string) {
    await this.ensureDatabase();
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aij-admin-users-write'))`;
        await this.session(tx, claims);
        await tx.adminAuthSession.update({ where: { id: claims.sessionId }, data: { revokedAt: new Date(), revokeReason: "logout" } });
        await this.audit(tx, claims.sub, "logout", "/api/auth/logout", correlationId);
        return { revoked: true };
      });
    } catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException("Authentication service unavailable"); }
  }
  async changePassword(claims: AdminSessionClaims, dto: ChangePasswordDto, correlationId?: string) {
    if (!isAdminPassword(dto.newPassword) || Buffer.byteLength(dto.currentPassword, "utf8") > 72) throw new BadRequestException("Invalid password request");
    await this.ensureDatabase();
    try {
      const user = await this.prisma.sysUser.findFirst({ where: { id: claims.sub, status: "active", deletedAt: null, tokenVersion: claims.tokenVersion }, select: { passwordHash: true } });
      if (!user || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
        await this.prisma.$transaction(tx => this.audit(tx, claims.sub, "password_change_failed", "/api/auth/password", correlationId));
        throw new UnauthorizedException("Invalid credentials");
      }
      if (await bcrypt.compare(dto.newPassword, user.passwordHash)) throw new ConflictException("Password must change");
      const passwordHash = await bcrypt.hash(dto.newPassword, ADMIN_PASSWORD_COST);
      return await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('aij-admin-users-write'))`;
        await this.session(tx, claims);
        const changed = await tx.sysUser.updateMany({ where: { id: claims.sub, status: "active", deletedAt: null, passwordHash: user.passwordHash, tokenVersion: claims.tokenVersion }, data: { passwordHash, tokenVersion: { increment: 1 } } });
        if (changed.count !== 1) throw new UnauthorizedException("Invalid credentials");
        await tx.adminAuthSession.updateMany({ where: { userId: claims.sub, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "password_changed" } });
        await this.audit(tx, claims.sub, "password_changed", "/api/auth/password", correlationId);
        return { changed: true, reauthenticationRequired: true };
      });
    } catch (error) { if (error instanceof HttpException) throw error; throw new ServiceUnavailableException("Authentication service unavailable"); }
  }
}
