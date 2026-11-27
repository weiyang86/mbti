import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { RbacModule } from "../../rbac/rbac.module";
import { PluginRuntimeAccessModule } from "../../plugin-runtime/plugin-runtime-access.module";
import { SecretCenterModule } from "../../secret-center/secret-center.module";
import { MbtiConfigPublicController } from "./mbti-config.public.controller";
import { MbtiConfigController } from "./mbti-config.controller";
import { MbtiConfigService } from "./mbti-config.service";
@Module({ imports: [AuthModule, RbacModule, PluginRuntimeAccessModule, SecretCenterModule], controllers: [MbtiConfigController, MbtiConfigPublicController], providers: [MbtiConfigService], exports: [MbtiConfigService] })
export class MbtiConfigModule {}
