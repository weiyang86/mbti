import { ForbiddenException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { ADMIN_TOKEN_SECONDS, AdminSessionClaims } from "./auth.types";

export const adminCookieName = (config: ConfigService) => config.getOrThrow<string>("cookiePrefix") + "_admin_session";
export const adminCookie = (config: ConfigService, token: string, clear = false) =>
  adminCookieName(config) + "=" + token + "; Path=/api; HttpOnly; SameSite=Strict; Max-Age=" + (clear ? 0 : ADMIN_TOKEN_SECONDS) +
  (config.getOrThrow<string>("environment") === "production" ? "; Secure" : "");
export function requireBrowserOrigin(request: IncomingMessage, webUrl: string) {
  if (request.headers.origin !== webUrl || request.headers["sec-fetch-site"] === "cross-site") throw new ForbiddenException("Invalid browser origin");
}
export function csrfToken(secret: string, namespace: string, claims: AdminSessionClaims) {
  return createHmac("sha256", secret).update(JSON.stringify(["aij-admin-csrf-v1", namespace, claims.sub, claims.sessionId, claims.tokenVersion])).digest("base64url");
}
export function requireCsrf(input: string | string[] | undefined, expected: string) {
  if (typeof input !== "string" || !/^[-_A-Za-z0-9]{43}$/.test(input) || input.length !== expected.length || !timingSafeEqual(Buffer.from(input), Buffer.from(expected))) throw new ForbiddenException("Invalid CSRF token");
}
