import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { ClientAuthService } from "./client-auth.service";
import { CLIENT_JWT_SERVICE, CLIENT_SESSION_SECONDS, ClientClaims, ClientRequest, clientAudience, clientIssuer, readClientCookie } from "./client-auth.security";

@Injectable()
export class ClientAuthGuard implements CanActivate {
  constructor(@Inject(CLIENT_JWT_SERVICE) private readonly jwt: JwtService, private readonly auth: ClientAuthService, private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ClientRequest>();
    const token = readClientCookie(request.headers.cookie, this.config.getOrThrow("clientSessionCookie"));
    if (!token) throw new UnauthorizedException("Invalid client session");
    let claims: ClientClaims;
    try {
      const payload = await this.jwt.verifyAsync<Record<string, unknown>>(token), now = Math.floor(Date.now() / 1000);
      if (payload.tokenKind !== "client" || payload.projectId !== this.config.getOrThrow("projectId") || payload.environment !== this.config.getOrThrow("environment") ||
          payload.iss !== clientIssuer(this.config.getOrThrow("issuer")) || payload.aud !== clientAudience(this.config.getOrThrow("namespace")) ||
          typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128 || typeof payload.sessionId !== "string" || !payload.sessionId || payload.sessionId.length > 128 ||
          typeof payload.tokenVersion !== "number" || !Number.isSafeInteger(payload.tokenVersion) || payload.tokenVersion < 0 ||
          typeof payload.iat !== "number" || !Number.isInteger(payload.iat) || payload.iat > now + 5 || typeof payload.exp !== "number" || !Number.isInteger(payload.exp) ||
          payload.exp <= now || payload.exp <= payload.iat || payload.exp - payload.iat > CLIENT_SESSION_SECONDS) throw new Error("Invalid scoped claims");
      claims = { sub: payload.sub, sessionId: payload.sessionId, tokenVersion: payload.tokenVersion };
    } catch { throw new UnauthorizedException("Invalid client session"); }
    request.client = await this.auth.authenticate(claims);
    request.clientClaims = claims;
    return true;
  }
}
