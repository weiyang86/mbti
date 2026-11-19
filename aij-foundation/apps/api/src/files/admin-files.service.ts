import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { CLIENT_FILE_MEDIA_TYPES } from "./client-files.dto";
import { AdminFileListQueryDto } from "./admin-files.dto";
import { FileContentError, FileContentService } from "./file-content.service";

@Injectable()
export class AdminFilesService {
  constructor(private readonly prisma: PrismaService, private readonly content: FileContentService, private readonly config: ConfigService) {}

  private projectScope() {
    return { projectId: this.config.getOrThrow<string>("projectId"), workspaceId: null, pluginCode: null, ownerType: "user", deletedAt: null } as const;
  }

  async list(query: AdminFileListQueryDto) {
    const where = { ...this.projectScope(), status: { in: ["active", "missing", "corrupt"] } };
    try {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.fileAsset.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize,
          select: { id: true, originalName: true, mimeType: true, size: true, status: true, ownerId: true, createdAt: true } }),
        this.prisma.fileAsset.count({ where })
      ]);
      return { items, total, page: query.page, pageSize: query.pageSize };
    } catch { throw new ServiceUnavailableException("File service unavailable"); }
  }

  async download(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new NotFoundException("File not found");
    let asset;
    try {
      asset = await this.prisma.fileAsset.findFirst({ where: { ...this.projectScope(), id, status: "active", mimeType: { in: [...CLIENT_FILE_MEDIA_TYPES] } } });
    } catch { throw new ServiceUnavailableException("File service unavailable"); }
    if (!asset) throw new NotFoundException("File not found");
    try {
      const bytes = await this.content.read(asset);
      return { bytes, mimeType: asset.mimeType, originalName: asset.originalName };
    } catch (error) {
      if (error instanceof FileContentError && error.code === "missing") {
        await this.prisma.fileAsset.updateMany({ where: { ...this.projectScope(), id, status: "active" }, data: { status: "missing" } });
        throw new NotFoundException("File not found");
      }
      if (error instanceof FileContentError && error.code === "corrupt") {
        await this.prisma.fileAsset.updateMany({ where: { ...this.projectScope(), id, status: "active" }, data: { status: "corrupt" } });
      }
      throw new ServiceUnavailableException("File is unavailable");
    }
  }
}
