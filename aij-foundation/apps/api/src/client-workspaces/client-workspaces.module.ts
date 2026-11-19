import { Module } from "@nestjs/common";
import { ClientAuthModule } from "../client-auth/client-auth.module";
import { ClientWorkspaceContextController } from "./client-workspace-context.controller";
import { ClientWorkspaceManagementController } from "./client-workspace-management.controller";
import { ClientWorkspaceManagementService } from "./client-workspace-management.service";
import { WorkspaceContextGuard } from "./workspace-context.guard";
import { WorkspaceContextService } from "./workspace-context.service";

@Module({
  imports: [ClientAuthModule],
  controllers: [ClientWorkspaceContextController, ClientWorkspaceManagementController],
  providers: [WorkspaceContextGuard, WorkspaceContextService, ClientWorkspaceManagementService],
  exports: [WorkspaceContextGuard, WorkspaceContextService]
})
export class ClientWorkspacesModule {}
