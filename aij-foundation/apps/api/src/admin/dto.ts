// Directed adaptation of source administrator DTOs; provenance section 15.
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, Validate, ValidateIf, ValidatorConstraint, ValidatorConstraintInterface } from "class-validator";
import { isAdminPassword } from "../../../../scripts/admin-policy.cjs";

@ValidatorConstraint({ name: "administratorPassword" })
class AdministratorPassword implements ValidatorConstraintInterface {
  validate(value: unknown) { return isAdminPassword(value); }
  defaultMessage() { return "Invalid administrator password"; }
}
const present = (_object: unknown, value: unknown) => value !== undefined;
const ID = /^[A-Za-z0-9_-]+$/;

export class CreateAdminDto {
  @IsString() @Length(3, 64) @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]+$/) username!: string;
  @IsString() @Length(1, 64) @Matches(/\S/) realName!: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @IsString() @Length(1, 32) phone?: string | null;
  @Validate(AdministratorPassword) password!: string;
  @ValidateIf(present) @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsString({ each: true }) @Length(1, 128, { each: true }) @Matches(ID, { each: true }) roleIds?: string[];
}
export class UpdateAdminDto {
  @ValidateIf(present) @IsString() @Length(1, 64) @Matches(/\S/) realName?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @IsString() @Length(1, 32) phone?: string | null;
  @ValidateIf(present) @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsString({ each: true }) @Length(1, 128, { each: true }) @Matches(ID, { each: true }) roleIds?: string[];
}
export class AdminStatusDto { @IsBoolean() enabled!: boolean; }
export class ResetAdminPasswordDto { @Validate(AdministratorPassword) password!: string; }
export class AdminIdDto { @IsString() @Length(1, 128) @Matches(ID) id!: string; }
export class AdminListDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsString() @MaxLength(64) q?: string;
  @IsOptional() @IsIn(["active", "disabled"]) status?: "active" | "disabled";
}
