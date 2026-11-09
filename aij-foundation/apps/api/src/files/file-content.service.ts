import { Inject, Injectable } from "@nestjs/common";
import { LocalStorageError } from "@aij/runtime-contracts";
import { createHash } from "node:crypto";
import { StorageReaderRouter } from "./storage-reader-router";

export class FileContentError extends Error {
  constructor(readonly code: "missing" | "corrupt" | "unavailable") {
    super(code);
    this.name = "FileContentError";
  }
}

@Injectable()
export class FileContentService {
  constructor(@Inject(StorageReaderRouter) private readonly readers: StorageReaderRouter) {}

  async read(asset: { storageType: string; objectKey: string | null; size: number; checksum: string | null }): Promise<Buffer> {
    const storage = this.readers.resolve(asset.storageType);
    if (!storage) throw new FileContentError("unavailable");
    if (!asset.objectKey || !asset.checksum) throw new FileContentError("corrupt");
    let bytes: Buffer;
    try {
      const stored = await storage.read(asset.objectKey);
      if (!(stored instanceof Uint8Array)) throw new FileContentError("unavailable");
      // Copy just the returned view, preserving the Buffer download contract and
      // preventing later provider mutations from changing already verified bytes.
      bytes = Buffer.from(stored);
    }
    catch (error) {
      if (error instanceof LocalStorageError && error.code === "OBJECT_MISSING") throw new FileContentError("missing");
      throw new FileContentError("unavailable");
    }
    if (bytes.length !== asset.size || createHash("sha256").update(bytes).digest("hex") !== asset.checksum) {
      throw new FileContentError("corrupt");
    }
    return bytes;
  }
}
