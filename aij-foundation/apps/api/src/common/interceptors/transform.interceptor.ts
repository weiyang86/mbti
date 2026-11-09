import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { createSuccessEnvelope } from "@aij/contracts";
import { Observable, map } from "rxjs";

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data: unknown) => createSuccessEnvelope(data)));
  }
}
