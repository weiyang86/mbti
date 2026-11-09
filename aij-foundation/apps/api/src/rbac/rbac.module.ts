import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AdminAuthorizationGuard } from "../common/guards/admin-authorization.guard";
import { AuthModule } from "../auth/auth.module";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { PermissionsService } from "./permissions.service";
import { RbacController } from "./rbac.controller";

import { ManagementAccessService } from "./management-access.service";
import { RbacManagementService } from "./management.service";
import { RolesController, PermissionManagementController } from "./management.controller";

@Module({ imports: [AuthModule], controllers: [RbacController, RolesController, PermissionManagementController], providers: [PermissionsService, PermissionsGuard, ManagementAccessService, RbacManagementService, AdminAuthorizationGuard, { provide: APP_GUARD, useExisting: AdminAuthorizationGuard }], exports: [PermissionsService, PermissionsGuard, ManagementAccessService, RbacManagementService, AdminAuthorizationGuard] })
export class RbacModule {}
