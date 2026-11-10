import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { grants } from "../../../../scripts/mbti/ops-policy.cjs";
import { ManagementAccessService } from "../rbac/management-access.service";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";
import { object } from "./mbti.service";

const RECIPES = new Set(["portrait", "balanced", "style"]);
const STATUSES = new Set(["queued", "running", "succeeded", "failed"]);

@Injectable()
export class MbtiOpsGenerationService {
  constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService) {}

  private public(row: {
    id: string; orderId: string; recipe: string; status: string; attempt: number; lastErrorClass: string | null;
    createdAt: Date; updatedAt: Date;
  }) {
    return {
      schema: "mbti-ops-generation-job-candidate/v1",
      status: "needs_human_review" as const,
      id: row.id,
      order_id: row.orderId,
      recipe: row.recipe,
      job_status: row.status,
      attempt: row.attempt,
      last_error_class: row.lastErrorClass,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      unlocked_is_not_delivery: true,
    };
  }

  async list(query: unknown) {
    const body = query && typeof query === "object" && !Array.isArray(query) ? query as Record<string, unknown> : {};
    if (Object.keys(body).some(k => !["status", "order_id", "limit"].includes(k))) {
      reject(422, "INVALID_GENERATION_QUERY", "生成任务列表仅接受 status、order_id、limit");
    }
    const status = body.status === undefined ? undefined : body.status;
    if (status !== undefined && (typeof status !== "string" || !STATUSES.has(status))) {
      reject(422, "INVALID_GENERATION_QUERY", "status 须为 queued/running/succeeded/failed");
    }
    const orderId = body.order_id === undefined ? undefined : body.order_id;
    if (orderId !== undefined && (typeof orderId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(orderId))) {
      reject(422, "INVALID_GENERATION_QUERY", "order_id 无效");
    }
    const limit = body.limit === undefined ? 20 : typeof body.limit === "string" && /^[1-9][0-9]{0,1}$/.test(body.limit) ? Number(body.limit) : 0;
    if (limit < 1 || limit > 50) reject(422, "INVALID_GENERATION_QUERY", "每页数量应为 1–50");
    const rows = await this.prisma.mbtiGenerationJob.findMany({
      where: { ...(status ? { status } : {}), ...(orderId ? { orderId } : {}) },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return { schema: "mbti-ops-generation-job-candidate/v1", status: "needs_human_review", items: rows.map(row => this.public(row)) };
  }

  async enqueue(input: unknown, operatorId: string, correlationId?: string) {
    const body = object(input);
    if (Object.keys(body).some(k => !["order_id", "recipe"].includes(k)) || typeof body.order_id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(body.order_id)) {
      reject(422, "INVALID_GENERATION_ENQUEUE", "须提供有效 order_id");
    }
    const recipe = body.recipe === undefined ? "balanced" : body.recipe;
    if (typeof recipe !== "string" || !RECIPES.has(recipe)) reject(422, "INVALID_GENERATION_ENQUEUE", "recipe 须为 portrait/balanced/style");
    return this.access.write(operatorId, [grants.fulfillment], async (tx, actor) => {
      const order = await tx.mbtiOrder.findUnique({ where: { id: body.order_id as string }, include: { entitlement: true } });
      if (!order) reject(404, "NOT_FOUND", "资源不存在");
      if (order.status !== "paid" || !order.entitlement) reject(409, "GENERATION_UNAVAILABLE", "仅已支付且已解锁权益的订单可入队");
      const row = await tx.mbtiGenerationJob.create({
        data: { id: "JOB-" + randomUUID(), orderId: order.id, recipe, status: "queued", attempt: 0 },
      });
      await this.access.audit(tx, actor.id, row.id, "mbti_generation_enqueued", "mbti", "mbti_generation_job", correlationId, ["orderId", "recipe"]);
      return this.public(row);
    });
  }

  async retry(id: string, input: unknown, operatorId: string, correlationId?: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) reject(404, "NOT_FOUND", "资源不存在");
    const body = object(input);
    if (Object.keys(body).some(k => k !== "idempotency_key") || typeof body.idempotency_key !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(body.idempotency_key)) {
      reject(422, "INVALID_GENERATION_RETRY", "请提供 16–128 位幂等键");
    }
    const keyHash = createHash("sha256").update(body.idempotency_key).digest("hex");
    return this.access.write(operatorId, [grants.generationRetry], async (tx, actor) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"mbti-generation-retry:" + id}, 0))`;
      const row = await tx.mbtiGenerationJob.findUnique({ where: { id } });
      if (!row) reject(404, "NOT_FOUND", "资源不存在");
      const prior = await tx.auditLog.findMany({
        where: { action: "mbti_generation_retried", resourceId: id },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const replay = prior.find(entry => {
        const summary = entry.requestSummary as { idempotencyKeyHash?: string } | null;
        return summary?.idempotencyKeyHash === keyHash;
      });
      if (replay) return this.public(row);
      if (row.status !== "failed") reject(409, "GENERATION_RETRY_UNAVAILABLE", "仅失败任务可重试");
      const next = await tx.mbtiGenerationJob.update({
        where: { id },
        data: { status: "queued", attempt: row.attempt + 1, lastErrorClass: null },
      });
      await tx.auditLog.create({
        data: {
          module: "mbti", action: "mbti_generation_retried", userId: actor.id, resourceType: "mbti_generation_job",
          resourceId: id, status: "success",
          requestSummary: { correlationId: correlationId || "unavailable", fields: ["attempt"], idempotencyKeyHash: keyHash },
        },
      });
      return this.public(next);
    });
  }
}
