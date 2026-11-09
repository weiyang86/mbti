import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PaymentReconciliationDiscrepancyType, PaymentReconciliationReviewState, PaymentTransactionKind, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { ManagementAccessService } from "../../rbac/management-access.service";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  PAYMENT_RECONCILIATION_REVIEW, PAYMENT_RECONCILIATION_RUN
} from "../../../../../scripts/payment-admin-policy.cjs";
import {
  CreatePaymentReconciliationDto, PaymentReconciliationListDto, PaymentReconciliationRecordDto,
  ReviewPaymentReconciliationDiscrepancyDto
} from "./payment-reconciliation.dto";

const PAGE_LIMIT = 100;
const discrepancyInclude = {
  order: { select: { id: true, orderNo: true } },
  reviewedBy: { select: { id: true, username: true, realName: true } }
} as const;
type ReconciliationDiscrepancy = Prisma.PaymentReconciliationDiscrepancyGetPayload<{ include: typeof discrepancyInclude }>;
type ReconciliationRun = Prisma.PaymentReconciliationRunGetPayload<{ include: { items: { include: typeof discrepancyInclude; orderBy: { sequence: "asc" } } } }>;
type NormalizedRecord = Readonly<{
  providerReference: string;
  orderNo: string;
  amountMinor: string;
  currency: string;
  status: "pending" | "succeeded" | "failed";
  occurredAt: string;
}>;
type NewDiscrepancy = Omit<Prisma.PaymentReconciliationDiscrepancyCreateManyInput, "runId" | "projectId" | "sequence">;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const referenceHash = (value: string) => sha256(value);

