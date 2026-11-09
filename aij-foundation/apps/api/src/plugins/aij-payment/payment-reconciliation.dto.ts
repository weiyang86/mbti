import { Type } from "class-transformer";
import {
  ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested
} from "class-validator";

export class PaymentReconciliationRecordDto {
  @IsString() @MaxLength(128) @Matches(/^[A-Za-z0-9._:-]+$/) providerReference!: string;
  @IsString() @MaxLength(100) @Matches(/^[A-Za-z0-9._:-]+$/) orderNo!: string;
  @IsString() @Matches(/^[1-9][0-9]{0,18}$/) amountMinor!: string;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsString() @IsIn(["pending", "succeeded", "failed"]) status!: "pending" | "succeeded" | "failed";
  @IsDateString() occurredAt!: string;
}

export class CreatePaymentReconciliationDto {
  @IsString() @Matches(/^[a-z][a-z0-9-]{0,49}$/) providerCode!: string;
  @IsDateString() windowStart!: string;
  @IsDateString() windowEnd!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{16,128}$/) idempotencyKey!: string;
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => PaymentReconciliationRecordDto)
  records!: PaymentReconciliationRecordDto[];
}

export class PaymentReconciliationListDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsString() @MaxLength(50) @Matches(/^[a-z][a-z0-9-]*$/) providerCode?: string;
  @IsOptional() @IsString() @IsIn(["open", "acknowledged", "escalated"]) reviewState?: "open" | "acknowledged" | "escalated";
}

export class ReviewPaymentReconciliationDiscrepancyDto {
  @IsString() @IsIn(["acknowledged", "escalated"]) decision!: "acknowledged" | "escalated";
}
