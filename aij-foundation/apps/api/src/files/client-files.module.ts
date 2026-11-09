import { Module } from "@nestjs/common";
import { ClientAuthModule } from "../client-auth/client-auth.module";
import { FilesModule } from "./files.module";
import { ClientFilesController } from "./client-files.controller";
import { ClientFilesService } from "./client-files.service";

@Module({ imports: [ClientAuthModule, FilesModule], controllers: [ClientFilesController], providers: [ClientFilesService] })
export class ClientFilesModule {}
