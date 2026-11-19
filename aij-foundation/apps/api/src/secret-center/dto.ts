import { IsISO8601, IsString, Length } from "class-validator";
export class CreateSecretReferenceDto { @IsString() @Length(1, 256) ref!: string; }
export class SecretVersionDto { @IsString() @IsISO8601({ strict: true }) expectedUpdatedAt!: string; }
export class RotateSecretReferenceDto extends SecretVersionDto { @IsString() @Length(1, 256) ref!: string; }
