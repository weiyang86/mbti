import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ClientPrincipal } from "../client-auth/client-auth.security";
import { LocalStorageAdapter, LocalStorageError } from "./local-storage.adapter";
import { CLIENT_FILE_MEDIA_TYPES, CLIENT_FILE_UPLOAD_LIMIT_BYTES, ClientUploadFile, FileListQueryDto } from "./client-files.dto";
import { FileContentError, FileContentService } from "./file-content.service";

const mediaTypes = new Set<string>(CLIENT_FILE_MEDIA_TYPES);
const mimeExtensions: Readonly<Record<string, string>> = Object.freeze({
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf", "text/plain": ".txt"
});
// Strip control characters from a display-only filename; it never participates in a filesystem path.
// eslint-disable-next-line no-control-regex
const controls = /[\u0000-\u001f\u007f-\u009f]/g;

function safeOriginalName(value: unknown): string {
  if (typeof value !== "string") throw new BadRequestException("Invalid file name");
  const leaf = value.replaceAll("\\", "/").split("/").at(-1) || "";
  const clean = Array.from(leaf.normalize("NFC").replace(controls, "").trim().replace(/[. ]+$/u, "")).slice(0, 160).join("");
  if (!clean || clean === "." || clean === "..") throw new BadRequestException("Invalid file name");
  return clean;
}

function matchesMediaType(type: string, bytes: Buffer): boolean {
  if (type === "image/jpeg") return bytes.length >= 5 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (type === "image/png") return bytes.length >= 20 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && bytes.subarray(-12, -8).toString("ascii") === "IEND";
  if (type === "image/webp") return bytes.length >= 20 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.readUInt32LE(4) + 8 === bytes.length && bytes.toString("ascii", 8, 12) === "WEBP";
  if (type === "application/pdf") return bytes.length >= 12 && bytes.toString("ascii", 0, 5) === "%PDF-" && bytes.includes(Buffer.from("%%EOF"));
  if (type === "text/plain") {
    if (bytes.includes(0)) return false;
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; }
    catch { return false; }
  }
  return false;
}

@Injectable()
export class ClientFilesService {
  constructor(private readonly prisma: PrismaService, private readonly storage: LocalStorageAdapter, private readonly content: FileContentService, private readonly config: ConfigService) {}

  async upload(file: ClientUploadFile | undefined, member: ClientPrincipal) {
    if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0 || file.size !== file.buffer.length) {
      throw new BadRequestException("A non-empty file is required");
    }
    if (file.size > CLIENT_FILE_UPLOAD_LIMIT_BYTES) throw new BadRequestException("File exceeds the upload size limit");
    if (!mediaTypes.has(file.mimetype) || !matchesMediaType(file.mimetype, file.buffer)) {
      throw new BadRequestException("Unsupported or invalid file content");
    }

