import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ClientAuthModule } from "../client-auth/client-auth.module";
import { RbacModule } from "../rbac/rbac.module";
import { AdminClientDirectoryController } from "./admin-client-directory.controller";
import { AdminClientDirectoryService } from "./admin-client-directory.service";

@Module({ imports: [AuthModule, ClientAuthModule, RbacModule], controllers: [AdminClientDirectoryController], providers: [AdminClientDirectoryService] })
export class AdminClientDirectoryModule {}
