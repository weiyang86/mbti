import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, Type, ValidationPipe } from "@nestjs/common";
import type { AdminRequest } from "../auth/auth.types";
import { AdminIdDto, AdminListDto } from "../admin/dto";
import { Permissions } from "../common/decorators/permissions.decorator";
import { SECRET_PERMISSION } from "../../../../scripts/secret-policy.cjs";
import { CreateSecretReferenceDto, RotateSecretReferenceDto, SecretVersionDto } from "./dto";
import { SecretCenterService } from "./secret-center.service";
const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });
@Controller("admin/secret-references")
@Permissions(SECRET_PERMISSION)
export class SecretCenterController {
  constructor(private readonly secrets: SecretCenterService) {}
  @Get() @Header("Cache-Control", "no-store")
  list(@Query(strict(AdminListDto)) q: object) { return this.secrets.list(q as AdminListDto); }
  @Get(":id") @Header("Cache-Control", "no-store")
  detail(@Param() p: AdminIdDto) { return this.secrets.detail(p.id); }
  @Post() @Header("Cache-Control", "no-store")
  create(@Body(strict(CreateSecretReferenceDto)) d: object, @Req() r: AdminRequest) { return this.secrets.create(d as CreateSecretReferenceDto, r.user!.id, r.correlationId); }
  @Post(":id/rotate") @HttpCode(200) @Header("Cache-Control", "no-store")
  rotate(@Param() p: AdminIdDto, @Body(strict(RotateSecretReferenceDto)) d: object, @Req() r: AdminRequest) { return this.secrets.rotate(p.id, d as RotateSecretReferenceDto, r.user!.id, r.correlationId); }
  @Post(":id/clear") @HttpCode(200) @Header("Cache-Control", "no-store")
  clear(@Param() p: AdminIdDto, @Body(strict(SecretVersionDto)) d: object, @Req() r: AdminRequest) { return this.secrets.clear(p.id, d as SecretVersionDto, r.user!.id, r.correlationId); }
  @Post(":id/check") @HttpCode(200) @Header("Cache-Control", "no-store")
  check(@Param() p: AdminIdDto, @Body(strict(SecretVersionDto)) d: object, @Req() r: AdminRequest) { return this.secrets.check(p.id, d as SecretVersionDto, r.user!.id, r.correlationId); }
}
