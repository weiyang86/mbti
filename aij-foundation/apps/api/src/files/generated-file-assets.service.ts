import { Inject, Injectable } from "@nestjs/common";
import type { FileAsset, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { LocalStorageAdapter } from "./local-storage.adapter";
import { FileContentService } from "./file-content.service";
import { generatedJsonValid } from "./generated-json";

export type GeneratedFileScope = Readonly<{ projectId: string; workspaceId: string; memberId: string; pluginCode: "aij-ai" }>;
export type GeneratedFileSpec = Readonly<{ format: "docx" | "pdf" | "json"; mimeType: string; bytes: Buffer; checksum: string; originalName: string; downloadUrl: string }>;
declare const ticketBrand: unique symbol;
export type GeneratedFileTicket = Readonly<{ assetId: string; [ticketBrand]: true }>;
export type GeneratedFileMetadata = Readonly<{ assetId: string; originalName: string; mimeType: string; size: number; checksum: string; createdAt: Date }>;
export class GeneratedFileError extends Error {
  constructor(readonly code: "INVALID_INPUT" | "INVALID_TICKET" | "NOT_FOUND" | "UNAVAILABLE") {
    super("Generated file " + code); this.name = "GeneratedFileError";
  }
}
const MAX = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIME = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", json: "application/json" };
function unsafeName(value: string): boolean {
  return Array.from(value).some(character => {
    const n = character.codePointAt(0)!;
    return n < 32 || (n >= 127 && n <= 159) || (n >= 0x202a && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069);
  });
}
type Entry = { data: Prisma.FileAssetUncheckedCreateInput; state: "staged" | "attempted"; busy: boolean };
function fail(code: GeneratedFileError["code"]): never { throw new GeneratedFileError(code); }
function scopeValid(scope: GeneratedFileScope) {
  // Core ProjectProfile IDs are opaque UUID/cuid/safe identifiers, not the storage runtime slug.
  if (!scope || ![scope.projectId, scope.workspaceId, scope.memberId].every(v => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v)) || scope.pluginCode !== "aij-ai") fail("INVALID_INPUT");
}
function nameValid(name: string, format: "pdf" | "docx" | "json") {
  if (format === "json") return typeof name === "string" && name.startsWith("script-") && name.endsWith(".json") && UUID.test(name.slice(7, -5));
  return typeof name === "string" && name.length <= 160 && name === name.normalize("NFC") && name === name.trim() &&
    !unsafeName(name) && !/[\\/:*?"<>|]/u.test(name) && !name.startsWith(".") && name.endsWith("." + format) &&
    !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name);
}
function urlValid(url: string) {
  // Deliberately canonical, no encoded separators, queries, fragments or dot segments.
  return typeof url === "string" && url.length <= 512 && /^\/api\/client\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(url);
}
function structureValid(format: "pdf" | "docx" | "json", bytes: Buffer) {
  if (format === "json") return generatedJsonValid(bytes);
  if (format === "pdf") return /^%PDF-1\.[0-9]/.test(bytes.toString("latin1", 0, 8)) && /%%EOF\s*$/.test(bytes.subarray(-1024).toString("latin1"));
  // Basic ZIP envelope and mandatory OOXML parts only; renderer owns full validation.
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50) return false;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) !== 0x06054b50 || i + 22 + bytes.readUInt16LE(i + 20) !== bytes.length) continue;
    if (bytes.readUInt16LE(i + 4) || bytes.readUInt16LE(i + 6)) return false;
    const count = bytes.readUInt16LE(i + 10), size = bytes.readUInt32LE(i + 12), start = bytes.readUInt32LE(i + 16);
    if (!count || count > 4096 || bytes.readUInt16LE(i + 8) !== count || start + size !== i) return false;
    let p = start; const names = new Set<string>();
    for (let n = 0; n < count; n++) {
      if (p + 46 > i || bytes.readUInt32LE(p) !== 0x02014b50 || (bytes.readUInt16LE(p + 8) & 1)) return false;
      const len = bytes.readUInt16LE(p + 28), next = p + 46 + len + bytes.readUInt16LE(p + 30) + bytes.readUInt16LE(p + 32);
      if (next > i || bytes.readUInt32LE(p + 42) >= start) return false;
      const name = bytes.toString("utf8", p + 46, p + 46 + len);
      if (names.has(name) || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..")) return false;
      names.add(name); p = next;
    }
    return p === i && names.has("[Content_Types].xml") && names.has("word/document.xml");
  }
  return false;
}

