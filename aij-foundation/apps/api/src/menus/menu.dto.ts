import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";
const present = (_object: unknown, value: unknown) => value !== undefined;
class MenuOptionsDto {
  @IsOptional() @IsString() @Length(1, 128) @Matches(/^[A-Za-z0-9_-]+$/) parentId?: string | null;
  @ValidateIf(present) @IsIn(["directory", "menu"]) type?: "directory" | "menu";
  @IsOptional() @IsString() @Length(1, 128) @Matches(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/) permissionCode?: string | null;
  @IsOptional() @IsString() @Length(1, 64) @Matches(/^[a-z][a-z0-9-]*$/) pluginCode?: string | null;
  @IsOptional() @IsString() @MaxLength(64) @Matches(/^[A-Za-z][A-Za-z0-9_-]*$/) icon?: string | null;
  @ValidateIf(present) @IsInt() @Min(-10000) @Max(10000) sortOrder?: number;
  @ValidateIf(present) @IsBoolean() visible?: boolean;
  @ValidateIf(present) @IsIn(["active", "disabled"]) status?: "active" | "disabled";
}
export class MenuFieldsDto extends MenuOptionsDto {
  @ValidateIf(present) @IsString() @Length(1, 64) @Matches(/\S/) title?: string;
  @ValidateIf(present) @IsString() @Length(1, 256) @Matches(/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/) path?: string;
}
export class CreateMenuDto extends MenuOptionsDto {
  @IsString() @Length(1, 64) @Matches(/\S/) declare title: string;
  @IsString() @Length(1, 256) @Matches(/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/) declare path: string;
}
