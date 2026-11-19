import { Module } from "@nestjs/common";
import { RbacModule } from "../rbac/rbac.module";
import { MenusController } from "./menus.controller";
import { MenusService } from "./menus.service";
import { MenuAvailabilityService } from "./menu-availability.service";
@Module({ imports: [RbacModule], controllers: [MenusController], providers: [MenusService, MenuAvailabilityService], exports: [MenusService, MenuAvailabilityService] })
export class MenusModule {}
