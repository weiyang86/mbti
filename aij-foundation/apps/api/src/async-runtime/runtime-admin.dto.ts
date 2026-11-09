import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";
import { Type } from "class-transformer";

const jobStatuses = ["pending", "retry", "running", "completed", "dead", "failed", "cancelled"];
const outboxStatuses = ["pending", "retry", "processing", "processed", "dead"];

export class RuntimeJobListDto {
  @IsOptional() @IsIn(jobStatuses) status?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class RuntimeOutboxListDto {
  @IsOptional() @IsIn(outboxStatuses) status?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}
