import { Type } from "class-transformer";
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";
export class AuditQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsIn(["success", "failed", "error"]) status?: "success" | "failed" | "error";
  @IsOptional() @IsString() @Length(1, 64) @Matches(/^[A-Za-z][A-Za-z0-9_.:-]*$/) module?: string;
  @IsOptional() @IsString() @Length(1, 64) @Matches(/^[A-Za-z][A-Za-z0-9_.:-]*$/) action?: string;
  @IsOptional() @IsString() @Length(1, 64) @Matches(/^[A-Za-z][A-Za-z0-9_.:-]*$/) resourceType?: string;
  @IsOptional() @IsString() @Length(1, 128) @Matches(/^[A-Za-z0-9_-]+$/) userId?: string;
  @IsOptional() @IsString() @Length(1, 128) @Matches(/^[A-Za-z0-9_-]+$/) resourceId?: string;
  @IsOptional() @IsString() @Length(8, 128) @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/) correlationId?: string;
  @IsOptional() @IsString() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) startAt?: string;
  @IsOptional() @IsString() @IsISO8601({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) endAt?: string;
}
