import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { RbacModule } from "../../rbac/rbac.module";
import { PluginRuntimeAccessModule } from "../../plugin-runtime/plugin-runtime-access.module";
import { MbtiConfigController } from "./mbti-config.controller";
import { MbtiConfigService } from "./mbti-config.service";
@Module({ imports: [AuthModule, RbacModule, PluginRuntimeAccessModule], controllers: [MbtiConfigController], providers: [MbtiConfigService], exports: [MbtiConfigService] })
export class MbtiConfigModule {}
