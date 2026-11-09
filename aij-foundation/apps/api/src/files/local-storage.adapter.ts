import { Injectable } from "@nestjs/common";
import { LocalStorageError } from "@aij/runtime-contracts";
import type { StorageAdapter } from "@aij/runtime-contracts";
import { ConfigService } from "@nestjs/config";
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PRIVATE_MODE = 0o077;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
// API is built to apps/api/dist/files; resolve from this module's runtime location.
const sourceRepositoryRoot = resolve(__dirname, "../../../..");

export { LocalStorageError, type LocalStorageErrorCode } from "@aij/runtime-contracts";

@Injectable()
export class LocalStorageAdapter implements StorageAdapter {
  private readonly root: string;
  private readonly objects: string;
  private readonly projectRoot: string;
  private readonly projectId: string;
  private readonly environment: string;

  constructor(config: ConfigService) {
    this.projectId = config.getOrThrow<string>("projectId");
    this.environment = config.getOrThrow<string>("environment");
    this.projectRoot = realpathSync(config.getOrThrow<string>("repositoryRoot") || sourceRepositoryRoot);
    this.root = resolve(config.getOrThrow<string>("storageRoot"));
    this.objects = join(this.root, "objects");
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(this.projectId) || !["development", "test", "production"].includes(this.environment)) {
      throw new LocalStorageError("STORAGE_ROOT_INVALID");
    }
    this.assertInsideProjectRoot(this.root);
    const segments = relative(this.projectRoot, this.root).split(sep);
    if (!segments.some((segment, index) => segment === this.projectId && segments[index + 1] === this.environment && index + 2 < segments.length)) {
      throw new LocalStorageError("STORAGE_ROOT_INVALID");
    }
  }

  relativePath(objectKey: string): string {
    this.assertKey(objectKey);
    return "objects/" + objectKey;
  }

  private assertInsideProjectRoot(path: string) {
    const rel = relative(this.projectRoot, path);
    if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new LocalStorageError("STORAGE_ROOT_INVALID");
  }

  private assertKey(objectKey: string) {
    if (typeof objectKey !== "string" || !UUID.test(objectKey)) throw new LocalStorageError("OBJECT_KEY_INVALID");
  }

  private async assertNoSymlinks(path: string) {
    const full = resolve(path);
    this.assertInsideProjectRoot(full);
    const parts = relative(this.projectRoot, full).split(sep);
    let current = this.projectRoot;
    for (const part of parts) {
      if (!part || part === "." || part === "..") throw new LocalStorageError("STORAGE_PATH_UNSAFE");
      current = join(current, part);
      let stat;
      try { stat = await lstat(current); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw new LocalStorageError("STORAGE_PATH_UNSAFE");
      }
      if (stat.isSymbolicLink()) throw new LocalStorageError("STORAGE_PATH_UNSAFE");
    }
  }

  private async secureDirectory(path: string) {
    const full = resolve(path);
    this.assertInsideProjectRoot(full);
    const parts = relative(this.projectRoot, full).split(sep);
    let current = this.projectRoot;
    for (const part of parts) {
      if (!part || part === "." || part === "..") throw new LocalStorageError("STORAGE_PATH_UNSAFE");
      current = join(current, part);
      let stat;
      try { stat = await lstat(current); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new LocalStorageError("STORAGE_PATH_UNSAFE");
        try { await mkdir(current, { mode: 0o700 }); }
        catch (createError) {
          if ((createError as NodeJS.ErrnoException).code !== "EEXIST") throw new LocalStorageError("STORAGE_PATH_UNSAFE");
        }
        try { stat = await lstat(current); }
        catch { throw new LocalStorageError("STORAGE_PATH_UNSAFE"); }
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new LocalStorageError("STORAGE_PATH_UNSAFE");
      if ((stat.mode & PRIVATE_MODE) !== 0) throw new LocalStorageError("STORAGE_ROOT_PERMISSIONS");
    }
  }

  private objectPath(objectKey: string) {
    this.assertKey(objectKey);
    const path = resolve(this.objects, objectKey);
    const rel = relative(this.root, path);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new LocalStorageError("STORAGE_PATH_UNSAFE");
    return path;
  }

  private async prepare() {
    await this.secureDirectory(this.root);
    await this.secureDirectory(this.objects);
  }

  async write(objectKey: string, bytes: Uint8Array): Promise<{ path: string; size: number }> {
    const target = this.objectPath(objectKey);
    if (!(bytes instanceof Uint8Array)) throw new LocalStorageError("STORAGE_WRITE_FAILED");
    await this.prepare();
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let created = false;
    try {
      await this.assertNoSymlinks(target);
      // O_EXCL provides the final UUID key reservation without hard links, which are unsupported on this volume.
      handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
      created = true;
      await handle.writeFile(bytes);
      await handle.sync();
      const stat = await handle.stat();
      if (!stat.isFile() || (stat.mode & PRIVATE_MODE) !== 0 || stat.size !== bytes.byteLength) throw new LocalStorageError("STORAGE_WRITE_FAILED");
      await handle.close(); handle = undefined;
      await this.assertNoSymlinks(target);
      const finalStat = await lstat(target);
      if (finalStat.isSymbolicLink() || !finalStat.isFile() || (finalStat.mode & PRIVATE_MODE) !== 0 || finalStat.size !== bytes.byteLength) {
        throw new LocalStorageError("STORAGE_WRITE_FAILED");
      }
      return { path: this.relativePath(objectKey), size: bytes.byteLength };
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      if (created) await unlink(target).catch(() => undefined);
      if (error instanceof LocalStorageError) throw error;
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new LocalStorageError("OBJECT_EXISTS");
      if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new LocalStorageError("STORAGE_PATH_UNSAFE");
      throw new LocalStorageError("STORAGE_WRITE_FAILED");
    }
  }

  async read(objectKey: string): Promise<Buffer> {
    const path = this.objectPath(objectKey);
    await this.prepare();
    await this.assertNoSymlinks(path);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(path, constants.O_RDONLY | NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || (stat.mode & PRIVATE_MODE) !== 0) throw new LocalStorageError("OBJECT_INVALID");
      return await handle.readFile();
    } catch (error) {
      if (error instanceof LocalStorageError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new LocalStorageError("OBJECT_MISSING");
      if ((error as NodeJS.ErrnoException).code === "ELOOP") throw new LocalStorageError("STORAGE_PATH_UNSAFE");
      throw new LocalStorageError("STORAGE_READ_FAILED");
    } finally { await handle?.close().catch(() => undefined); }
  }

  async remove(objectKey: string): Promise<void> {
    const path = this.objectPath(objectKey);
    await this.prepare();
    await this.assertNoSymlinks(path);
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new LocalStorageError("OBJECT_INVALID");
      await unlink(path);
    } catch (error) {
      if (error instanceof LocalStorageError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new LocalStorageError("OBJECT_MISSING");
      throw new LocalStorageError("STORAGE_DELETE_FAILED");
    }
  }

  async exists(objectKey: string): Promise<boolean> {
    const path = this.objectPath(objectKey);
    await this.prepare();
    await this.assertNoSymlinks(path);
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new LocalStorageError("OBJECT_INVALID");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      if (error instanceof LocalStorageError) throw error;
      throw new LocalStorageError("STORAGE_READ_FAILED");
    }
  }
}
