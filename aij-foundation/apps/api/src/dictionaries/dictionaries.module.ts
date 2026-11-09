import { Module } from "@nestjs/common";
import { RbacModule } from "../rbac/rbac.module";
import { DictionariesController, DictionaryItemsController, PublicDictionariesController } from "./dictionaries.controller";
import { DictionariesService } from "./dictionaries.service";
@Module({ imports: [RbacModule], controllers: [DictionariesController, DictionaryItemsController, PublicDictionariesController], providers: [DictionariesService], exports: [DictionariesService] })
export class DictionariesModule {}
