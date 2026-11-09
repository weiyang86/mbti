import { isDeepStrictEqual } from "node:util";
import { Injectable } from "@nestjs/common";
import { AiExecutionFailureCategory, AiExecutionTraceStatus, AiTraceCostSource } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { AiProviderResult } from "./ai-provider";

export type AiExecutionTraceContext = Readonly<{
  jobId: string;
  attempt: number;
  correlationId: string;
}>;

export type AiExecutionTraceStart = AiExecutionTraceContext & Readonly<{
  projectId: string;
  capabilityCode: string;
  input: unknown;
}>;

/** Trace and provider-reported Cost share one AI-owned immutable-per-attempt row. */
@Injectable()
export class AiExecutionTraceService {
  constructor(private readonly prisma: PrismaService) {}

  async start(input: AiExecutionTraceStart) {
    const inputShape = redactedShape(input.input);
    const row = await this.prisma.aiExecutionTrace.upsert({
      where: { jobId_attempt: { jobId: input.jobId, attempt: input.attempt } },
      create: {
        jobId: input.jobId,
        attempt: input.attempt,
        projectId: input.projectId,
        correlationId: input.correlationId,
        capabilityCode: input.capabilityCode,
        inputShape
      },
      update: {},
      select: {
        id: true, status: true, failureCategory: true, projectId: true, correlationId: true,
        capabilityCode: true, inputShape: true
      }
    });
    if (row.projectId !== input.projectId || row.correlationId !== input.correlationId ||
        row.capabilityCode !== input.capabilityCode || !isDeepStrictEqual(row.inputShape, inputShape)) {
      throw new Error("AI trace attempt identity conflicts with its recorded context");
    }
    return row;
  }

  async setProvider(traceId: string, providerCode: string, modelCode: string) {
    const result = await this.prisma.aiExecutionTrace.updateMany({
      where: { id: traceId, status: AiExecutionTraceStatus.running },
      data: { providerCode, modelCode }
    });
    if (result.count !== 1) throw new Error("AI trace is not writable");
  }

  async succeed(traceId: string, result: AiProviderResult, tx?: Prisma.TransactionClient) {
    const store = tx ?? this.prisma;
    const usage = result.usage;
    const data = {
      status: AiExecutionTraceStatus.succeeded,
      failureCategory: null,
      outputShape: redactedShape(result.output),
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      cachedTokens: usage?.cachedTokens ?? null,
      imageCount: usage?.imageCount ?? null,
      costAmountNanos: usage?.costAmountNanos === undefined ? null : BigInt(usage.costAmountNanos),
      costCurrency: usage?.costCurrency ?? null,
      costSource: usage?.costAmountNanos === undefined ? AiTraceCostSource.unreported : AiTraceCostSource.provider_reported,
      completedAt: new Date()
    } as const;
    const changed = await store.aiExecutionTrace.updateMany({
      where: { id: traceId, status: AiExecutionTraceStatus.running },
      data
    });
    if (changed.count === 1) return;
    const existing = await store.aiExecutionTrace.findUnique({ where: { id: traceId }, select: {
      status: true, outputShape: true, promptTokens: true, completionTokens: true, cachedTokens: true, imageCount: true,
      costAmountNanos: true, costCurrency: true, costSource: true
    } });
    if (!existing || existing.status !== AiExecutionTraceStatus.succeeded ||
        !isDeepStrictEqual(existing.outputShape, data.outputShape) ||
        existing.promptTokens !== data.promptTokens || existing.completionTokens !== data.completionTokens ||
        existing.cachedTokens !== data.cachedTokens || existing.imageCount !== data.imageCount || existing.costAmountNanos !== data.costAmountNanos ||
        existing.costCurrency !== data.costCurrency || existing.costSource !== data.costSource) {
      throw new Error("AI trace completion conflicts with its recorded attempt");
    }
  }

  async fail(traceId: string, failureCategory: AiExecutionFailureCategory, tx?: Prisma.TransactionClient) {
    const store = tx ?? this.prisma;
    const changed = await store.aiExecutionTrace.updateMany({
      where: { id: traceId, status: AiExecutionTraceStatus.running },
      data: { status: AiExecutionTraceStatus.failed, failureCategory, completedAt: new Date() }
    });
    if (changed.count === 1) return;
    const existing = await store.aiExecutionTrace.findUnique({ where: { id: traceId }, select: { status: true, failureCategory: true } });
    if (existing?.status === AiExecutionTraceStatus.failed && existing.failureCategory === failureCategory) return;
    if (existing?.status === AiExecutionTraceStatus.succeeded) return;
    throw new Error("AI trace failure could not be recorded");
  }
}

/** Persist only coarse shape metadata. Neither user values nor object keys reach the trace store. */
export function redactedShape(value: unknown, depth = 0): Prisma.InputJsonObject {
  if (depth >= 8) return { redacted: true, kind: "depth_limited" };
  if (value === null) return { redacted: true, kind: "null" };
  if (typeof value === "string") return { redacted: true, kind: "string", length: lengthBucket(value.length) };
  if (typeof value === "number") return { redacted: true, kind: "number" };
  if (typeof value === "boolean") return { redacted: true, kind: "boolean" };
  if (Array.isArray(value)) return { redacted: true, kind: "array", length: lengthBucket(value.length) };
  if (typeof value === "object") return { redacted: true, kind: "object", fieldCount: lengthBucket(Object.keys(value).length) };
  return { redacted: true, kind: "unsupported" };
}

function lengthBucket(value: number) {
  if (value === 0) return "0";
  if (value <= 4) return "1-4";
  if (value <= 16) return "5-16";
  if (value <= 64) return "17-64";
  return "65+";
}
