import type { IncomingMessage } from "node:http";

export const ADMIN_TOKEN_SECONDS = 900;
export const adminAudience = (namespace: string) => "urn:aij:" + namespace + ":admin";
export type AdminPrincipal = Readonly<{ id: string; username: string; realName: string; isSuperAdmin: boolean }>;
export type AdminSessionClaims = { sub: string; sessionId: string; tokenVersion: number; transport: "bearer" | "cookie" };
export type AdminRequest = IncomingMessage & { user?: AdminPrincipal; adminSession?: AdminSessionClaims; correlationId?: string };
