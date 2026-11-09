import { documentGenerationPrivateMiddleware, documentGenerationJsonVerify, documentGenerationParserErrorMiddleware } from './plugins/aij-ai/ai-personal-document-generation.http';
import { documentExportNoStore } from "./documents/personal-document-exports.controller";
import type { ExpressAdapter } from "@nestjs/platform-express";
import { personalDocumentNoStore, personalDocumentJsonVerify } from "./documents/personal-documents.controller";
import { knowledgeWebImportPrivateMiddleware, knowledgeWebImportParserErrorMiddleware } from "./plugins/aij-ai/ai-knowledge-web-import.dto";
import { knowledgeCitationPrivateMiddleware, knowledgeCitationParserErrorMiddleware } from "./plugins/aij-ai/ai-knowledge-citations.controller";
import type { KnowledgeWebImportTransport } from "./plugins/aij-ai/knowledge-web-import";
import { personalWorkflowPrivateMiddleware, personalWorkflowJsonVerify } from "./plugins/aij-ai/ai-personal-workflows.controller";
import { workflowExecutionPrivateMiddleware, workflowExecutionJsonVerify } from "./plugins/aij-ai/ai-personal-workflow-execution.controller";
import { scriptExecutionPrivateMiddleware, scriptExecutionJsonVerify } from './plugins/aij-ai/ai-personal-script-execution.controller';
import { personalAgentRunPreviewNoStore } from "./plugins/aij-ai/ai-personal-agent-run-previews.controller";
import { personalMemoryNoStore } from "./plugins/aij-ai/ai-personal-memories.controller";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { UnsupportedMediaTypeException, ValidationPipe } from "@nestjs/common";
import { loadRuntimeEnvironment } from "../../../scripts/runtime-environment.cjs";
import { AppModule } from "./app.module";
import { PluginCatalog } from "./plugin-runtime/plugin-catalog";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { correlateRequest } from "./common/interceptors/correlation.interceptor";
import type { IncomingMessage, ServerResponse } from "node:http";

function testBrowserOrigin(runtime: ReturnType<typeof loadRuntimeEnvironment>, value?: string) {
  if (value === undefined) return runtime.webUrl;
  if (runtime.nodeEnv !== "test" || runtime.environment !== "test") {
    throw new Error("Test browser origin override is available only in the test environment");
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Test browser origin must be a loopback HTTP origin"); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !/^\d{4,5}$/.test(url.port) || Number(url.port) < 1024 || Number(url.port) > 65535 ||
      [3655, 3656, 55432, 55433, 15435].includes(Number(url.port)) || url.pathname !== "/" ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("Test browser origin must be an unreserved loopback HTTP origin");
  }
  return url.origin;
}

export async function createApplication(options: { testBrowserOrigin?: string; pluginCatalog?: PluginCatalog; testKnowledgeWebImportTransport?: KnowledgeWebImportTransport } = {}) {
  const loadedRuntime = loadRuntimeEnvironment();
  const origin = testBrowserOrigin(loadedRuntime, options.testBrowserOrigin);
  const runtime = origin === loadedRuntime.webUrl ? loadedRuntime : Object.freeze({ ...loadedRuntime, webUrl: origin });
  const app = await NestFactory.create(AppModule.forRoot(runtime, options.pluginCatalog, options.testKnowledgeWebImportTransport), { rawBody: true });
  app.use(documentGenerationPrivateMiddleware);
  app.use(knowledgeWebImportPrivateMiddleware);
  app.use(knowledgeCitationPrivateMiddleware);
  app.use(personalAgentRunPreviewNoStore);
  app.use("/api/client/ai/personal-memories", personalMemoryNoStore);
  app.use("/api/client/documents", personalDocumentNoStore);
  app.use("/api/client/document-exports", documentExportNoStore);
  app.use(personalWorkflowPrivateMiddleware);
  app.use(workflowExecutionPrivateMiddleware);
  app.use(scriptExecutionPrivateMiddleware);
  // This JSON-only protocol must not inherit the host's form parser, which
  // cannot retain duplicate keys for the workflow verify hook.
  app.use((request: IncomingMessage, _response: ServerResponse, next: (error?: unknown) => void) => {
    if (/^\/api\/client\/workflow-executions(?:[/?]|$)/i.test(request.url ?? "") && request.method === "POST" &&
      (typeof request.headers["content-type"] !== "string" || !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(request.headers["content-type"]))) {
      next(new UnsupportedMediaTypeException("Workflow requests require UTF-8 JSON"));
      return;
    }
    next();
  });
  if (runtime.trustProxyHops > 0) app.getHttpAdapter().getInstance().set("trust proxy", runtime.trustProxyHops);
  app.setGlobalPrefix("api");
  app.enableCors({ origin, credentials: true, exposedHeaders: ["Content-Disposition", "X-Content-Type-Options", "X-AIJ-Document-Id", "X-AIJ-Document-Revision", "X-AIJ-Export-Id", "X-AIJ-Checksum-Sha256", "X-AIJ-Renderer-Version", "Content-Length", "X-AIJ-Script-Run-Id", "X-AIJ-Script-Version-Id", "X-AIJ-Asset-Id"] });
  app.use((request: IncomingMessage & { correlationId?: string }, response: ServerResponse, next: () => void) => { correlateRequest(request, response); next(); });
  // Same JSON limit/raw-body contract as the host; verify duplicate workflow keys before parsing.
  // Nest's rawBody option replaces a verify hook, so explicitly preserve the buffer here.
  const workflowParserOptions = { limit: "100kb", verify(request: IncomingMessage & { rawBody?: Buffer }, response: ServerResponse, buffer: Buffer) {
    request.rawBody = buffer;
    personalWorkflowJsonVerify(request, response, buffer);
    workflowExecutionJsonVerify(request, response, buffer);
    scriptExecutionJsonVerify(request, response, buffer);
    documentGenerationJsonVerify(request, response, buffer);
    if (/^\/api\/client\/document-exports(?:[/?]|$)/i.test(request.url ?? "")) personalDocumentJsonVerify(buffer);
  } };
  const httpAdapter = app.getHttpAdapter() as ExpressAdapter;
  // Only this document prefix accepts escaped 64KiB text beyond the host's 100KiB wire limit.
  httpAdapter.useBodyParser("json", false, { limit: "512kb", type(request) {
    return /^\/api\/client\/documents(?:[/?]|$)/i.test(request.url ?? "") &&
      /^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "");
  }, verify(request: IncomingMessage & { rawBody?: Buffer }, _response: ServerResponse, buffer: Buffer) {
    request.rawBody = buffer;
    personalDocumentJsonVerify(buffer);
  } });
  httpAdapter.useBodyParser("json", false, workflowParserOptions);
  app.use(documentGenerationParserErrorMiddleware);
  app.use(knowledgeWebImportParserErrorMiddleware);
  app.use(knowledgeCitationParserErrorMiddleware);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new TransformInterceptor());
  app.enableShutdownHooks();
  return app;
}
