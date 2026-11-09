import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { RbacModule } from "../rbac/rbac.module";
import { FilesModule } from "./files.module";
import { AdminFilesController } from "./admin-files.controller";
import { AdminFilesService } from "./admin-files.service";

@Module({ imports: [AuthModule, RbacModule, FilesModule], controllers: [AdminFilesController], providers: [AdminFilesService] })
export class AdminFilesModule {}
