import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";
export class ConfigKeyDto { @IsString() @Length(1, 96) @Matches(/^[a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/) key!: string; }
export class ScopedConfigQueryDto {
  @IsOptional() @IsIn(["global", "organization", "project"]) scope?: "global" | "organization" | "project";
  @IsOptional() @IsString() @Length(1, 128) @Matches(/^[A-Za-z0-9_-]+$/) scopeId?: string;
}
export class UpsertScopedConfigDto {
  @IsIn(["global", "organization", "project"]) scope!: "global" | "organization" | "project";
  @IsOptional() @IsString() @Length(1, 128) @Matches(/^[A-Za-z0-9_-]+$/) scopeId?: string;
  @IsString() @Length(1, 256) configValue!: string;
  @IsIn(["string", "boolean", "number", "secretRef"]) valueType!: "string" | "boolean" | "number" | "secretRef";
  @IsBoolean() isPublic!: boolean;
  @IsIn(["active", "disabled"]) status!: "active" | "disabled";
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
}
export class UpdateProjectProfileDto {
  @IsIn(["active", "disabled"]) status!: "active" | "disabled";
  @IsString() @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
}
