import { Type } from "class-transformer";
import { IsInt, Max, Min } from "class-validator";

export type ClientUploadFile = Readonly<{
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}>;

export const CLIENT_FILE_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;
export const CLIENT_FILE_UPLOAD_FIELD = "file";

export const CLIENT_FILE_MEDIA_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "text/plain"
] as const);

export class FileListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}
