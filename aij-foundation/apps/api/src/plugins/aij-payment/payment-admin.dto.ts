import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from "class-validator";

const ORDER_STATUSES = ["created", "pending", "succeeded", "failed", "closed"] as const;
const REQUEST_STATUSES = ["pending_manual_review"] as const;

export class PaymentAdminOrderListDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsString() @MaxLength(64) q?: string;
  @IsOptional() @IsIn(ORDER_STATUSES) status?: typeof ORDER_STATUSES[number];
}

export class PaymentAdminRefundListDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsIn(REQUEST_STATUSES) status?: typeof REQUEST_STATUSES[number];
}

export class CreateManualRefundRequestDto {
  @IsString() @Matches(/^[1-9][0-9]{0,17}$/) amountMinor!: string;
  @IsString() @Length(16, 128) @Matches(/^[A-Za-z0-9_-]+$/) idempotencyKey!: string;
  @IsString() @Length(1, 500) reason!: string;
}