@Injectable()
export class PaymentReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pluginAccess: PluginRuntimeAccessService,
    private readonly management: ManagementAccessService
  ) {}

  private publicDiscrepancy(row: ReconciliationDiscrepancy) {
    return {
      id: row.id,
      type: row.type,
      reviewState: row.reviewState,
      orderId: row.orderId,
      orderNo: row.order?.orderNo ?? row.observedOrderNo,
      localAmountMinor: row.localAmountMinor?.toString() ?? null,
      observedAmountMinor: row.observedAmountMinor?.toString() ?? null,
      localCurrency: row.localCurrency?.trim() ?? null,
      observedCurrency: row.observedCurrency?.trim() ?? null,
      localStatus: row.localStatus,
      observedStatus: row.observedStatus,
      observedAt: row.observedAt?.toISOString() ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewer: row.reviewedBy ? { id: row.reviewedBy.id, username: row.reviewedBy.username, realName: row.reviewedBy.realName } : null,
      createdAt: row.createdAt.toISOString()
    };
  }

  private publicRun(row: ReconciliationRun | (Prisma.PaymentReconciliationRunGetPayload<object> & { items?: ReconciliationDiscrepancy[] })) {
    return {
      id: row.id,
      providerCode: row.providerCode,
      windowStart: row.windowStart.toISOString(),
      windowEnd: row.windowEnd.toISOString(),
      sourceRecordCount: row.sourceRecordCount,
      matchedCount: row.matchedCount,
      discrepancyCount: row.discrepancyCount,
      createdAt: row.createdAt.toISOString(),
      ...(row.items ? { discrepancies: row.items.map(item => this.publicDiscrepancy(item)) } : {})
    };
  }

  async list(query: PaymentReconciliationListDto) {
    return this.management.database(() => this.prisma.$transaction(async tx => {
      const projectId = await this.pluginAccess.projectId(tx);
      const where: Prisma.PaymentReconciliationRunWhereInput = {
        projectId,
        ...(query.providerCode ? { providerCode: query.providerCode } : {}),
        ...(query.reviewState ? { items: { some: { reviewState: query.reviewState } } } : {})
      };
      const [total, rows] = await Promise.all([
        tx.paymentReconciliationRun.count({ where }),
        tx.paymentReconciliationRun.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: Math.min(query.pageSize, PAGE_LIMIT) })
      ]);
      return { items: rows.map(row => this.publicRun(row)), total, page: query.page, pageSize: query.pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 }));
  }

  async get(id: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new NotFoundException("Payment reconciliation unavailable");
    return this.management.database(() => this.prisma.$transaction(async tx => {
      const projectId = await this.pluginAccess.projectId(tx);
      const row = await tx.paymentReconciliationRun.findFirst({
        where: { id, projectId },
        include: { items: { include: discrepancyInclude, orderBy: { sequence: "asc" } } }
      });
      if (!row) throw new NotFoundException("Payment reconciliation unavailable");
      return this.publicRun(row);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 }));
  }

  async create(dto: CreatePaymentReconciliationDto, operatorId: string, correlationId?: string) {
    const start = new Date(dto.windowStart), end = new Date(dto.windowEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
      throw new BadRequestException("Payment reconciliation window is invalid");
    }
    if (!Array.isArray(dto.records) || dto.records.length > 500) throw new BadRequestException("Payment reconciliation input is invalid");
    const records: NormalizedRecord[] = dto.records.map((record: PaymentReconciliationRecordDto) => ({
      providerReference: record.providerReference,
      orderNo: record.orderNo,
      amountMinor: record.amountMinor,
      currency: record.currency,
      status: record.status,
      occurredAt: new Date(record.occurredAt).toISOString()
    }));
    if (records.some(record => {
      const occurredAt = new Date(record.occurredAt);
      return occurredAt < start || occurredAt >= end;
    })) throw new BadRequestException("Payment reconciliation record is outside the requested window");
    const canonicalRecords = [...records].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    const idempotencyKeyHash = sha256(dto.idempotencyKey);
    const requestFingerprint = sha256(JSON.stringify([dto.providerCode, start.toISOString(), end.toISOString(), canonicalRecords]));

    return this.management.write(operatorId, [PAYMENT_RECONCILIATION_RUN], async (tx, actor) => {
      const projectId = await this.pluginAccess.projectId(tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"aij-payment-reconciliation-run:" + projectId + ":" + actor.id + ":" + idempotencyKeyHash}, 0))`;
      const unique = { projectId_createdByUserId_idempotencyKeyHash: { projectId, createdByUserId: actor.id, idempotencyKeyHash } };
      const existing = await tx.paymentReconciliationRun.findUnique({ where: unique });
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) throw new ConflictException("Payment reconciliation key is already used");
        return this.publicRun(existing);
      }

      const attempts = dto.records.length ? await tx.paymentAttempt.findMany({
        where: { providerCode: dto.providerCode, order: { projectId, deletedAt: null } },
        include: { order: true, transactions: { where: { kind: PaymentTransactionKind.charge } } }
      }) : [];
      const attemptsByReference = new Map(attempts.map(attempt => [attempt.providerReference, attempt]));
      const rowsByReference = new Map<string, number>();
      for (const record of records) rowsByReference.set(record.providerReference, (rowsByReference.get(record.providerReference) ?? 0) + 1);
      const discrepancyData: NewDiscrepancy[] = [];
      let matchedCount = 0;
      const add = (row: NewDiscrepancy) => discrepancyData.push(row);

      for (const record of records) {
        const attempt = attemptsByReference.get(record.providerReference);
        const sourceRecordHash = sha256(JSON.stringify(record));
        const providerReferenceHash = referenceHash(record.providerReference);
        const duplicate = (rowsByReference.get(record.providerReference) ?? 0) > 1;
        if (duplicate) {
          add({ type: PaymentReconciliationDiscrepancyType.duplicate_provider, orderId: attempt?.orderId ?? null,
            observedOrderNo: record.orderNo, providerReferenceHash, sourceRecordHash,
            localAmountMinor: attempt?.order.amountMinor ?? null, observedAmountMinor: BigInt(record.amountMinor),
            localCurrency: attempt?.order.currency ?? null, observedCurrency: record.currency,
            localStatus: attempt?.order.status ?? null, observedStatus: record.status, observedAt: new Date(record.occurredAt) });
          continue;
        }
        if (!attempt) {
          add({ type: PaymentReconciliationDiscrepancyType.missing_local, orderId: null, observedOrderNo: record.orderNo,
            providerReferenceHash, sourceRecordHash, localAmountMinor: null, observedAmountMinor: BigInt(record.amountMinor),
            localCurrency: null, observedCurrency: record.currency, localStatus: null, observedStatus: record.status,
            observedAt: new Date(record.occurredAt) });
          continue;
        }

        const order = attempt.order;
        const base = { orderId: order.id, observedOrderNo: record.orderNo, providerReferenceHash, sourceRecordHash,
          localAmountMinor: order.amountMinor, observedAmountMinor: BigInt(record.amountMinor), localCurrency: order.currency,
          observedCurrency: record.currency, localStatus: order.status, observedStatus: record.status, observedAt: new Date(record.occurredAt) };
        let discrepancies = 0;
        if (order.orderNo !== record.orderNo) { add({ ...base, type: PaymentReconciliationDiscrepancyType.order_mismatch }); discrepancies++; }
        if (order.amountMinor !== BigInt(record.amountMinor)) { add({ ...base, type: PaymentReconciliationDiscrepancyType.amount_mismatch }); discrepancies++; }
        if (order.currency.trim() !== record.currency) { add({ ...base, type: PaymentReconciliationDiscrepancyType.currency_mismatch }); discrepancies++; }
        const charge = attempt.transactions.find(transaction => transaction.providerReference === record.providerReference);
        const statusMatches = order.status === record.status && attempt.status === record.status &&
          (record.status !== "succeeded" || Boolean(charge && charge.amountMinor === order.amountMinor && charge.currency.trim() === order.currency.trim()));
        if (!statusMatches) { add({ ...base, type: PaymentReconciliationDiscrepancyType.status_mismatch }); discrepancies++; }
        if (!discrepancies) matchedCount++;
      }

      const seenReferences = new Set(records.map(record => record.providerReference));
      const localCharges = await tx.paymentTransaction.findMany({
        where: { providerCode: dto.providerCode, kind: PaymentTransactionKind.charge, occurredAt: { gte: start, lt: end },
          order: { projectId, deletedAt: null } },
        include: { order: true }
      });
      for (const transaction of localCharges) {
        if (seenReferences.has(transaction.providerReference)) continue;
        add({ type: PaymentReconciliationDiscrepancyType.missing_provider, orderId: transaction.orderId, transactionId: transaction.id,
          observedOrderNo: null, providerReferenceHash: referenceHash(transaction.providerReference),
          sourceRecordHash: sha256(JSON.stringify(["missing_provider", transaction.id, transaction.occurredAt.toISOString()])),
          localAmountMinor: transaction.amountMinor, observedAmountMinor: null, localCurrency: transaction.currency,
          observedCurrency: null, localStatus: transaction.order.status, observedStatus: null, observedAt: null });
      }

      const run = await tx.paymentReconciliationRun.create({ data: {
        projectId, providerCode: dto.providerCode, windowStart: start, windowEnd: end,
        sourceRecordCount: records.length, matchedCount, discrepancyCount: discrepancyData.length,
        idempotencyKeyHash, requestFingerprint, createdByUserId: actor.id
      } });
      if (discrepancyData.length) await tx.paymentReconciliationDiscrepancy.createMany({
        data: discrepancyData.map((item, sequence) => ({ ...item, projectId, runId: run.id, sequence }))
      });
      const created = await tx.paymentReconciliationRun.findUniqueOrThrow({
        where: { id: run.id }, include: { items: { include: discrepancyInclude, orderBy: { sequence: "asc" } } }
      });
      await this.management.audit(tx, actor.id, run.id, "payment_reconciliation_run_created", "aij-payment", "payment_reconciliation_run", correlationId,
        ["providerCode", "windowStart", "windowEnd", "sourceRecordCount", "matchedCount", "discrepancyCount"]);
      return this.publicRun(created);
    });
  }

  async review(runId: string, discrepancyId: string, dto: ReviewPaymentReconciliationDiscrepancyDto, operatorId: string, correlationId?: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId) || !/^[A-Za-z0-9_-]{1,128}$/.test(discrepancyId)) {
      throw new NotFoundException("Payment reconciliation discrepancy unavailable");
    }
    return this.management.write(operatorId, [PAYMENT_RECONCILIATION_REVIEW], async (tx, actor) => {
      const projectId = await this.pluginAccess.projectId(tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"aij-payment-reconciliation-review:" + projectId + ":" + discrepancyId}, 0))`;
      const existing = await tx.paymentReconciliationDiscrepancy.findFirst({ where: { id: discrepancyId, runId, projectId } });
      if (!existing) throw new NotFoundException("Payment reconciliation discrepancy unavailable");
      if (existing.reviewState !== PaymentReconciliationReviewState.open) throw new ConflictException("Payment discrepancy was already reviewed");
      const result = await tx.paymentReconciliationDiscrepancy.updateMany({
        where: { id: discrepancyId, runId, projectId, reviewState: PaymentReconciliationReviewState.open },
        data: { reviewState: dto.decision, reviewedByUserId: actor.id, reviewedAt: new Date() }
      });
      if (result.count !== 1) throw new ConflictException("Payment discrepancy was already reviewed");
      const row = await tx.paymentReconciliationDiscrepancy.findUniqueOrThrow({ where: { id: discrepancyId }, include: discrepancyInclude });
      await this.management.audit(tx, actor.id, discrepancyId, "payment_reconciliation_discrepancy_reviewed", "aij-payment", "payment_reconciliation_discrepancy", correlationId,
        ["decision", "reviewState"]);
      return this.publicDiscrepancy(row);
    });
  }
}
