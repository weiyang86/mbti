import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { createSuccessEnvelope } from "@aij/contracts";
import { Observable, map } from "rxjs";

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (Reflect.getMetadata("mbti.raw-response", context.getClass())) return next.handle();
    return next.handle().pipe(map((data: unknown) => createSuccessEnvelope(data)));
  }
}