    const originalName = safeOriginalName(file.originalname);
    const objectKey = randomUUID();
    const id = randomUUID();
    const mimeType = file.mimetype;
    const checksum = createHash("sha256").update(file.buffer).digest("hex");
    const stored = await this.storage.write(objectKey, file.buffer);
    try {
      const asset = await this.prisma.fileAsset.create({ data: {
        id,
        originalName,
        filename: objectKey + mimeExtensions[mimeType],
        mimeType,
        size: stored.size,
        path: stored.path,
        url: "/api/client/files/" + id,
        storageType: "local",
        objectKey,
        checksum,
        projectId: this.config.getOrThrow<string>("projectId"),
        workspaceId: null,
        pluginCode: null,
        ownerType: "user",
        ownerId: member.id,
        uploaderId: member.id,
        status: "active"
      } });
      return {
        id: asset.id, originalName: asset.originalName, mimeType: asset.mimeType,
        size: asset.size, checksum: asset.checksum, status: asset.status, createdAt: asset.createdAt
      };
    } catch {
      try { await this.storage.remove(objectKey); }
      catch { throw new ServiceUnavailableException("File upload could not be completed"); }
      throw new ServiceUnavailableException("File upload could not be completed");
    }
  }

  private scope(id: string, member: ClientPrincipal) {
    return {
      id,
      projectId: this.config.getOrThrow<string>("projectId"),
      workspaceId: null,
      pluginCode: null,
      ownerType: "user",
      ownerId: member.id,
      status: "active",
      deletedAt: null
    };
  }

  private async ownedActiveFile(id: string, member: ClientPrincipal) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
    return this.prisma.fileAsset.findFirst({ where: this.scope(id, member) });
  }

  async list(query: FileListQueryDto, member: ClientPrincipal) {
    const where = {
      projectId: this.config.getOrThrow<string>("projectId"), workspaceId: null, pluginCode: null,
      ownerType: "user", ownerId: member.id, deletedAt: null,
      status: { in: ["active", "missing", "corrupt"] }
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.fileAsset.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        select: { id: true, originalName: true, mimeType: true, size: true, status: true, createdAt: true } }),
      this.prisma.fileAsset.count({ where })
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async download(id: string, member: ClientPrincipal) {
    const asset = await this.ownedActiveFile(id, member);
    if (!asset || !asset.objectKey || !mediaTypes.has(asset.mimeType)) throw new NotFoundException("File not found");
    let bytes: Buffer;
    try { bytes = await this.content.read(asset); }
    catch (error) {
      if (error instanceof FileContentError && error.code === "missing") {
        await this.prisma.fileAsset.updateMany({ where: this.scope(id, member), data: { status: "missing" } });
        throw new NotFoundException("File not found");
      }
      if (error instanceof FileContentError && error.code === "corrupt") {
        await this.prisma.fileAsset.updateMany({ where: this.scope(id, member), data: { status: "corrupt" } });
      }
      throw new ServiceUnavailableException("File is unavailable");
    }
    return { bytes, mimeType: asset.mimeType, originalName: asset.originalName };
  }

  async delete(id: string, member: ClientPrincipal) {
    const scope = this.scope(id, member);
    const asset = await this.ownedActiveFile(id, member);
    if (!asset || !asset.objectKey) throw new NotFoundException("File not found");
    // This operation's claim and compensation are local-only. Never touch local
    // bytes or change metadata for cloud/unknown storage, even on failure.
    if (asset.storageType !== "local") throw new ServiceUnavailableException("File deletion could not be completed");
    let originalBytes: Buffer;
    try { originalBytes = await this.storage.read(asset.objectKey); }
    catch (error) {
      if (error instanceof LocalStorageError && error.code === "OBJECT_MISSING") {
        await this.prisma.fileAsset.updateMany({ where: scope, data: { status: "missing" } });
        throw new NotFoundException("File not found");
      }
      throw new ServiceUnavailableException("File deletion could not be completed");
    }
    const claim = await this.prisma.fileAsset.updateMany({ where: scope, data: { status: "deleting" } });
    if (claim.count !== 1) throw new NotFoundException("File not found");

    try {
      await this.storage.remove(asset.objectKey);
      const result = await this.prisma.fileAsset.updateMany({ where: { ...scope, status: "deleting" }, data: { status: "deleted", deletedAt: new Date() } });
      if (result.count !== 1) throw new Error("File state changed");
      return { deleted: true };
    } catch {
      try {
        if (!(await this.storage.exists(asset.objectKey))) await this.storage.write(asset.objectKey, originalBytes);
        const restored = await this.prisma.fileAsset.updateMany({ where: { ...scope, status: "deleting" }, data: { status: "active", deletedAt: null } });
        if (restored.count !== 1) throw new Error("File metadata could not be restored");
      } catch {
        throw new ServiceUnavailableException("File deletion could not be completed");
      }
      throw new ServiceUnavailableException("File deletion could not be completed");
    }
  }
}
