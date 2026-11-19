import { BadRequestException, Injectable } from "@nestjs/common";
import { AiExecutionFailureCategory, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ManagementAccessService } from "../../rbac/management-access.service";
import { PermissionsService } from "../../rbac/permissions.service";
import { PluginRuntimeAccessService } from "../../plugin-runtime/plugin-runtime-access.service";
import { RUNTIME_READ_PERMISSION } from "../../../../../scripts/runtime-policy.cjs";
import { AiTraceQueryDto } from "./ai-trace-query.dto";

const failureCategories = new Set<string>(Object.values(AiExecutionFailureCategory));
const shapeKinds = new Set(["null", "string", "number", "boolean", "array", "object", "depth_limited", "unsupported"]);
const lengthBuckets = new Set(["0", "1-4", "5-16", "17-64", "65+"]);
const emptyFilters = new Set(["page", "pageSize"]);

function shapeProjection(value: Prisma.JsonValue | null) {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return { redacted: true, kind: "unsupported" };
  const kind = typeof value.kind === "string" && shapeKinds.has(value.kind) ? value.kind : "unsupported";
  const projected: Record<string, unknown> = { redacted: true, kind };
  if ((kind === "string" || kind === "array") && typeof value.length === "string" && lengthBuckets.has(value.length)) projected.length = value.length;
  if (kind === "object" && typeof value.fieldCount === "string" && lengthBuckets.has(value.fieldCount)) projected.fieldCount = value.fieldCount;
  return projected;
}

function safeCode(value: string | null) { return value && /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/.test(value) ? value : null; }

function safeItem(row: {
  id: string; attempt: number; capabilityCode: string; providerCode: string | null; modelCode: string | null;
  status: string; failureCategory: string | null; inputShape: Prisma.JsonValue; outputShape: Prisma.JsonValue | null;
  promptTokens: number | null; completionTokens: number | null; cachedTokens: number | null; costAmountNanos: bigint | null;
  costCurrency: string | null; costSource: string; startedAt: Date; completedAt: Date | null;
}) {
  return {
    id: row.id, attempt: row.attempt, capabilityCode: safeCode(row.capabilityCode),
    providerCode: safeCode(row.providerCode), modelCode: safeCode(row.modelCode),
    status: ["running", "succeeded", "failed"].includes(row.status) ? row.status : "unknown",
    failureCategory: row.failureCategory && failureCategories.has(row.failureCategory) ? row.failureCategory : null,
    inputShape: shapeProjection(row.inputShape), outputShape: shapeProjection(row.outputShape),
    promptTokens: Number.isSafeInteger(row.promptTokens) && row.promptTokens! >= 0 ? row.promptTokens : null,
    completionTokens: Number.isSafeInteger(row.completionTokens) && row.completionTokens! >= 0 ? row.completionTokens : null,
    cachedTokens: Number.isSafeInteger(row.cachedTokens) && row.cachedTokens! >= 0 ? row.cachedTokens : null,
    costAmountNanos: row.costAmountNanos?.toString() ?? null,
    costCurrency: row.costCurrency && /^[A-Z]{3}$/.test(row.costCurrency) ? row.costCurrency : null,
    costSource: ["unreported", "provider_reported"].includes(row.costSource) ? row.costSource : "unreported",
    startedAt: row.startedAt, completedAt: row.completedAt
  };
}

@Injectable()
export class AiTraceQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ManagementAccessService,
    private readonly permissions: PermissionsService,
    private readonly pluginAccess: PluginRuntimeAccessService
  ) {}

  list(query: AiTraceQueryDto, operatorId: string) {
    const start = query.startAt ? new Date(query.startAt) : undefined;
    const end = query.endAt ? new Date(query.endAt) : undefined;
    if (start && end && start > end) throw new BadRequestException("Invalid AI trace time range");
    const whereBase: Omit<Prisma.AiExecutionTraceWhereInput, "projectId"> = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.providerCode ? { providerCode: query.providerCode } : {}),
      ...(query.modelCode ? { modelCode: query.modelCode } : {}),
      ...(query.correlationId ? { correlationId: query.correlationId } : {}),
      ...(query.costSource ? { costSource: query.costSource } : {}),
      ...(start || end ? { startedAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {})
    };
    const auditFields = Object.keys(query).filter(key => !emptyFilters.has(key)).sort();
    return this.access.database(() => this.prisma.$transaction(async tx => {
      await this.permissions.authorizeInTransaction(tx, operatorId, [RUNTIME_READ_PERMISSION]);
      const projectId = await this.pluginAccess.projectId(tx);
      await this.pluginAccess.assertEnabledInTransaction(tx, projectId, "aij-ai");
      const where: Prisma.AiExecutionTraceWhereInput = { ...whereBase, projectId };
      const [total, rows] = await Promise.all([
        tx.aiExecutionTrace.count({ where }),
        tx.aiExecutionTrace.findMany({
          where, orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize, take: query.pageSize,
          select: {
            id: true, attempt: true, capabilityCode: true, providerCode: true, modelCode: true,
            status: true, failureCategory: true, inputShape: true, outputShape: true,
            promptTokens: true, completionTokens: true, cachedTokens: true, costAmountNanos: true,
            costCurrency: true, costSource: true, startedAt: true, completedAt: true
          }
        })
      ]);
      await tx.auditLog.create({ data: {
        module: "aij-ai", action: "trace_listed", userId: operatorId,
        resourceType: "ai_execution_trace", status: "success", method: "GET", path: "/api/admin/ai/traces",
        requestSummary: { redacted: true, fields: auditFields }
      } });
      return { items: rows.map(safeItem), total, page: query.page, pageSize: query.pageSize };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2000, timeout: 5000 }));
  }
}
