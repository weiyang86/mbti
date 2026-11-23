import { IsISO8601, IsString, Length, Matches } from "class-validator";
export class CreateSecretReferenceDto { @IsString() @Length(1, 256) ref!: string; }
export class SaveSecretValueDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{2,63}$/) name!: string;
  @IsString() @Length(16, 8192) value!: string;
}
export class SecretVersionDto { @IsString() @IsISO8601({ strict: true }) expectedUpdatedAt!: string; }
export class RotateSecretReferenceDto extends SecretVersionDto { @IsString() @Length(1, 256) ref!: string; }
