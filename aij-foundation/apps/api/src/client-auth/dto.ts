import { Transform } from "class-transformer";
import { IsBoolean, IsEmail, IsIn, IsString, Length, Matches, MaxLength, ValidateBy, ValidateIf } from "class-validator";

// Login accepts exactly one identity. Input edges are trimmed and case is ignored;
// no Unicode compatibility folding or username-as-email inference is performed.
export class ClientLoginDto {
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @ValidateIf((dto: ClientLoginDto) => dto.email !== undefined || dto.username === undefined)
  @IsEmail() @MaxLength(254) email?: string;
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @ValidateIf((dto: ClientLoginDto) => dto.username !== undefined || dto.email === undefined)
  @IsString() @Length(1, 254) username?: string;
  @ValidateBy({ name: "exclusiveLoginIdentity", validator: {
    validate: (_value, args) => {
      const dto = args?.object as ClientLoginDto;
      return (dto.email !== undefined) !== (dto.username !== undefined);
    },
    defaultMessage: () => "Exactly one of email or username is required"
  } })
  @IsString() @Length(1, 72) password!: string;
}

// G5-01 registration accepts only customer identity fields. Verification delivery
// and one-time token issuance belong to the following G5-02 card.
export class ClientRegisterDto {
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email!: string;
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value)
  @IsString() @Length(1, 50) @Matches(/\S/, { message: "nickname must not be blank" }) nickname!: string;
  @IsString() @Matches(/^(?=.*[A-Za-z])(?=.*\d)[^\s]{8,72}$/, { message: "password must be 8-72 characters and include letters and numbers" }) password!: string;
}

export class ClientEmailVerificationRequestDto {
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email!: string;
}

export class ClientEmailVerificationConfirmDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{40,100}$/) token!: string;
}

export class ClientPasswordResetRequestDto {
  @Transform(({ value }: { value: unknown }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email!: string;
}

export class ClientPasswordResetConfirmDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{40,100}$/) token!: string;
  @IsString() @Matches(/^(?=.*[A-Za-z])(?=.*\d)[^\s]{8,72}$/, { message: "newPassword must be 8-72 characters and include letters and numbers" }) newPassword!: string;
}

const CLIENT_PASSWORD_POLICY = /^(?=.*[A-Za-z])(?=.*\d)[^\s]{8,72}$/;
export class ClientPasswordChangeDto {
  @IsString() @Length(1, 72) currentPassword!: string;
  @IsString() @Matches(CLIENT_PASSWORD_POLICY, { message: "newPassword must be 8-72 characters and include letters and numbers" }) newPassword!: string;
}

// These generic consent categories follow the source ClientAuth contract. Text
// content remains owned by the consuming product; only its version and digest are captured.
export class ClientConsentUpdateDto {
  @IsIn(["ai_assistance", "marketing"]) consentType!: "ai_assistance" | "marketing";
  @IsBoolean() granted!: boolean;
  @IsString() @Length(1, 64) @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/) textVersion!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/i) textDigest!: string;
}
