import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { readApplicationEnvironment } from "../../../../scripts/runtime-environment.cjs";
import { AuthErrorsModule } from "../auth/auth-errors.module";
import { ClientAuthController } from "./client-auth.controller";
import { ClientAuthGuard } from "./client-auth.guard";
import { ClientAuthNotificationAdapter } from "./client-auth-notification.adapter";
import { ClientAuthService } from "./client-auth.service";
import { CLIENT_JWT_SERVICE, CLIENT_SESSION_SECONDS, clientAudience, clientIssuer } from "./client-auth.security";

@Module({
  imports: [AuthErrorsModule],
  controllers: [ClientAuthController],
  providers: [
    { provide: CLIENT_JWT_SERVICE, inject: [ConfigService], useFactory: (config: ConfigService) => {
      const secret = readApplicationEnvironment().CLIENT_JWT_SECRET;
      if (!secret) throw new Error("CLIENT_JWT_SECRET is required");
      const issuer = clientIssuer(config.getOrThrow("issuer")), audience = clientAudience(config.getOrThrow("namespace"));
      return new JwtService({ secret, signOptions: { algorithm: "HS256", expiresIn: CLIENT_SESSION_SECONDS, issuer, audience },
        verifyOptions: { algorithms: ["HS256"], issuer, audience } });
    } },
    ClientAuthService, ClientAuthGuard, ClientAuthNotificationAdapter
  ],
  exports: [CLIENT_JWT_SERVICE, ClientAuthService, ClientAuthGuard]
})
export class ClientAuthModule {}
