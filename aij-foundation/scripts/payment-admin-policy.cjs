"use strict";

const PAYMENT_ADMIN_READ = "admin.payment.read";
const PAYMENT_REFUND_REQUEST = "admin.payment.refund.request";
const PAYMENT_RECONCILIATION_READ = "admin.payment.reconciliation.read";
const PAYMENT_RECONCILIATION_RUN = "admin.payment.reconciliation.run";
const PAYMENT_RECONCILIATION_REVIEW = "admin.payment.reconciliation.review";
const PAYMENT_ADMIN_DEFINITIONS = Object.freeze([
  Object.freeze({ code: PAYMENT_ADMIN_READ, name: "AIJ 支付查询", action: "read-payment-ledger", path: "/api/admin/payments/orders" }),
  Object.freeze({ code: PAYMENT_REFUND_REQUEST, name: "AIJ 人工退款申请", action: "request-manual-refund", path: "/api/admin/payments/orders/:id/refund-requests" }),
  Object.freeze({ code: PAYMENT_RECONCILIATION_READ, name: "AIJ 支付对账查询", action: "read-payment-reconciliation", path: "/api/admin/payments/reconciliations" }),
  Object.freeze({ code: PAYMENT_RECONCILIATION_RUN, name: "AIJ 支付对账录入", action: "run-payment-reconciliation", path: "/api/admin/payments/reconciliations" }),
  Object.freeze({ code: PAYMENT_RECONCILIATION_REVIEW, name: "AIJ 支付差异人工处置", action: "review-payment-reconciliation", path: "/api/admin/payments/reconciliations/:runId/discrepancies/:id/review" })
]);

module.exports = { PAYMENT_ADMIN_READ, PAYMENT_REFUND_REQUEST, PAYMENT_RECONCILIATION_READ, PAYMENT_RECONCILIATION_RUN, PAYMENT_RECONCILIATION_REVIEW, PAYMENT_ADMIN_DEFINITIONS };
