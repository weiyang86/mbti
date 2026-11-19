import { BadRequestException, Controller, Delete, ForbiddenException, Get, Header, HttpCode, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors, ValidationPipe, Type } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FileInterceptor } from "@nestjs/platform-express";
import type { ServerResponse } from "node:http";
import { ClientAuthGuard } from "../client-auth/client-auth.guard";
import { ClientRequest } from "../client-auth/client-auth.security";
import { ClientFilesService } from "./client-files.service";
import { CLIENT_FILE_UPLOAD_FIELD, CLIENT_FILE_UPLOAD_LIMIT_BYTES, ClientUploadFile, FileListQueryDto } from "./client-files.dto";

const strict = (expectedType: Type<object>) => new ValidationPipe({ expectedType, whitelist: true, forbidNonWhitelisted: true, transform: true });

@Controller("client/files")
@UseGuards(ClientAuthGuard)
export class ClientFilesController {
  constructor(private readonly files: ClientFilesService, private readonly config: ConfigService) {}

  private assertSameOrigin(request: ClientRequest) {
    if (request.headers.origin !== this.config.getOrThrow("webUrl") || request.headers["sec-fetch-site"] === "cross-site") {
      throw new ForbiddenException("Invalid request origin");
    }
  }

  @Post()
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  @UseInterceptors(FileInterceptor(CLIENT_FILE_UPLOAD_FIELD, { limits: { fileSize: CLIENT_FILE_UPLOAD_LIMIT_BYTES, files: 1, fields: 4, fieldSize: 1024 } }))
  async upload(@UploadedFile() file: ClientUploadFile | undefined, @Req() request: ClientRequest) {
    this.assertSameOrigin(request);
    if (!request.client) throw new BadRequestException("Authenticated customer is required");
    return this.files.upload(file, request.client);
  }

  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@Query(strict(FileListQueryDto)) query: object, @Req() request: ClientRequest) {
    if (!request.client) throw new BadRequestException("Authenticated customer is required");
    return this.files.list(query as FileListQueryDto, request.client);
  }

  @Get(":id")
  @Header("Cache-Control", "private, no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async download(@Param("id") id: string, @Req() request: ClientRequest, @Res() response: ServerResponse) {
    if (!request.client) throw new BadRequestException("Authenticated customer is required");
    const file = await this.files.download(id, request.client);
    const fallback = file.originalName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_");
    const encoded = encodeURIComponent(file.originalName).replace(/['()*]/g, character => "%" + character.charCodeAt(0).toString(16).toUpperCase());
    response.statusCode = 200;
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("Content-Length", String(file.bytes.length));
    response.setHeader("Content-Disposition", `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);
    response.end(file.bytes);
  }

  @Delete(":id")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  delete(@Param("id") id: string, @Req() request: ClientRequest) {
    this.assertSameOrigin(request);
    if (!request.client) throw new BadRequestException("Authenticated customer is required");
    return this.files.delete(id, request.client);
  }
}