/** Trusted server API. Callers validate current document/lifecycle/permissions in tx.
 * Never serialize a ticket. After a tx settles, confirm success or discard failure;
 * on unknown outcome discard performs a locked read-back, never blind compensation.
 */
@Injectable()
export class GeneratedFileAssetsService {
  readonly #tickets = new WeakMap<GeneratedFileTicket, Entry>();
  readonly #reads = new WeakMap<object, FileAsset>();
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LocalStorageAdapter) private readonly storage: LocalStorageAdapter,
    @Inject(FileContentService) private readonly content: FileContentService) {}

  async stage(scope: GeneratedFileScope, spec: GeneratedFileSpec): Promise<GeneratedFileTicket> {
    scopeValid(scope);
    if (!spec || !["pdf", "docx", "json"].includes(spec.format) || spec.mimeType !== MIME[spec.format] || !Buffer.isBuffer(spec.bytes) ||
        spec.bytes.length < 1 || spec.bytes.length > MAX || typeof spec.checksum !== "string" || !/^[a-f0-9]{64}$/.test(spec.checksum) ||
        !nameValid(spec.originalName, spec.format) || !urlValid(spec.downloadUrl)) fail("INVALID_INPUT");
    const bytes = Buffer.from(spec.bytes);
    if (createHash("sha256").update(bytes).digest("hex") !== spec.checksum || !structureValid(spec.format, bytes)) fail("INVALID_INPUT");
    const id = randomUUID(), objectKey = randomUUID();
    const data: Prisma.FileAssetUncheckedCreateInput = { id, originalName: spec.originalName, filename: objectKey + "." + spec.format,
      mimeType: spec.mimeType, size: bytes.length, path: this.storage.relativePath(objectKey), url: spec.downloadUrl,
      storageType: "local", objectKey, checksum: spec.checksum, projectId: scope.projectId, workspaceId: scope.workspaceId,
      pluginCode: scope.pluginCode, ownerType: "user", ownerId: scope.memberId, uploaderId: scope.memberId, status: "active", deletedAt: null };
    try { await this.storage.write(objectKey, bytes); } catch { fail("UNAVAILABLE"); }
    const ticket = Object.freeze({ assetId: id }) as GeneratedFileTicket;
    this.#tickets.set(ticket, { data, state: "staged", busy: false });
    return ticket;
  }

  private entry(ticket: GeneratedFileTicket) {
    const entry = ticket && this.#tickets.get(ticket);
    if (!entry || entry.busy) fail("INVALID_TICKET");
    return entry;
  }
  private async lock(tx: Prisma.TransactionClient, id: string) {
    // Same transaction lock during create and cleanup prevents pending commit vs delete races.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${"aij-generated-file:" + id}, 0))`;
  }
  private metadata(asset: FileAsset): GeneratedFileMetadata {
    return { assetId: asset.id, originalName: asset.originalName, mimeType: asset.mimeType,
      size: asset.size, checksum: asset.checksum!, createdAt: asset.createdAt };
  }
  async commitInTransaction(tx: Prisma.TransactionClient, ticket: GeneratedFileTicket): Promise<GeneratedFileMetadata> {
    const entry = this.entry(ticket);
    if (entry.state !== "staged") fail("INVALID_TICKET");
    entry.busy = true; entry.state = "attempted";
    try {
      await this.lock(tx, ticket.assetId);
      const fences = await tx.$queryRaw<{ asset_id: string }[]>`SELECT asset_id FROM public.generated_file_cleanup_fence WHERE asset_id=${ticket.assetId} OR object_key=${entry.data.objectKey}`;
      if (fences.length) fail("INVALID_TICKET");
      return this.metadata(await tx.fileAsset.create({ data: entry.data }));
    }
    catch { fail("UNAVAILABLE"); }
    finally { entry.busy = false; }
  }
  async confirm(ticket: GeneratedFileTicket): Promise<void> {
    const entry = this.entry(ticket);
    if (entry.state !== "attempted") fail("INVALID_TICKET");
    entry.busy = true;
    try {
      await this.prisma.$transaction(async tx => {
        await this.lock(tx, ticket.assetId);
        const asset = await tx.fileAsset.findUnique({ where: { id: ticket.assetId } });
        if (!asset || Object.entries(entry.data).some(([key, value]) => asset[key as keyof FileAsset] !== value)) fail("UNAVAILABLE");
      }, { isolationLevel: "ReadCommitted" });
      this.#tickets.delete(ticket);
    } catch { fail("UNAVAILABLE"); }
    finally { entry.busy = false; }
  }
  async discard(ticket: GeneratedFileTicket): Promise<{ removed: boolean; retainedBecauseCommitted: boolean }> {
    const entry = this.entry(ticket); entry.busy = true; entry.state = "attempted";
    try {
      const retained = await this.prisma.$transaction(async tx => {
        await this.lock(tx, ticket.assetId);
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${"aij-generated-object:" + entry.data.objectKey}, 0))`;
        // Any committed identity/key match, even inactive/cross-scope, forbids deletion.
        const asset = await tx.fileAsset.findFirst({ where: { OR: [{ id: ticket.assetId }, { objectKey: entry.data.objectKey }] } });
        if (asset) return true;
        // Durable tombstone fences every later FileAsset insertion while IO runs without locks.
        await tx.$executeRaw`INSERT INTO public.generated_file_cleanup_fence(asset_id,object_key) VALUES (${ticket.assetId},${entry.data.objectKey}) ON CONFLICT(asset_id) DO NOTHING`;
        return false;
      }, { isolationLevel: "ReadCommitted" });
      if (!retained) {
        await this.storage.remove(entry.data.objectKey!);
        await this.prisma.$executeRaw`UPDATE public.generated_file_cleanup_fence SET removed_at=COALESCE(removed_at,clock_timestamp()) WHERE asset_id=${ticket.assetId} AND object_key=${entry.data.objectKey}`;
      }
      this.#tickets.delete(ticket); return { removed: !retained, retainedBecauseCommitted: retained };
    } catch { fail("UNAVAILABLE"); }
    finally { entry.busy = false; }
  }
  private async assetInTransaction(tx: Prisma.TransactionClient, assetId: string, scope: GeneratedFileScope): Promise<FileAsset> {
    scopeValid(scope);
    if (typeof assetId !== "string" || !UUID.test(assetId)) fail("NOT_FOUND");
    try {
      const asset = await tx.fileAsset.findFirst({ where: { id: assetId, projectId: scope.projectId, workspaceId: scope.workspaceId,
        pluginCode: scope.pluginCode, ownerType: "user", ownerId: scope.memberId, uploaderId: scope.memberId, status: "active", deletedAt: null } });
      if (!asset) fail("NOT_FOUND");
      const format = asset.mimeType === MIME.pdf ? "pdf" : asset.mimeType === MIME.docx ? "docx" : asset.mimeType === MIME.json ? "json" : null;
      if (!format || asset.storageType !== "local" || !Number.isInteger(asset.size) || asset.size < 1 || asset.size > MAX ||
          !asset.checksum || !/^[a-f0-9]{64}$/.test(asset.checksum) || !nameValid(asset.originalName, format)) fail("UNAVAILABLE");
      if (format === "json" && asset.size > 65536) fail("UNAVAILABLE");
      return asset;
    } catch (error) { if (error instanceof GeneratedFileError) throw error; fail("UNAVAILABLE"); }
  }
  async metadataInTransaction(tx: Prisma.TransactionClient, assetId: string, scope: GeneratedFileScope): Promise<GeneratedFileMetadata> {
    return this.metadata(await this.assetInTransaction(tx, assetId, scope));
  }
  async prepareReadInTransaction(tx: Prisma.TransactionClient, assetId: string, scope: GeneratedFileScope): Promise<object> {
    const asset = await this.assetInTransaction(tx, assetId, scope), ticket = Object.freeze({});
    this.#reads.set(ticket, Object.freeze({ ...asset })); return ticket;
  }
  async readPrepared(ticket: object): Promise<Buffer> {
    const asset = ticket && this.#reads.get(ticket);
    if (!asset) fail("INVALID_TICKET");
    this.#reads.delete(ticket);
    let bytes: Buffer | undefined;
    try {
      bytes = await this.content.read(asset);
      const format = asset.mimeType === MIME.pdf ? "pdf" : asset.mimeType === MIME.docx ? "docx" : "json";
      if (bytes.length !== asset.size || createHash("sha256").update(bytes).digest("hex") !== asset.checksum || !structureValid(format, bytes)) fail("UNAVAILABLE");
      return bytes;
    } catch { bytes?.fill(0); fail("UNAVAILABLE"); }
  }
  async readInTransaction(tx: Prisma.TransactionClient, assetId: string, scope: GeneratedFileScope): Promise<{ bytes: Buffer; mimeType: string; originalName: string; size: number; checksum: string }> {
    const meta = await this.metadataInTransaction(tx, assetId, scope);
    return { mimeType: meta.mimeType, originalName: meta.originalName, size: meta.size, checksum: meta.checksum,
      bytes: await this.readPrepared(await this.prepareReadInTransaction(tx, assetId, scope)) };
  }
}
