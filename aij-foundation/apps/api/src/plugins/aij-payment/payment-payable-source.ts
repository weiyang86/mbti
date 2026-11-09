import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";

export const PAYMENT_PAYABLE_SOURCE = Symbol("AIJ_PAYMENT_PAYABLE_SOURCE");
export const PAYMENT_CREDENTIAL_RESOLVER = Symbol("AIJ_PAYMENT_CREDENTIAL_RESOLVER");

export type PaymentPayableLookup = Readonly<{
  projectId: string;
  workspaceId: string;
  memberId: string;
  payableReference: string;
}>;

/** A trusted business owner supplies the payable snapshot. Client DTOs never contain price fields. */
export type PaymentPayableSnapshot = Readonly<{
  owner: string;
  reference: string;
  amountMinor: string;
  currency: string;
  currencyExponent: number;
  providerCode: string;
  credentialRef: string;
}>;

export interface PaymentPayableSource {
  resolve(input: PaymentPayableLookup): Promise<unknown>;
}

export interface PaymentCredentialResolver {
  resolve(reference: string): Promise<string>;
}

/** Production stays closed until a real business payable owner and SecretRef resolver are wired. */
export class UnavailablePaymentPayableSource implements PaymentPayableSource {
  async resolve(_input: PaymentPayableLookup): Promise<unknown> {
    throw new ServiceUnavailableException("Payment payable source is unavailable");
  }
}

export class UnavailablePaymentCredentialResolver implements PaymentCredentialResolver {
  async resolve(_reference: string): Promise<string> {
    throw new ServiceUnavailableException("Payment credential is unavailable");
  }
}

/** Synthetic lookup exists only in a test runtime and is not a customer/product price list. */
export class SyntheticTestPaymentPayableSource implements PaymentPayableSource {
  async resolve(input: PaymentPayableLookup): Promise<unknown> {
    if (!input.projectId || !input.workspaceId || !input.memberId) throw new NotFoundException("Payment payable is unavailable");
    const amounts: Record<string, string> = {
      "synthetic-plan-fee": "2599",
      "synthetic-other-fee": "3999"
    };
    const amountMinor = amounts[input.payableReference];
    if (!amountMinor) throw new NotFoundException("Payment payable is unavailable");
    return Object.freeze({
      owner: "aij-payment-test-fixture",
      reference: input.payableReference,
      amountMinor,
      currency: "CNY",
      currencyExponent: 2,
      providerCode: "synthetic-test",
      credentialRef: "test-only:payment-fixture"
    });
  }
}

/** Validate the trusted source boundary and freeze the exact server-owned snapshot. */
export function validatePaymentPayableSnapshot(input: unknown, expectedReference: string): PaymentPayableSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ServiceUnavailableException("Payment payable source response is invalid");
  const value = input as Record<string, unknown>;
  const allowed = ["owner", "reference", "amountMinor", "currency", "currencyExponent", "providerCode", "credentialRef"];
  if (Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key)) ||
      typeof value.owner !== "string" || !/^[a-z][a-z0-9-]{1,63}$/.test(value.owner) ||
      typeof value.reference !== "string" || value.reference !== expectedReference || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.reference) ||
      typeof value.amountMinor !== "string" || !/^[1-9][0-9]{0,18}$/.test(value.amountMinor) || BigInt(value.amountMinor) > 9_223_372_036_854_775_807n ||
      typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency) ||
      !Number.isInteger(value.currencyExponent) || (value.currencyExponent as number) < 0 || (value.currencyExponent as number) > 6 ||
      typeof value.providerCode !== "string" || !/^[a-z][a-z0-9-]{0,49}$/.test(value.providerCode) ||
      typeof value.credentialRef !== "string" || !/^([a-z][a-z0-9+.-]*):[A-Za-z0-9._:-]{1,160}$/.test(value.credentialRef)) {
    throw new ServiceUnavailableException("Payment payable source response is invalid");
  }
  return Object.freeze({
    owner: value.owner,
    reference: value.reference,
    amountMinor: value.amountMinor,
    currency: value.currency,
    currencyExponent: value.currencyExponent as number,
    providerCode: value.providerCode,
    credentialRef: value.credentialRef
  });
}
