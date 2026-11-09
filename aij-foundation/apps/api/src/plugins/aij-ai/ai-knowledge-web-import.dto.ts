import { BadRequestException, Catch, HttpException, type ArgumentsHost, type ExceptionFilter, type PipeTransform } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";

export class ImportKnowledgeWebDto {
  documentCode!: string;
  title!: string;
  url!: string;
}

const invalid = (): never => { throw new BadRequestException("WEB_IMPORT_INVALID"); };
/** This pipe receives Object/unknown metadata so a global whitelist pipe cannot silently strip fields. */
export class KnowledgeWebImportBodyPipe implements PipeTransform<unknown, ImportKnowledgeWebDto> {
  transform(raw: unknown): ImportKnowledgeWebDto {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
    const fields = Object.keys(raw);
    if (fields.length !== 3 || fields.some(key => !["documentCode", "title", "url"].includes(key))) return invalid();
    const b = raw as Record<string, unknown>;
    if (typeof b.documentCode !== "string" || !/^[a-z0-9][a-z0-9._-]{1,79}$/.test(b.documentCode)
      || typeof b.title !== "string" || !b.title.trim() || b.title.length > 160
      || Array.from(b.title).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      || typeof b.url !== "string" || !b.url || b.url.length > 2048) return invalid();
    return { documentCode: b.documentCode, title: b.title, url: b.url };
  }
}

export class KnowledgeWebEmptyPipe implements PipeTransform {
  transform(value: unknown) {
    if (value !== undefined && (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length)) return invalid();
    return value;
  }
}

function webImportRoute(request: IncomingMessage): boolean {
  const path = (request.url ?? "").split("?")[0];
  return /^\/api\/client\/ai\/knowledge\/documents\/import-web\/?$/i.test(path)
    || /^\/api\/client\/ai\/knowledge\/documents\/[^/]+\/web-source\/?$/i.test(path);
}
/** Root must install BEFORE the JSON parser, CORS and guards, including their failure paths. */
export function knowledgeWebImportPrivateMiddleware(request: IncomingMessage, response: ServerResponse, next: () => void) {
  if (webImportRoute(request)) response.setHeader("Cache-Control", "private, no-store");
  next();
}
/** Root installs immediately after the JSON parser to sanitize parser/413 failures on these routes. */
export function knowledgeWebImportParserErrorMiddleware(error: { status?: number }, request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) {
  if (!webImportRoute(request)) { next(error); return; }
  const status = error?.status === 413 ? 413 : 400;
  response.setHeader("Cache-Control", "private, no-store");
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ statusCode: status, message: "WEB_IMPORT_INVALID" }));
}

/** Guard, DTO, transport and persistence exceptions never reflect URLs, content or causes. */
@Catch()
export class KnowledgeWebImportExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<ServerResponse>();
    const status = error instanceof HttpException ? error.getStatus() : 503;
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", "application/json");
    response.statusCode = status;
    response.end(JSON.stringify({ statusCode: status, message: status >= 500 ? "WEB_IMPORT_UNAVAILABLE" : "WEB_IMPORT_REJECTED" }));
  }
}
