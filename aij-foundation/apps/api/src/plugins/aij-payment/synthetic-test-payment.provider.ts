import { PaymentProvider, PaymentProviderQuery, PaymentProviderRequest } from "./payment-provider";

/** Deterministic offline protocol adapter. Runtime module registers it only for NODE_ENV=APP_ENV=test. */
export class SyntheticTestPaymentProvider implements PaymentProvider {
  readonly providerCode = "synthetic-test";
  readonly calls: PaymentProviderRequest[] = [];
  failNext = false;

  async createPayment(request: PaymentProviderRequest, credential: string): Promise<unknown> {
    if (credential !== "synthetic-only-no-provider-secret") throw new Error("Synthetic credential marker rejected");
    this.calls.push(request);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("synthetic provider timeout detail");
    }
    return { providerReference: "synthetic-ref-" + request.paymentOrderId, status: "pending", observedAt: new Date().toISOString() };
  }

  async queryPayment(request: PaymentProviderQuery, credential: string): Promise<unknown> {
    if (credential !== "synthetic-only-no-provider-secret") throw new Error("Synthetic credential marker rejected");
    return { providerReference: request.providerReference, status: "pending", observedAt: new Date().toISOString() };
  }
}
