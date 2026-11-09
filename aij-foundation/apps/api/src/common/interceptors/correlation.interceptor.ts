import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Observable } from "rxjs";
import { correlateRequest } from "@aij/core";
export { correlateRequest, resolveCorrelationId } from "@aij/core";

@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined>; correlationId?: string }>();
    const response = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();
    correlateRequest(request, response);
    return next.handle();
  }
}
