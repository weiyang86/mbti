import { HttpException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { correlateRequest } from '../../common/interceptors/correlation.interceptor';
import { personalDocumentJsonVerify } from '../../documents/personal-documents.controller';
const routes = /^\/api\/client\/ai\/(?:document-generations|document-generation-runs|document-generation-requests)(?:[/?]|$)/i;
type Request = IncomingMessage & { correlationId?: string };
/** Prefix-wide, before parser/auth: rejected or unrecognized requests remain private. */
export function documentGenerationPrivateMiddleware(request: Request, response: ServerResponse, next: (error?: unknown) => void) {
  if (routes.test(request.url ?? '')) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!request.correlationId) correlateRequest(request, response);
    if (request.method === 'POST' && (typeof request.headers['content-type'] !== 'string' ||
      !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(request.headers['content-type']))) {
      next(new UnsupportedMediaTypeException('Document generation requires UTF-8 JSON')); return;
    }
  }
  next();
}
/** Reuse the existing exact JSON owner before duplicate keys or invalid UTF8 can be lost. */
export function documentGenerationJsonVerify(request: IncomingMessage, _response: ServerResponse, buffer: Buffer) {
  if (routes.test(request.url ?? '')) personalDocumentJsonVerify(buffer);
}
/** Parser errors never echo a raw instruction, JSON snippet or buffer. */
export function documentGenerationParserErrorMiddleware(error: unknown, request: IncomingMessage, _response: ServerResponse, next: (error?: unknown) => void) {
  if (!routes.test(request.url ?? '')) { next(error); return; }
  const status = error && typeof error === 'object' ? (error as { status?: number; statusCode?: number }).status ?? (error as { statusCode?: number }).statusCode : undefined;
  next(new HttpException('Invalid document generation request', status === 413 ? 413 : status === 415 ? 415 : 400));
}
