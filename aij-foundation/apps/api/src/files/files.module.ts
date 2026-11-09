import { type DynamicModule, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LocalStorageAdapter } from "./local-storage.adapter";
import { FileContentService } from "./file-content.service";
import { StorageReaderRouter } from "./storage-reader-router";
import { STORAGE_READER } from "./storage-reader.port";
import { QINIU_READ_TRANSPORT_FACTORY, productionQiniuReadTransport, StorageReadProfileService, type QiniuReadTransportFactory } from "./storage-read-profile.service";

@Module({
  providers: [
    LocalStorageAdapter,
    { provide: STORAGE_READER, useExisting: LocalStorageAdapter },
    { provide: QINIU_READ_TRANSPORT_FACTORY, useValue: productionQiniuReadTransport },
    StorageReadProfileService,
    { provide: StorageReaderRouter, useFactory: (profiles: StorageReadProfileService) => profiles.readerRouter(), inject: [StorageReadProfileService] },
    FileContentService
  ],
  exports: [LocalStorageAdapter, STORAGE_READER, StorageReaderRouter, FileContentService]
})
export class FilesModule {
  /** Trusted, app-instance-scoped fixture DI. Never selected by env/profile JSON
   * or HTTP input. Production always uses the original DNS-pinned HTTPS transport.
   */
  static withTestTransport(factory: QiniuReadTransportFactory): DynamicModule {
    return { module: FilesModule, providers: [{ provide: QINIU_READ_TRANSPORT_FACTORY,
      useFactory: (config: ConfigService) => {
        if (config.get("nodeEnv") !== "test" || config.get("environment") !== "test" || typeof factory !== "function") {
          throw new Error("Storage fixture transport requires an isolated test application");
        }
        return factory;
      }, inject: [ConfigService] }] };
  }
}
