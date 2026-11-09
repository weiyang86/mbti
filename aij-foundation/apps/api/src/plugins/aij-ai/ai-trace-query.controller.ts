import { Controller, Get, Header, Query, Req, Type, ValidationPipe } from "@nestjs/common";
import type { AdminRequest } from "../../auth/auth.types";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { RUNTIME_READ_PERMISSION } from "../../../../../scripts/runtime-policy.cjs";
import { AiTraceQueryDto } from "./ai-trace-query.dto";
import { AiTraceQueryService } from "./ai-trace-query.service";

const strict = new ValidationPipe({ expectedType: AiTraceQueryDto as Type<object>, whitelist: true, forbidNonWhitelisted: true, transform: true });

@Controller("admin/ai/traces")
@Permissions(RUNTIME_READ_PERMISSION)
export class AiTraceQueryController {
  constructor(private readonly traces: AiTraceQueryService) {}

  @Get() @Header("Cache-Control", "no-store")
  list(@Query(strict) query: object, @Req() request: AdminRequest) {
    return this.traces.list(query as AiTraceQueryDto, request.user!.id);
  }
}
