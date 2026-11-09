import { Controller, Get, Header, Req } from "@nestjs/common";
import type { AdminRequest } from "../../auth/auth.types";
import { Permissions } from "../../common/decorators/permissions.decorator";
import { RUNTIME_READ_PERMISSION } from "../../../../../scripts/runtime-policy.cjs";
import { AiCenterUsageService } from "./ai-center-usage.service";
@Controller("admin/ai/center/usage")
@Permissions(RUNTIME_READ_PERMISSION)
export class AiCenterUsageController {
 constructor(private readonly usage: AiCenterUsageService) {}
 @Get() @Header("Cache-Control", "no-store")
 read(@Req() r: AdminRequest) { return this.usage.read(r.user!.id); }
}
