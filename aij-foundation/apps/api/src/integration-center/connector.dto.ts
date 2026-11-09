import { ArrayUnique, IsArray, IsEnum, IsInt, IsString, Matches, Max, Min, MinLength } from "class-validator";

export class ProjectCodeDto {
  @IsString() @MinLength(2) @Matches(/^[a-z][a-z0-9-]{1,62}$/) projectCode!: string;
}

export class ConnectorCodeDto {
  @IsString() @MinLength(2) @Matches(/^[a-z][a-z0-9-]{1,62}$/) connectorCode!: string;
}

export class ProjectConnectorCodesDto extends ProjectCodeDto {
  @IsString() @MinLength(2) @Matches(/^[a-z][a-z0-9-]{1,62}$/) connectorCode!: string;
}

export class ConfigureConnectorDto {
  @IsArray() @ArrayUnique() @IsString({ each: true }) scopes!: string[];
  @IsString() @MinLength(8) @Matches(/^(?:env:\/\/AIJ_[A-Z0-9_]{3,127}|local:\/\/[a-z][a-z0-9-]{1,62}\/(?:development|test|production)\/[A-Z][A-Z0-9_]{2,63})$/) secretRef!: string;
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
}

export enum ConnectorLifecycleAction {
  disable = "disable",
  enable = "enable"
}

export class ConnectorLifecycleDto {
  @IsEnum(ConnectorLifecycleAction) action!: ConnectorLifecycleAction;
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
}
