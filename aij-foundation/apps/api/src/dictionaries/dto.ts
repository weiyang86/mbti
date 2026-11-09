import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";
const present = (_object: unknown, value: unknown) => value !== undefined;
class DictionaryOptions {
  @IsOptional() @IsString() @MaxLength(256) description?: string | null;
  @ValidateIf(present) @IsInt() @Min(-10000) @Max(10000) sortOrder?: number;
  @ValidateIf(present) @IsIn(["active", "disabled"]) status?: "active" | "disabled";
}
export class CreateDictionaryDto extends DictionaryOptions {
  @IsString() @Length(8, 96) @Matches(/^custom\.[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/) dictCode!: string;
  @IsString() @Length(1, 64) @Matches(/\S/) dictName!: string;
  @ValidateIf(present) @IsBoolean() isPublic?: boolean;
}
export class UpdateDictionaryDto extends DictionaryOptions {
  @ValidateIf(present) @IsString() @Length(1, 64) @Matches(/\S/) dictName?: string;
  @ValidateIf(present) @IsBoolean() isPublic?: boolean;
}
export class CreateDictionaryItemDto extends DictionaryOptions {
  @IsString() @Length(1, 64) @Matches(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/) itemValue!: string;
  @IsString() @Length(1, 64) @Matches(/\S/) itemLabel!: string;
}
export class UpdateDictionaryItemDto extends DictionaryOptions {
  @ValidateIf(present) @IsString() @Length(1, 64) @Matches(/\S/) itemLabel?: string;
}
export class PublicDictionaryCodeDto {
  @IsString() @Length(1, 96) @Matches(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/) dictCode!: string;
}
export class PublicDictionaryPageDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
