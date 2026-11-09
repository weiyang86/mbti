import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";

export class AdminClientDirectoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsString() @Length(1, 128) q?: string;
  @IsOptional() @IsIn(["pending_verification", "active", "disabled"]) status?: string;
}

export class AdminClientHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class AdminClientHistoryPathDto {
  @IsString() @Length(1, 36) @Matches(/^(?:c[a-z0-9]{24}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i) memberId!: string;
}

export class AdminClientSessionRevokePathDto extends AdminClientHistoryPathDto {
  @IsString() @Length(1, 36) @Matches(/^(?:c[a-z0-9]{24}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i) sessionId!: string;
}

export class AdminClientSessionRevokeDto {
  @IsString() @Length(1, 72) currentPassword!: string;
}
