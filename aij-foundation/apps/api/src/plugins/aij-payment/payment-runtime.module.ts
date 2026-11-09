import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClientAuthModule } from "../../client-auth/client-auth.module";
import { ClientWorkspacesModule } from "../../client-workspaces/client-workspaces.module";
import { WorkspaceContextGuard } from "../../client-workspaces/workspace-context.guard";
import { PluginRuntimeAccessModule } from "../../plugin-runtime/plugin-runtime-access.module";
import { RbacModule } from "../../rbac/rbac.module";
import { PaymentProviderRegistry } from "./payment-provider";
import { PaymentCredentialResolver, PAYMENT_CREDENTIAL_RESOLVER, PAYMENT_PAYABLE_SOURCE, PaymentPayableSource, SyntheticTestPaymentPayableSource, UnavailablePaymentCredentialResolver, UnavailablePaymentPayableSource } from "./payment-payable-source";
import { PaymentController } from "./payment.controller";
import { PaymentCallbackController } from "./payment-callback.controller";
import { PaymentCallbackService } from "./payment-callback.service";
import { PaymentAdminController } from "./payment-admin.controller";
import { PaymentAdminService } from "./payment-admin.service";
import { PaymentReconciliationController } from "./payment-reconciliation.controller";
import { PaymentReconciliationService } from "./payment-reconciliation.service";
import { PaymentService } from "./payment.service";
import { SyntheticTestPaymentProvider } from "./synthetic-test-payment.provider";

function isTestRuntime(config: ConfigService): boolean {
  return config.get<string>("nodeEnv") === "test" && config.get<string>("environment") === "test";
}

@Module({
  imports: [ClientAuthModule, ClientWorkspacesModule, PluginRuntimeAccessModule, RbacModule],
  controllers: [PaymentController, PaymentCallbackController, PaymentAdminController, PaymentReconciliationController],
  providers: [
    {
      provide: PAYMENT_PAYABLE_SOURCE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PaymentPayableSource => isTestRuntime(config) ? new SyntheticTestPaymentPayableSource() : new UnavailablePaymentPayableSource()
    },
    {
      provide: PAYMENT_CREDENTIAL_RESOLVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PaymentCredentialResolver => isTestRuntime(config)
        ? { async resolve(reference: string) { if (reference !== "test-only:payment-fixture") throw new Error("Fixture credential reference rejected"); return "synthetic-only-no-provider-secret"; } }
        : new UnavailablePaymentCredentialResolver()
    },
    {
      provide: PaymentProviderRegistry,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new PaymentProviderRegistry(isTestRuntime(config) ? [new SyntheticTestPaymentProvider()] : [])
    },
    WorkspaceContextGuard,
    PaymentService,
    PaymentCallbackService,
    PaymentAdminService,
    PaymentReconciliationService
  ],
  exports: [PaymentService]
})
export class PaymentRuntimeModule {}
