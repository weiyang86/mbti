import { ArgumentsHost, CanActivate, Catch, ExceptionFilter, ExecutionContext, HttpException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { IncomingMessage, ServerResponse } from "node:http";

export type GuestRequest = IncomingMessage & { mbtiOwnerId: string };
export const MBTI_RAW = "mbti.raw-response";
export function reject(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}

@Injectable()
export class MbtiGuestGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<GuestRequest>();
    const token = request.headers["x-guest-token"];
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{64}$/.test(token)) reject(401, "GUEST_UNAUTHORIZED", "游客凭证缺失或已失效");
    const guest = await this.prisma.mbtiGuest.findUnique({ where: { tokenHash: createHash("sha256").update(token).digest("hex") } });
    if (!guest || guest.expiresAt <= new Date()) reject(401, "GUEST_UNAUTHORIZED", "游客凭证缺失或已失效");
    request.mbtiOwnerId = guest.id;
    return true;
  }
}

@Catch()
export class MbtiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const body = error instanceof HttpException ? error.getResponse() : null;
    const payload = body && typeof body === "object" && "code" in body ? body : {
      code: status === 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST",
      message: status === 500 ? "服务暂时不可用" : "请求格式不正确"
    };
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify(payload));
  }
}

// Parser failures happen before controller-scoped filters and must keep the same public error shape.
export function mbtiParserErrorMiddleware(error: unknown, request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) {
  if (!/^\/api\/v1(?:[/?]|$)/.test(request.url ?? "")) { next(error); return; }
  const candidate = error as { status?: number };
  if (![400, 413].includes(candidate?.status ?? 0)) { next(error); return; }
  response.statusCode = candidate.status!;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({ code: candidate.status === 413 ? "BODY_TOO_LARGE" : "INVALID_JSON", message: "请求 JSON 格式或大小不正确" }));
}
