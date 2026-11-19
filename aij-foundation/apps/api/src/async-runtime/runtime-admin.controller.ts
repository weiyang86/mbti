import { Controller, Get, Header, Param, Query, Req, Res, Type, ValidationPipe, Post } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import type { AdminRequest } from "../auth/auth.types";
import { Permissions } from "../common/decorators/permissions.decorator";
import { RUNTIME_MANAGE_PERMISSION, RUNTIME_READ_PERMISSION } from "../../../../scripts/runtime-policy.cjs";
import { RuntimeAdminService } from "./runtime-admin.service";
import { RuntimeJobListDto, RuntimeOutboxListDto } from "./runtime-admin.dto";

const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });

@Controller("admin/runtime")
export class RuntimeAdminController {
  constructor(private readonly runtime: RuntimeAdminService) {}

  @Get("readiness") @Permissions(RUNTIME_READ_PERMISSION) @Header("Cache-Control", "no-store")
  async readiness(@Res({ passthrough: true }) response: ServerResponse) {
    const state = await this.runtime.readiness();
    if (!state.ready) response.statusCode = 503;
    return state;
  }

  @Get("jobs") @Permissions(RUNTIME_READ_PERMISSION) @Header("Cache-Control", "no-store")
  jobs(@Query(strict(RuntimeJobListDto)) query: object) { return this.runtime.jobs(query as RuntimeJobListDto); }

  @Get("outbox") @Permissions(RUNTIME_READ_PERMISSION) @Header("Cache-Control", "no-store")
  outbox(@Query(strict(RuntimeOutboxListDto)) query: object) { return this.runtime.outbox(query as RuntimeOutboxListDto); }

  @Post("jobs/:id/retry") @Permissions(RUNTIME_MANAGE_PERMISSION) @Header("Cache-Control", "no-store")
  retryJob(@Param("id") id: string, @Req() request: AdminRequest) { return this.runtime.retryJob(id, request.user!.id, request.correlationId); }

  @Post("jobs/:id/cancel") @Permissions(RUNTIME_MANAGE_PERMISSION) @Header("Cache-Control", "no-store")
  cancelJob(@Param("id") id: string, @Req() request: AdminRequest) { return this.runtime.cancelJob(id, request.user!.id, request.correlationId); }

  @Post("outbox/:id/retry") @Permissions(RUNTIME_MANAGE_PERMISSION) @Header("Cache-Control", "no-store")
  retryOutbox(@Param("id") id: string, @Req() request: AdminRequest) { return this.runtime.retryOutbox(id, request.user!.id, request.correlationId); }
}
