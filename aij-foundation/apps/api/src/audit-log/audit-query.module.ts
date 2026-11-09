import { Module } from "@nestjs/common";
import { RbacModule } from "../rbac/rbac.module";
import { AuditQueryController } from "./audit-query.controller";
import { AuditQueryService } from "./audit-query.service";
@Module({ imports: [RbacModule], controllers: [AuditQueryController], providers: [AuditQueryService], exports: [AuditQueryService] })
export class AuditQueryModule {}
