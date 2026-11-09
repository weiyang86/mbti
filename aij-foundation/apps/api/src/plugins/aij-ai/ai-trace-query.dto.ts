import { Type } from "class-transformer";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";

const codePattern = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/;

export class AiTraceQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
  @IsOptional() @IsIn(["running", "succeeded", "failed"]) status?: "running" | "succeeded" | "failed";
  @IsOptional() @IsString() @Length(1, 64) @Matches(codePattern) providerCode?: string;
  @IsOptional() @IsString() @Length(1, 64) @Matches(codePattern) modelCode?: string;
  @IsOptional() @IsString() @Length(8, 128) @Matches(/^[A-Za-z0-9._:-]+$/) correlationId?: string;
  @IsOptional() @IsIn(["unreported", "provider_reported"]) costSource?: "unreported" | "provider_reported";
  @IsOptional() @IsString() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) startAt?: string;
  @IsOptional() @IsString() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) endAt?: string;
}
