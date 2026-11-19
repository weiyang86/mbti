import { Controller, Get, Header, Param, Query, Req, ValidationPipe } from "@nestjs/common";
import { AUDIT_PERMISSION } from "../../../../scripts/audit-policy.cjs";
import { AdminIdDto } from "../admin/dto";
import type { AdminRequest } from "../auth/auth.types";
import { Permissions } from "../common/decorators/permissions.decorator";
import { AuditQueryService } from "./audit-query.service";
import { AuditQueryDto } from "./dto";
@Controller("admin/logs")
@Permissions(AUDIT_PERMISSION)
export class AuditQueryController {
  constructor(private readonly audit: AuditQueryService) {}
  @Get() @Header("Cache-Control", "no-store")
  list(@Query(new ValidationPipe({ expectedType: AuditQueryDto, whitelist: true, forbidNonWhitelisted: true, transform: true })) q: object, @Req() r: AdminRequest) { return this.audit.list(q as AuditQueryDto, r.user!.id); }
  @Get(":id") @Header("Cache-Control", "no-store")
  detail(@Param() p: AdminIdDto, @Req() r: AdminRequest) { return this.audit.detail(p.id, r.user!.id); }
}
