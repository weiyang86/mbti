import { registerDecorator, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";
import { Type } from "class-transformer";

function IsNotSupplied() {
  return (target: object, propertyName: string) => registerDecorator({
    name: "isNotSupplied",
    target: target.constructor,
    propertyName,
    validator: { validate: (value: unknown) => value === undefined }
  });
}

export class CreateAiKnowledgeDocumentDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9._-]{1,79}$/)
  documentCode!: string;

  @IsString() @MaxLength(160)
  title!: string;

  @IsString() @MaxLength(50000)
  content!: string;

  // Keep the tenant boundary server-owned even if a global pipe strips unknown fields.
  @IsNotSupplied()
  workspaceId?: never;
}

export class AiKnowledgeDocumentPageDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000)
  page = 1;

  @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize = 20;

  @IsOptional() @IsIn(["active", "inactive", "all"])
  status: "active" | "inactive" | "all" = "active";
}

export class UpdateAiKnowledgeDocumentDto {
  @IsOptional() @IsString() @MaxLength(160)
  title?: string;

  @IsOptional() @IsString() @MaxLength(50000)
  content?: string;

  @IsOptional() @IsIn(["active", "inactive"])
  status?: "active" | "inactive";

  @IsDateString()
  expectedUpdatedAt!: string;

  @IsNotSupplied()
  workspaceId?: never;
}

export class QueryAiKnowledgeDto {
  @IsString() @MaxLength(500)
  query!: string;

  // Workspace identity is resolved from the authenticated server context.
  @IsNotSupplied()
  workspaceId?: never;
}

export class CreateAiKnowledgeQuestionDto {
  @IsString() @MaxLength(500) @Matches(/\S/)
  query!: string;

  @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
  idempotencyKey!: string;

  @IsNotSupplied()
  workspaceId?: never;
}

export class CaptureAiEvaluationDto {
  @IsString() @Matches(/^[a-z0-9]{20,32}$/)
  questionId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,80}$/)
  runKey!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,80}$/)
  caseKey!: string;
  @IsNotSupplied()
  workspaceId?: never;
}

export class ImportAiKnowledgeDocumentDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9._-]{1,79}$/)
  documentCode!: string;
  @IsString() @MaxLength(160) @Matches(/\S/)
  title!: string;
  @IsNotSupplied()
  workspaceId?: never;
}
