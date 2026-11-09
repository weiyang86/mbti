import { Controller, Get, Header, Req } from "@nestjs/common";
import type { AdminRequest } from "../auth/auth.types";
import { AuthenticatedAdmin } from "../common/decorators/authenticated-admin.decorator";
import { Permissions } from "../common/decorators/permissions.decorator";
import { PermissionsService } from "./permissions.service";

@Controller("admin/permissions")
export class RbacController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get("my")
  @AuthenticatedAdmin()
  @Header("Cache-Control", "no-store")
  current(@Req() request: AdminRequest) { return this.permissions.current(request.user!.id); }

  // Existing bootstrap data permission now protects this limited read-only catalog.
  // No CRUD/menu permission or business API is implied by this binding.
  @Get()
  @Header("Cache-Control", "no-store")
  @Permissions("aij.bootstrap.admin")
  catalog() { return this.permissions.catalog(); }
}
