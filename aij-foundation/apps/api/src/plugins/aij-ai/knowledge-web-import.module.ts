import { DynamicModule, Global, Module } from "@nestjs/common";
import { KNOWLEDGE_WEB_IMPORT_TRANSPORT, KnowledgeWebImportTransport } from "./knowledge-web-import";

/** One application-composed transport; overrides belong only to isolated tests. */
@Global()
@Module({})
export class KnowledgeWebImportModule {
  static forRoot(runtime: Readonly<{ nodeEnv: string; environment: string }>, testTransport?: KnowledgeWebImportTransport): DynamicModule {
    if (testTransport !== undefined && (runtime.nodeEnv !== "test" || runtime.environment !== "test" || !(testTransport instanceof KnowledgeWebImportTransport))) {
      throw new Error("Knowledge web transport overrides are available only to isolated test applications");
    }
    return {
      module: KnowledgeWebImportModule,
      providers: [{ provide: KNOWLEDGE_WEB_IMPORT_TRANSPORT, useValue: testTransport ?? new KnowledgeWebImportTransport() }],
      exports: [KNOWLEDGE_WEB_IMPORT_TRANSPORT]
    };
  }
}
