import { IsString, Matches, MaxLength } from "class-validator";

export class PluginCodeDto {
  @IsString() @MaxLength(64) @Matches(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  code!: string;
}

export class PluginVersionDto {
  @IsString() @MaxLength(64) @Matches(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)
  version!: string;
}

export class PluginRetryDto {
  @IsString() @MaxLength(128) @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/)
  failedOperationId!: string;
}

export class PluginInstallationIdDto {
  @IsString() @MaxLength(128) @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/)
  id!: string;
}
