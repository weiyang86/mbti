// Directed adaptation of source cd8d006 ClientAuth security; no product constants/fallbacks.
import { createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const CLIENT_JWT_SERVICE = Symbol("AIJ_CLIENT_JWT_SERVICE");
export const CLIENT_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const clientAudience = (namespace: string) => "urn:aij:" + namespace + ":client";
export const clientIssuer = (issuer: string) => issuer + ":client";
export const hashClientContext = (secret: string, namespace: string, scope: string, value: string) =>
  createHmac("sha256", secret).update(JSON.stringify([namespace, scope, value])).digest("hex");
export const createClientOneTimeToken = () => randomBytes(32).toString("base64url");
export const hashClientOneTimeToken = (secret: string, purpose: string, token: string) =>
  createHmac("sha256", secret).update(JSON.stringify([purpose, token])).digest("hex");

export { readSessionCookie as readClientCookie } from "../common/session-cookie";
export function clientCookieHeader(name: string, token: string, production: boolean): string {
  return name + "=" + token + "; Path=/api/client; HttpOnly; SameSite=Strict; Max-Age=" + CLIENT_SESSION_SECONDS + (production ? "; Secure" : "");
}
export function expiredClientCookieHeader(name: string, production: boolean): string {
  return name + "=; Path=/api/client; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT" + (production ? "; Secure" : "");
}
export type ClientPrincipal = Readonly<{ id: string; email: string | null; nickname: string }>;
export type ClientClaims = Readonly<{ sub: string; sessionId: string; tokenVersion: number }>;
export type ClientWorkspaceContext = Readonly<{
  workspaceId: string;
  workspaceCode: string;
  workspaceName: string;
  roleId: string;
  roleCode: string;
  permissions: readonly string[];
}>;
export type ClientRequest = IncomingMessage & {
  client?: ClientPrincipal;
  clientClaims?: ClientClaims;
  workspaceContext?: ClientWorkspaceContext;
  correlationId?: string;
};
