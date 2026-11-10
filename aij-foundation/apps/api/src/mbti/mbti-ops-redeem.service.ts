import { Injectable } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { grants } from "../../../../scripts/mbti/ops-policy.cjs";
import { ManagementAccessService } from "../rbac/management-access.service";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";
import { MBTI_PRODUCTS } from "./mbti-products";
import { object } from "./mbti.service";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const SALEABLE: ReadonlySet<string> = new Set(MBTI_PRODUCTS.filter(p => p.saleable).map(p => p.code));

/** Ops-only redeem ledger candidate. No guest redeem path in this slice. */
@Injectable()
export class MbtiOpsRedeemService {
  constructor(private readonly prisma: PrismaService, private readonly access: ManagementAccessService) {}

  private public(row: {
    id: string; productCode: string; maxRedemptions: number; redeemedCount: number; status: string;
    createdByUserId: string; createdAt: Date; disabledAt: Date | null;
  }) {
    return {
      schema: "mbti-ops-redeem-code-candidate/v1",
      status: "needs_human_review" as const,
      id: row.id,
      product_code: row.productCode,
      max_redemptions: row.maxRedemptions,
      redeemed_count: row.redeemedCount,
      code_status: row.status,
      created_by: row.createdByUserId,
      created_at: row.createdAt.toISOString(),
      ...(row.disabledAt ? { disabled_at: row.disabledAt.toISOString() } : {}),
    };
  }

  private mintPlaintext() {
    // Display alphabet avoids ambiguous 0/O/1/I; plaintext never persisted.
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = randomBytes(8);
    let body = "";
    for (const b of bytes) body += alphabet[b % alphabet.length];
    return `MBTI${body}`;
  }

  async list(query: unknown) {
    const body = query && typeof query === "object" && !Array.isArray(query) ? query as Record<string, unknown> : {};
    if (Object.keys(body).some(k => !["product_code", "code_status", "limit"].includes(k))) {
      reject(422, "INVALID_REDEEM_QUERY", "兑换码列表仅接受 product_code、code_status、limit");
    }
    const productCode = body.product_code === undefined ? undefined : body.product_code;
    if (productCode !== undefined && (typeof productCode !== "string" || !SALEABLE.has(productCode))) {
      reject(422, "INVALID_REDEEM_QUERY", "product_code 须为可售商品编码");
    }
    const codeStatus = body.code_status === undefined ? undefined : body.code_status;
    if (codeStatus !== undefined && codeStatus !== "active" && codeStatus !== "disabled") {
      reject(422, "INVALID_REDEEM_QUERY", "code_status 仅支持 active 或 disabled");
    }
    const limit = body.limit === undefined ? 20 : typeof body.limit === "string" && /^[1-9][0-9]{0,1}$/.test(body.limit) ? Number(body.limit) : 0;
    if (limit < 1 || limit > 50) reject(422, "INVALID_REDEEM_QUERY", "每页数量应为 1–50");
    const rows = await this.prisma.mbtiRedeemCode.findMany({
      where: {
        ...(productCode ? { productCode } : {}),
        ...(codeStatus ? { status: codeStatus } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return { schema: "mbti-ops-redeem-code-candidate/v1", status: "needs_human_review", items: rows.map(row => this.public(row)) };
  }

  async create(input: unknown, operatorId: string, correlationId?: string) {
    const body = object(input);
    if (Object.keys(body).some(k => !["product_code", "count"].includes(k)) || typeof body.product_code !== "string" || !SALEABLE.has(body.product_code)) {
      reject(422, "INVALID_REDEEM_BATCH", "仅可为可售商品生成兑换码");
    }
    const count = body.count === undefined ? 1 : body.count;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1 || count > 50) {
      reject(422, "INVALID_REDEEM_BATCH", "count 须为 1–50 的整数");
    }
    const productCode = body.product_code;
    return this.access.write(operatorId, [grants.redemption], async (tx, actor) => {
      const issued: { id: string; code: string; product_code: string }[] = [];
      for (let i = 0; i < count; i++) {
        let plaintext = "", codeHash = "", attempts = 0;
        while (attempts++ < 8) {
          plaintext = this.mintPlaintext();
          codeHash = digest(plaintext);
          const clash = await tx.mbtiRedeemCode.findUnique({ where: { codeHash }, select: { id: true } });
          if (!clash) break;
          plaintext = "";
        }
        if (!plaintext) reject(503, "REDEEM_MINT_FAILED", "兑换码生成失败，请重试");
        const row = await tx.mbtiRedeemCode.create({
          data: {
            id: "RDM-" + randomUUID(), codeHash, productCode, maxRedemptions: 1, redeemedCount: 0,
            status: "active", createdByUserId: actor.id,
          },
        });
        issued.push({ id: row.id, code: plaintext, product_code: productCode });
      }
      await this.access.audit(tx, actor.id, issued[0]?.id ?? "batch", "mbti_redeem_codes_created", "mbti", "mbti_redeem_code", correlationId,
        ["productCode", "count"]);
      return {
        schema: "mbti-ops-redeem-code-candidate/v1",
        status: "needs_human_review",
        codes: issued,
        note: "明文仅本次返回；服务端只保存哈希，刷新后不可再取回",
      };
    });
  }

  async disable(id: string, operatorId: string, correlationId?: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) reject(404, "NOT_FOUND", "资源不存在");
    return this.access.write(operatorId, [grants.redemption], async (tx, actor) => {
      const row = await tx.mbtiRedeemCode.findUnique({ where: { id } });
      if (!row) reject(404, "NOT_FOUND", "资源不存在");
      if (row.status === "disabled") return this.public(row);
      const next = await tx.mbtiRedeemCode.update({
        where: { id },
        data: { status: "disabled", disabledAt: new Date() },
      });
      await this.access.audit(tx, actor.id, id, "mbti_redeem_code_disabled", "mbti", "mbti_redeem_code", correlationId, ["id"]);
      return this.public(next);
    });
  }
}
