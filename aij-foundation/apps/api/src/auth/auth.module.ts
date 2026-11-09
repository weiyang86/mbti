// Adapted from cd8d006; no development fallback or source product issuer.
import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { readApplicationEnvironment } from "../../../../scripts/runtime-environment.cjs";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthErrorsModule } from "./auth-errors.module";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ADMIN_TOKEN_SECONDS, adminAudience } from "./auth.types";

@Module({
  imports: [AuthErrorsModule, JwtModule.registerAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const secret = readApplicationEnvironment().JWT_SECRET;
      if (!secret) throw new Error("JWT_SECRET is required for administrator authentication");
      const issuer = config.getOrThrow<string>("issuer"), audience = adminAudience(config.getOrThrow<string>("namespace"));
      return { secret, signOptions: { expiresIn: ADMIN_TOKEN_SECONDS, algorithm: "HS256", issuer, audience }, verifyOptions: { algorithms: ["HS256"], issuer, audience } };
    }
  })],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [JwtModule, AuthService, JwtAuthGuard]
})
export class AuthModule {}
