import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { FilesModule } from "./files.module";
import { GeneratedFileAssetsService } from "./generated-file-assets.service";

// Generated metadata requires the original Prisma provider. Keep the existing
// read-only FilesModule usable in local-only hosts without a database.
@Module({ imports: [FilesModule, PrismaModule], providers: [GeneratedFileAssetsService], exports: [GeneratedFileAssetsService] })
export class GeneratedFileAssetsModule {}
