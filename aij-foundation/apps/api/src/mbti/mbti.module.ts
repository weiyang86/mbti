import { DynamicModule, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MbtiController } from "./mbti.controller";
import { MbtiGuestGuard } from "./mbti.http";
import { MbtiService } from "./mbti.service";
import { MbtiShareService } from "./mbti-share.service";
import { MbtiOrdersService } from "./mbti-orders.service";
import { MbtiOrdersAdminController, MbtiOrdersController } from "./mbti-orders.controller";
import { RbacModule } from "../rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";
import { loadRuntimeEnvironment, readApplicationEnvironment } from "../../../../scripts/runtime-environment.cjs";
import { MbtiTestCallbackController, MbtiTestPayableSource, MbtiTestPaymentAdminController, MbtiTestPaymentService } from "./mbti-test-payment";
import { PAYMENT_CREDENTIAL_RESOLVER, PAYMENT_PAYABLE_SOURCE } from "../plugins/aij-payment/payment-payable-source";
import { PaymentProviderRegistry, PaymentProviderQuery, PaymentProviderRequest } from "../plugins/aij-payment/payment-provider";
import { SyntheticTestPaymentProvider } from "../plugins/aij-payment/synthetic-test-payment.provider";
import { PaymentService } from "../plugins/aij-payment/payment.service";
import { PaymentCallbackService } from "../plugins/aij-payment/payment-callback.service";
import { PluginRuntimeAccessModule } from "../plugin-runtime/plugin-runtime-access.module";

class MbtiControlledTestProvider extends SyntheticTestPaymentProvider {
  override createPayment(request: PaymentProviderRequest, _credential: string) { return super.createPayment(request, "synthetic-only-no-provider-secret"); }
  override queryPayment(request: PaymentProviderQuery, _credential: string) { return super.queryPayment(request, "synthetic-only-no-provider-secret"); }
}

@Module({})
export class MbtiModule {
  static forRoot(runtime: ReturnType<typeof loadRuntimeEnvironment>): DynamicModule {
    const secret = readApplicationEnvironment().MBTI_F3_TEST_PAYMENT_SECRET;
    if (secret && (runtime.nodeEnv !== "test" || runtime.environment !== "test" || !runtime.capabilities.auth || secret.length < 32)) {
      throw new Error("MBTI controlled payments require explicit isolated test runtime, administrator auth and a local random secret");
    }
    return { module: MbtiModule,
      imports: [...(runtime.capabilities.auth ? [AuthModule, RbacModule] : []), ...(secret ? [PluginRuntimeAccessModule] : [])],
      controllers: [MbtiController, MbtiOrdersController, ...(runtime.capabilities.auth ? [MbtiOrdersAdminController] : []),
        ...(secret ? [MbtiTestPaymentAdminController, MbtiTestCallbackController] : [])],
      providers: [MbtiService, MbtiShareService, MbtiGuestGuard, MbtiOrdersService, ...(secret ? [
        MbtiTestPayableSource, { provide: PAYMENT_PAYABLE_SOURCE, useExisting: MbtiTestPayableSource },
        { provide: PAYMENT_CREDENTIAL_RESOLVER, useValue: { async resolve(reference: string) {
          if (reference !== "test-only:mbti-f3-payment") throw new Error("Controlled fixture credential rejected");
          return secret;
        } } },
        { provide: PaymentProviderRegistry, useFactory: () => new PaymentProviderRegistry([new MbtiControlledTestProvider()]) },
        PaymentService, PaymentCallbackService, MbtiTestPaymentService
      ] : [])], exports: [MbtiService, MbtiGuestGuard] };
  }
}
