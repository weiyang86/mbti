import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModuleRef } from "@nestjs/core";
import { readRepositoryEnvironment } from "../../../../scripts/runtime-environment.cjs";
import { SecretRefPort, type SecretIdentity } from "../secret-center/secret-ref";
import { QiniuStorageAdapter } from "./qiniu-storage.adapter";
import { QiniuHttpsTransport, type QiniuTransport } from "./qiniu-storage-policy";
import { parseStorageReadProfiles } from "./storage-read-profiles";
import { StorageReaderRouter } from "./storage-reader-router";
import { STORAGE_READER, type StorageReaderPort } from "./storage-reader.port";

export const QINIU_READ_TRANSPORT_FACTORY = Symbol("QINIU_READ_TRANSPORT_FACTORY");
export type QiniuReadTransportFactory = (allowedHosts: readonly string[]) => QiniuTransport;
export const productionQiniuReadTransport: QiniuReadTransportFactory = hosts => new QiniuHttpsTransport(hosts);

/** One bootstrap snapshot per Nest application. No registration/update API and
 * no secret cache. SecretCenter retains registration, ownership and status checks.
 */
@Injectable()
export class StorageReadProfileService {
  readonly #router: StorageReaderRouter;

  constructor(config: ConfigService, modules: ModuleRef,
    @Inject(STORAGE_READER) local: StorageReaderPort,
    @Inject(QINIU_READ_TRANSPORT_FACTORY) transportFactory: QiniuReadTransportFactory) {
    const identity: SecretIdentity = Object.freeze({ projectId: config.getOrThrow<string>("projectId"),
      environment: config.getOrThrow<string>("environment"), namespace: config.getOrThrow<string>("namespace"),
      repositoryRoot: config.getOrThrow<string>("repositoryRoot") });
    // ConfigService reads this server environment variable once. Request DTOs,
    // FileAsset fields, configuration APIs and subsequent env edits cannot alter it.
    const configured = config.get<unknown>("AIJ_STORAGE_READ_PROFILES");
    const profiles = parseStorageReadProfiles(configured === undefined ? readRepositoryEnvironment().AIJ_STORAGE_READ_PROFILES : configured, identity);
    const entries: (readonly [string, StorageReaderPort])[] = [["local", local]];
    for (const profile of profiles) {
      const { id, accessKeyRef, secretKeyRef, ...options } = profile;
      const adapter = new QiniuStorageAdapter({ ...options, productId: identity.projectId,
        environment: identity.environment as "development" | "test" | "production" }, async () => {
        // Resolve lazily so local-only hosts need neither SecretCenter/Auth nor
        // credentials. Missing owner and all provider failures are redacted by
        // the actual adapter; they never cause a fallback to local storage.
        const secrets = modules.get(SecretRefPort, { strict: false });
        const accessKey = await secrets.resolveTrusted(accessKeyRef);
        const secretKey = await secrets.resolveTrusted(secretKeyRef);
        return { accessKey, secretKey };
      }, { transport: transportFactory(profile.allowedHosts) });
      // Publish read capability only: no signed links, uploads or compensation.
      entries.push([id, Object.freeze({ read: (key: string) => adapter.read(key) })]);
    }
    this.#router = new StorageReaderRouter(entries);
    Object.freeze(this);
  }

  readerRouter(): StorageReaderRouter { return this.#router; }
}
