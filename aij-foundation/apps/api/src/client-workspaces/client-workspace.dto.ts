import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from "class-validator";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9:_-]{8,120}$/;

export class ClientWorkspacePageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class CreateClientWorkspaceDto {
  @IsString() @Length(2, 120) @Matches(/\S/) name!: string;
  @IsString() @Matches(IDEMPOTENCY_KEY) idempotencyKey!: string;
}

export class UpdateClientWorkspaceDto {
  @IsString() @Length(2, 120) @Matches(/\S/) name!: string;
}

export class CreateClientWorkspaceMembershipDto {
  @IsString() @Length(1, 128) memberId!: string;
  @IsString() @Length(1, 128) roleId!: string;
}

export class ChangeClientWorkspaceMembershipRoleDto {
  @IsString() @Length(1, 128) roleId!: string;
}

export class ChangeClientWorkspaceMembershipStatusDto {
  @IsIn(["active", "suspended", "removed"]) status!: "active" | "suspended" | "removed";
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
