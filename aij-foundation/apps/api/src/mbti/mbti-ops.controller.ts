import { Controller, Get, Header, Req } from "@nestjs/common";
import type { AdminRequest } from "../auth/auth.types";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PermissionsService } from "../rbac/permissions.service";
import { capabilities, grants } from "../../../../scripts/mbti/ops-policy.cjs";

// Foundation's global AdminAuthorizationGuard authenticates and checks live DB grants.
// No role supplied by the browser is read. No business config or private user fields.
@Controller("admin/mbti/ops")
export class MbtiOpsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get("session")
  @Permissions("mbti:ops:access")
  @Header("Cache-Control", "no-store")
  async session(@Req() request: AdminRequest) {
    const current = await this.permissions.current(request.user!.id);
    const allowed = capabilities(current.effectivePermissions);
    return { user: request.user, platformSuperAdmin: current.isSuperAdmin,
      role: allowed.systemWrite ? "owner" : allowed.draft ? "editor" : allowed.fulfillment ? "support" : "reader",
      capabilities: allowed,
      permissions: current.effectivePermissions.filter(code => [...Object.values(grants), "admin.config.manage", "admin.secret.manage"].includes(code)),
      businessStage: "UI_CONTRACT" };
  }

  @Get("system-context")
  @Permissions("mbti:ops:access", "mbti:ops:system:read")
  @Header("Cache-Control", "no-store")
  systemContext() {
    // Explicit integration boundary, not a fabricated health check of a provider.
    return { stage: "UI_CONTRACT", configurationAvailable: false, reason: "CONFIGURATION_PLUGIN_NOT_CONNECTED" };
  }
}
