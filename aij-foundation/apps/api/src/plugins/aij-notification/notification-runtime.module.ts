import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { SecretCenterModule } from "../../secret-center/secret-center.module";
import { SecretRefPort } from "../../secret-center/secret-ref";
import { WebhookNotificationPolicy } from "./webhook-notification-policy";
import { WebhookNotificationProvider } from "./webhook-notification-provider";
import { AsyncRuntimeModule } from "../../async-runtime/async-runtime.module";
import { PluginRuntimeAccessModule } from "../../plugin-runtime/plugin-runtime-access.module";
import { NotificationProviderRegistry } from "./notification-provider";
import { NotificationDeliveryService } from "./notification-delivery.service";

@Module({
  imports: [AsyncRuntimeModule, PluginRuntimeAccessModule, SecretCenterModule],
  providers: [
    {
      provide: NotificationProviderRegistry,
      inject: [PrismaService, PluginRuntimeAccessService, SecretRefPort],
      useFactory: (prisma: PrismaService, plugins: PluginRuntimeAccessService, secrets: SecretRefPort) => {
        const policy = WebhookNotificationPolicy.fromEnvironment(process.env);
        return new NotificationProviderRegistry(policy ? [new WebhookNotificationProvider(prisma, plugins, secrets, policy)] : []);
      }
    },
    NotificationDeliveryService
  ],
  exports: [NotificationDeliveryService, NotificationProviderRegistry]
})
export class NotificationRuntimeModule {}
