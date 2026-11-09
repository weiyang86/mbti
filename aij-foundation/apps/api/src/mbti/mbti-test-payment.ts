// Controlled protocol fixture only. This module is never registered outside an explicitly
// enabled NODE_ENV=APP_ENV=test runtime and uses the existing Foundation payment owner.
import { Controller, Get, Header, HttpCode, Injectable, Param, Post, Req, SetMetadata, UseFilters, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { MbtiOrdersService } from "./mbti-orders.service";
import { MBTI_RAW, MbtiErrorFilter, reject } from "./mbti.http";
import { Permissions } from "../common/decorators/permissions.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { PaymentService } from "../plugins/aij-payment/payment.service";
import { PaymentCallbackService } from "../plugins/aij-payment/payment-callback.service";
import { PaymentPayableLookup, PaymentPayableSource } from "../plugins/aij-payment/payment-payable-source";
import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";

export const testMemberId = (ownerId: string) => "mbti-test-guest-" + ownerId;
export const testWorkspaceId = "mbti-f3-controlled-payment-workspace";

@Injectable()
export class MbtiTestPayableSource implements PaymentPayableSource {
  constructor(private readonly prisma: PrismaService) {}
  async resolve(input: PaymentPayableLookup) {
    const row = await this.prisma.mbtiOrder.findUnique({ where: { id: input.payableReference } });
    const project = await this.prisma.projectProfile.findUnique({ where: { id: input.projectId } });
    if (!row || row.status !== "pending" || input.memberId !== testMemberId(row.ownerId) || input.workspaceId !== testWorkspaceId ||
      project?.code !== "mbti-foundation-test" || project.environment !== "test") reject(404, "NOT_FOUND", "受控测试单不存在");
    return { owner: "mbti-controlled-test", reference: row.id, amountMinor: String(row.amount), currency: row.currency.trim(),
      currencyExponent: 2, providerCode: "synthetic-test", credentialRef: "test-only:mbti-f3-payment" };
  }
}

@Injectable()
export class MbtiTestPaymentService {
  constructor(private readonly prisma: PrismaService, private readonly payments: PaymentService, private readonly orders: MbtiOrdersService,
    private readonly callbacks: PaymentCallbackService, private readonly config: ConfigService) {}
  async prepare(id: string) {
    const order = await this.prisma.mbtiOrder.findUnique({ where: { id } });
    if (!order) reject(404, "NOT_FOUND", "资源不存在");
    if (order.status !== "pending") reject(409, "TEST_ORDER_TERMINAL", "受控测试单已终结");
    const memberId = testMemberId(order.ownerId);
    // Internal test-only ledger scope, not a recoverable user account or guest-account binding.
    await this.prisma.$transaction(async tx => {
      await tx.memberUser.upsert({ where: { id: memberId }, create: { id: memberId, nickname: "Controlled MBTI guest fixture", status: "active" }, update: {} });
      await tx.clientWorkspaceMembership.upsert({ where: { workspaceId_memberId: { workspaceId: testWorkspaceId, memberId } },
        create: { workspaceId: testWorkspaceId, memberId, roleId: "mbti-f3-controlled-payment-role" }, update: {} });
    });
    const payment = await this.payments.createOrder({ payableReference: id, idempotencyKey: "mbti_test_" + createHash("sha256").update(id).digest("hex") },
      { workspaceId: testWorkspaceId, memberId });
    await this.prisma.mbtiOrder.update({ where: { id }, data: { paymentOrderId: payment.id } });
    const attempt = await this.prisma.paymentAttempt.findFirstOrThrow({ where: { orderId: payment.id }, orderBy: { attemptNumber: "desc" } });
    return { order: await this.orders.operations(id), callback: { orderNo: payment.orderNo, providerReference: attempt.providerReference,
      path: "/api/v1/payments/controlled-test/callback", projectCode: "mbti-foundation-test", providerCode: "synthetic-test" } };
  }
  async receive(request: IncomingMessage & { rawBody?: Buffer }) {
    // Foundation validates raw bytes, signature, replay event, frozen order, amount and currency.
    const receipt = await this.callbacks.receive("mbti-foundation-test", "synthetic-test", request);
    const pending = await this.prisma.mbtiOrder.findMany({ where: { paymentOrderId: { not: null }, status: "pending" }, select: { id: true } });
    for (const row of pending) await this.orders.sync(row.id);
    return receipt;
  }
}

@Controller("admin/mbti/test-payments")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MbtiTestPaymentAdminController {
  constructor(private readonly tests: MbtiTestPaymentService) {}
  @Post(":id") @Permissions("mbti:payments:test") @Header("Cache-Control", "no-store") @HttpCode(200)
  prepare(@Param("id") id: string) { return this.tests.prepare(id); }
}

@Controller("v1/payments/controlled-test")
@SetMetadata(MBTI_RAW, true)
@UseFilters(MbtiErrorFilter)
export class MbtiTestCallbackController {
  constructor(private readonly tests: MbtiTestPaymentService) {}
  @Post("callback") @HttpCode(200) @Header("Cache-Control", "no-store")
  callback(@Req() request: IncomingMessage & { rawBody?: Buffer }) { return this.tests.receive(request); }
}
