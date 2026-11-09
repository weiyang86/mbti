// Core role slice adapted from the verified source. Permission definitions use the existing core Schema.
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from "class-validator";
import type { ResourceType } from "@prisma/client";
const present = (_object: unknown, value: unknown) => value !== undefined;
export class CreateRoleDto {
  @IsString() @Length(3, 64) @Matches(/^(?!aij_|super_admin$)[a-z][a-z0-9_]*$/) roleCode!: string;
  @IsString() @Length(1, 64) @Matches(/\S/) roleName!: string;
  @IsOptional() @IsString() @MaxLength(256) remark?: string | null;
}
export class UpdateRoleDto {
  @ValidateIf(present) @IsString() @Length(1, 64) @Matches(/\S/) roleName?: string;
  @IsOptional() @IsString() @MaxLength(256) remark?: string | null;
}
export class RolePermissionsDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(100) @IsString({ each: true }) @Length(1, 128, { each: true }) @Matches(/^[A-Za-z0-9_-]+$/, { each: true }) permissionIds!: string[];
}
export class CreatePermissionDto {
  @IsString() @Length(8, 128) @Matches(/^custom\.[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/) permissionCode!: string;
  @IsString() @Length(1, 64) @Matches(/\S/) permissionName!: string;
  @IsIn(["menu", "button", "api", "data"]) resourceType!: ResourceType;
  @IsString() @Length(1, 64) @Matches(/^[a-z][a-z0-9._-]*$/) action!: string;
  @IsOptional() @IsString() @MaxLength(256) @Matches(/^\/api(?:\/[A-Za-z0-9_:-]+)*$/) apiPath?: string | null;
}
export class UpdatePermissionDto {
  @ValidateIf(present) @IsString() @Length(1, 64) @Matches(/\S/) permissionName?: string;
  @IsOptional() @IsString() @MaxLength(256) @Matches(/^\/api(?:\/[A-Za-z0-9_:-]+)*$/) apiPath?: string | null;
}
