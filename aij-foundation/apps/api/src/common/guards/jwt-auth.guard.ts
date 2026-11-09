import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "../../auth/auth.service";
import type { AdminRequest, AdminSessionClaims } from "../../auth/auth.types";
import { adminCookieName, requireBrowserOrigin, requireCsrf } from "../../auth/browser-session";
import { readSessionCookie } from "../session-cookie";
import { ADMIN_TOKEN_SECONDS, adminAudience } from "../../auth/auth.types";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly auth: AuthService, private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const authorization = request.headers.authorization;
    const cookie = readSessionCookie(request.headers.cookie, adminCookieName(this.config));
    if (authorization !== undefined && cookie) throw new UnauthorizedException("Ambiguous authorization");
    const transport = authorization !== undefined ? "bearer" : "cookie";
    const credential = transport === "bearer" ? authorization : cookie ? "Bearer " + cookie : undefined;
    if (typeof credential !== "string" || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(credential)) throw new UnauthorizedException("Invalid authorization");
    let claims: AdminSessionClaims;
    try {
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(credential.slice(7));
      const now = Math.floor(Date.now() / 1000);
      if (payload.tokenKind !== "admin" || payload.projectId !== this.config.getOrThrow("projectId") || payload.environment !== this.config.getOrThrow("environment") ||
          payload.iss !== this.config.getOrThrow("issuer") || payload.aud !== adminAudience(this.config.getOrThrow("namespace")) ||
          typeof payload.sessionId !== "string" || !/^[a-f0-9-]{36}$/.test(payload.sessionId) || !Number.isSafeInteger(payload.tokenVersion) || Number(payload.tokenVersion) < 0 || payload.transport !== transport ||
          typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128 ||
          typeof payload.iat !== "number" || !Number.isInteger(payload.iat) || payload.iat > now + 5 || typeof payload.exp !== "number" || !Number.isInteger(payload.exp) ||
          payload.exp <= now || payload.exp <= payload.iat || payload.exp - payload.iat > ADMIN_TOKEN_SECONDS) throw new Error("Invalid scoped administrator claims");
      claims = { sub: payload.sub, sessionId: payload.sessionId, tokenVersion: payload.tokenVersion as number, transport };
    } catch { throw new UnauthorizedException("Invalid authorization"); }
    if (transport === "cookie" && !["GET", "HEAD", "OPTIONS"].includes(request.method || "")) {
      requireBrowserOrigin(request, this.config.getOrThrow("webUrl"));
      requireCsrf(request.headers["x-aij-csrf"], this.auth.browserCsrf(claims));
    }
    request.user = await this.auth.authenticate(claims);
    request.adminSession = claims;
    return true;
  }
}
