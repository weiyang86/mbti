import { ArgumentsHost, Catch, HttpException, Injectable } from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";

// Identity and core permission responses share one safe error owner; readiness keeps its contract.
@Catch()
@Injectable()
export class AuthExceptionFilter extends BaseExceptionFilter {
  constructor(private readonly adapters: HttpAdapterHost) { super(adapters.httpAdapter); }

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const url = http.getRequest<{ url: string }>().url;
    if (!/^\/api\/(?:auth|admin|client|dictionaries|project)(?:\/|\?|$)/i.test(url)) return super.catch(exception, host);
    const oversizedBody = exception instanceof Error && "type" in exception && exception.type === "entity.too.large" &&
      "status" in exception && exception.status === 413;
    const code = exception instanceof HttpException ? exception.getStatus() : oversizedBody ? 413 : 503;
    const status = [400, 401, 403, 404, 405, 409, 410, 413, 415, 429].includes(code) ? code : 503;
    const message = status === 401 ? "Invalid credentials or authorization" : status === 403 ? "Permission denied" : status === 409 ? "Management state conflict" : status === 410 ? "Resource expired" : status === 404 ? "Resource not found" : status === 503 ? "Service unavailable" : "Invalid request";
    const response = http.getResponse<{ getHeader?: (name: string) => unknown }>();
    const cache = response.getHeader?.("Cache-Control");
    // Preserve an endpoint's stricter private policy, while all errors still forbid storage.
    const privateResponse = typeof cache === "string" && cache.split(",").some(value => value.trim().toLowerCase() === "private");
    this.adapters.httpAdapter.setHeader(response, "Cache-Control", privateResponse ? "private, no-store" : "no-store");
    this.adapters.httpAdapter.reply(http.getResponse(), { success: false, data: null, message }, status);
  }
}
