import { Controller, Get, Header, Param, Query, Res, Type, ValidationPipe } from "@nestjs/common";
import type { ServerResponse } from "node:http";
import { Permissions } from "../common/decorators/permissions.decorator";
import { FILE_READ_PERMISSION } from "../../../../scripts/file-policy.cjs";
import { AdminFileListQueryDto } from "./admin-files.dto";
import { AdminFilesService } from "./admin-files.service";

const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });
const filenameHeaders = (response: ServerResponse, file: { bytes: Buffer; mimeType: string; originalName: string }) => {
  const fallback = file.originalName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_");
  const encoded = encodeURIComponent(file.originalName).replace(/['()*]/g, character => "%" + character.charCodeAt(0).toString(16).toUpperCase());
  response.statusCode = 200;
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Type", file.mimeType);
  response.setHeader("Content-Length", String(file.bytes.length));
  response.setHeader("Content-Disposition", `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
  response.end(file.bytes);
};

@Controller("admin/files")
@Permissions(FILE_READ_PERMISSION)
export class AdminFilesController {
  constructor(private readonly files: AdminFilesService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(@Query(strict(AdminFileListQueryDto)) query: object) { return this.files.list(query as AdminFileListQueryDto); }

  @Get(":id")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async download(@Param("id") id: string, @Res() response: ServerResponse) {
    const file = await this.files.download(id);
    filenameHeaders(response, file);
  }
}
