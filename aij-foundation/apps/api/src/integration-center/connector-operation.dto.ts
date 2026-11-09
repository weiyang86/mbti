import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min, MinLength } from "class-validator";

export enum ConnectorOperationState {
  succeeded = "succeeded",
  failed = "failed"
}

export class ConnectorOperationsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsEnum(ConnectorOperationState) status?: ConnectorOperationState;
  @IsOptional() @IsString() @MinLength(2) @Matches(/^[a-z][a-z0-9-]{1,62}$/) connectorCode?: string;
}

export class ConnectorProjectCodeDto {
  @IsString() @MinLength(2) @Matches(/^[a-z][a-z0-9-]{1,62}$/) projectCode!: string;
}

export class ConnectorProjectAndCodeDto extends ConnectorProjectCodeDto {
  @IsString() @MinLength(2) @Matches(/^[a-z][a-z0-9-]{1,62}$/) connectorCode!: string;
}

export class ConnectorOperationIdDto extends ConnectorProjectCodeDto {
  @IsString() @MinLength(8) @Matches(/^[a-zA-Z0-9_-]{8,64}$/) operationId!: string;
}

export class StartConnectorOperationDto {
  @IsEnum({ secret_reference_check: "secret_reference_check" }) type!: "secret_reference_check";
}
