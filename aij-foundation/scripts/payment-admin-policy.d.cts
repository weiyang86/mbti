export const PAYMENT_ADMIN_READ: "admin.payment.read";
export const PAYMENT_REFUND_REQUEST: "admin.payment.refund.request";
export const PAYMENT_RECONCILIATION_READ: "admin.payment.reconciliation.read";
export const PAYMENT_RECONCILIATION_RUN: "admin.payment.reconciliation.run";
export const PAYMENT_RECONCILIATION_REVIEW: "admin.payment.reconciliation.review";
export const PAYMENT_ADMIN_DEFINITIONS: ReadonlyArray<Readonly<{
  code: "admin.payment.read" | "admin.payment.refund.request" | "admin.payment.reconciliation.read" | "admin.payment.reconciliation.run" | "admin.payment.reconciliation.review";
  name: string;
  action: "read-payment-ledger" | "request-manual-refund" | "read-payment-reconciliation" | "run-payment-reconciliation" | "review-payment-reconciliation";
  path: string;
}>>;
