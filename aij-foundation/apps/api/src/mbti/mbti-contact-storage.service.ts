import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { LocalStorageAdapter } from "../files/local-storage.adapter";

/** MBTI owner-separated namespace reuses all original adapter protections.
 * These objects have no FileAsset or public download URL. Identifiers stay internal.
 */
@Injectable()
export class MbtiContactStorage {
  constructor(private readonly config: ConfigService) {}
  private adapter(ownerId: string) {
    return new LocalStorageAdapter(new ConfigService({
      projectId: this.config.getOrThrow<string>("projectId"),
      environment: this.config.getOrThrow<string>("environment"),
      repositoryRoot: this.config.getOrThrow<string>("repositoryRoot"),
      storageRoot: resolve(this.config.getOrThrow<string>("storageRoot"), "mbti-contacts", createHash("sha256").update(ownerId).digest("hex"))
    }));
  }
  read(ownerId: string, key: string) { return this.adapter(ownerId).read(key); }
  write(ownerId: string, key: string, bytes: Uint8Array) { return this.adapter(ownerId).write(key, bytes); }
}
