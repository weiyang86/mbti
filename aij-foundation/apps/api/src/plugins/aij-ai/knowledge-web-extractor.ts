import { createHash } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { Parser } from 'htmlparser2';
import type { KnowledgeWebContentType, KnowledgeWebReadResult } from './knowledge-web-reader';

export const KNOWLEDGE_WEB_EXTRACTION_VERSION = 'aij-knowledge-web-text/1' as const;
export const KNOWLEDGE_WEB_EXTRACTOR_POLICY = Object.freeze({
  maxSourceBytes: 1024 * 1024, maxDepth: 128, maxEvents: 100000,
  maxBlocks: 2000, maxTextBytes: 128 * 1024, maxTitleCharacters: 200, chunkCharacters: 4096,
});
const errorCodes = ['SOURCE_INVALID', 'NOT_MODIFIED', 'CONTENT_TYPE_REJECTED', 'SOURCE_TOO_LARGE',
  'TEXT_INVALID', 'CHECKSUM_MISMATCH', 'DEPTH_LIMIT', 'EVENT_LIMIT',
  'BLOCK_LIMIT', 'OUTPUT_LIMIT', 'TITLE_LIMIT', 'EMPTY_TEXT', 'CANCELLED', 'PARSE_FAILED'] as const;
export type KnowledgeWebExtractorErrorCode = typeof errorCodes[number];
/** Contains fixed codes only: no source content, URL, parser error/cause or abort reason. */
export class KnowledgeWebExtractorError extends Error {
  readonly code: KnowledgeWebExtractorErrorCode;
  constructor(code: KnowledgeWebExtractorErrorCode) {
    const safeCode = errorCodes.some(known => known === code) ? code : 'PARSE_FAILED';
    super(safeCode);
    this.name = 'KnowledgeWebExtractorError';
    this.code = safeCode;
  }
}
export interface KnowledgeWebExtraction {
  readonly extractionVersion: typeof KNOWLEDGE_WEB_EXTRACTION_VERSION;
  readonly contentType: KnowledgeWebContentType;
  readonly title: string | null;
  readonly text: string;
  readonly sourceChecksum: string;
  readonly textChecksum: string;
  readonly sourceByteLength: number;
  readonly textByteLength: number;
}
export interface KnowledgeWebExtractionOptions { readonly signal?: AbortSignal }
const policy = KNOWLEDGE_WEB_EXTRACTOR_POLICY;
function fail(code: KnowledgeWebExtractorErrorCode): never { throw new KnowledgeWebExtractorError(code); }
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) fail('CANCELLED'); }
function validateCharacters(value: string, signal?: AbortSignal): void {
  let offset = 0;
  for (const character of value) {
    if (offset++ % policy.chunkCharacters === 0) checkAbort(signal);
    const code = character.codePointAt(0)!;
    // Unicode scalar values only; reject replacement characters rather than accepting parser repairs.
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159)
      || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffd || code === 0xfeff) fail('TEXT_INVALID');
  }
}
function validateSource(source: KnowledgeWebReadResult, signal?: AbortSignal): {
  text: string; contentType: KnowledgeWebContentType; checksum: string; byteLength: number;
} {
  checkAbort(signal);
  if (!source || typeof source !== 'object') fail('SOURCE_INVALID');
  if (source.state === 'not-modified') fail('NOT_MODIFIED');
  if (source.state !== 'fetched') fail('SOURCE_INVALID');
  if (source.contentType !== 'text/html' && source.contentType !== 'text/plain') fail('CONTENT_TYPE_REJECTED');
  if (!Buffer.isBuffer(source.bytes) || !Number.isSafeInteger(source.byteLength)
    || source.byteLength !== source.bytes.length || typeof source.text !== 'string'
    || typeof source.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(source.checksum)) fail('SOURCE_INVALID');
  if (source.bytes.length > policy.maxSourceBytes || source.text.length > policy.maxSourceBytes) fail('SOURCE_TOO_LARGE');
  let decoded: string;
  try { decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source.bytes); }
  catch { return fail('TEXT_INVALID'); }
  if (decoded !== source.text || !Buffer.from(decoded, 'utf8').equals(source.bytes)) fail('TEXT_INVALID');
  validateCharacters(decoded, signal);
  const hash = createHash('sha256');
  for (let offset = 0; offset < source.bytes.length; offset += policy.chunkCharacters) {
    checkAbort(signal);
    hash.update(source.bytes.subarray(offset, offset + policy.chunkCharacters));
  }
  if (hash.digest('hex') !== source.checksum) fail('CHECKSUM_MISMATCH');
  // Snapshot scalar fields before yielding; never retain or read mutable source bytes/metadata again.
  return { text: decoded, contentType: source.contentType, checksum: source.checksum, byteLength: source.byteLength };
}

/** One bounded output buffer. Spaces collapse across parser callbacks, including entity callbacks. */
class TextSink {
  #value = '';
  #bytes = 0;
  #characters = 0;
  #blocks = 0;
  #space = false;
  #breaks = 0;
  #meaningful = false;
  constructor(readonly title = false) {}
  #append(value: string): void {
    this.#bytes += Buffer.byteLength(value, 'utf8');
    this.#characters += Array.from(value).length;
    if (this.title && this.#characters > policy.maxTitleCharacters) fail('TITLE_LIMIT');
    if (this.#bytes > policy.maxTextBytes) fail('OUTPUT_LIMIT');
    this.#value += value;
  }
  #start(): void {
    if (!this.#value || this.#breaks) {
      if (++this.#blocks > policy.maxBlocks) fail('BLOCK_LIMIT');
      if (this.#value) this.#append('\n'.repeat(this.#breaks));
      this.#breaks = 0;
      this.#space = false;
    }
  }
  write(value: string): void {
    for (const character of value) {
      if (/\s/u.test(character)) { this.#space = true; continue; }
      this.#start();
      if (this.#space && this.#value && !/[\n\t]$/.test(this.#value)) this.#append(' ');
      this.#space = false;
      this.#append(character);
      this.#meaningful = true;
    }
  }
  space(): void { this.#space = true; }
  boundary(lines = 1): void { this.#breaks = Math.max(this.#breaks, lines); this.#space = false; }
  plainNewline(): void { this.#breaks = Math.min(2, this.#breaks + 1); this.#space = false; }
  column(): void { this.#start(); this.#append('\t'); this.#space = false; }
  finish(): string { return this.#meaningful ? this.#value : ''; }
}

const excluded = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math',
  'canvas', 'form', 'input', 'textarea', 'select', 'button', 'option', 'optgroup', 'datalist', 'output', 'fieldset']);
const paragraphs = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre']);
const blocks = new Set(['address', 'article', 'aside', 'div', 'section', 'main', 'header', 'footer', 'nav', 'ul', 'ol',
  'dl', 'dt', 'dd', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tfoot', 'hr']);
interface Frame {
  name: string; id: number; blocked: boolean; inHead: boolean; ready: boolean; cells: number;
}
interface Budget { events: number; signal?: AbortSignal }
interface HtmlVisitor {
  open?(frame: Frame, stack: readonly Frame[]): void;
  close?(frame: Frame, stack: readonly Frame[]): void;
  text(value: string, stack: readonly Frame[]): void;
}
function hiddenStyle(value: string): boolean {
  return value.split(';').some(part => /^\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?$/i.test(part));
}
function visible(stack: readonly Frame[]): boolean {
  return !stack.some(frame => frame.blocked || frame.inHead || frame.name === 'title');
}
async function scanHtml(text: string, budget: Budget, visitor: HtmlVisitor): Promise<void> {
  const stack: Frame[] = [];
  let sequence = 0;
  const tick = () => { checkAbort(budget.signal); if (++budget.events > policy.maxEvents) fail('EVENT_LIMIT'); };
  const parser = new Parser({
    onopentagname(name) {
      tick();
      if (stack.length >= policy.maxDepth) fail('DEPTH_LIMIT');
      const parent = stack.at(-1);
      stack.push({ name, id: ++sequence, blocked: !!parent?.blocked || excluded.has(name),
        inHead: !!parent?.inHead || name === 'head', ready: false, cells: 0 });
    },
    onattribute(name, value) {
      tick();
      validateCharacters(value, budget.signal);
      const frame = stack.at(-1);
      if (!frame) fail('PARSE_FAILED');
      if (name === 'hidden' || (name === 'aria-hidden' && value.trim().toLowerCase() === 'true')
        || (name === 'style' && hiddenStyle(value))) frame.blocked = true;
    },
    onopentag() {
      tick();
      const frame = stack.at(-1);
      if (!frame) fail('PARSE_FAILED');
      frame.ready = true;
      visitor.open?.(frame, stack);
    },
    onclosetag(name) {
      tick();
      const frame = stack.at(-1);
      if (!frame || frame.name !== name) fail('PARSE_FAILED');
      if (frame.ready) visitor.close?.(frame, stack);
      stack.pop();
    },
    ontext(value) { tick(); validateCharacters(value, budget.signal); visitor.text(value, stack); },
    oncomment() { tick(); }, oncommentend() { tick(); }, onprocessinginstruction() { tick(); },
    oncdatastart() { tick(); }, oncdataend() { tick(); }, onend() { tick(); },
    onerror() { fail('PARSE_FAILED'); },
  }, { xmlMode: false, decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true,
    recognizeSelfClosing: false, recognizeCDATA: false });
  // Feed bounded chunks, yielding so a caller's AbortController can actually interrupt a large parse.
  for (let offset = 0; offset < text.length;) {
    checkAbort(budget.signal);
    let end = Math.min(offset + policy.chunkCharacters, text.length);
    if (end < text.length && /[\ud800-\udbff]/u.test(text[end - 1])) end--;
    parser.write(text.slice(offset, end));
    offset = end;
    await yieldTurn();
  }
  checkAbort(budget.signal);
  parser.end();
}
async function extractHtml(text: string, signal?: AbortSignal): Promise<{ text: string; title: string | null }> {
  const budget: Budget = { events: 0, signal };
  let article: number | undefined, main: number | undefined, body: number | undefined;
  let title: string | null = null;
  let titleSink = new TextSink(true);
  await scanHtml(text, budget, {
    close(frame) {
      if (title === null && frame.name === 'title' && frame.inHead && !frame.blocked) {
        title = titleSink.finish() || null;
        titleSink = new TextSink(true);
      }
    },
    text(value, stack) {
      if (title === null && stack.some(frame => frame.name === 'title' && frame.inHead) && !stack.some(frame => frame.blocked)) titleSink.write(value);
      if (!visible(stack) || !value.trim()) return;
      article ??= stack.find(frame => frame.name === 'article')?.id;
      main ??= stack.find(frame => frame.name === 'main')?.id;
      body ??= stack.find(frame => frame.name === 'body')?.id;
    },
  });
  const selected = article ?? main ?? body;
  const sink = new TextSink();
  const active = (stack: readonly Frame[]) => visible(stack) && (selected === undefined || stack.some(frame => frame.id === selected));
  const boundary = (frame: Frame, stack: readonly Frame[]) => {
    if (stack.some(ancestor => ancestor.name === 'td' || ancestor.name === 'th')
      && (paragraphs.has(frame.name) || blocks.has(frame.name) || ['li', 'tr', 'br'].includes(frame.name))) {
      sink.space();
      return;
    }
    if (paragraphs.has(frame.name)) sink.boundary(2);
    else if (blocks.has(frame.name) || ['li', 'tr', 'br'].includes(frame.name)) sink.boundary();
  };
  await scanHtml(text, budget, {
    open(frame, stack) {
      if (!active(stack)) return;
      boundary(frame, stack);
      if (frame.name === 'td' || frame.name === 'th') {
        const row = stack.slice().reverse().find(ancestor => ancestor.name === 'tr');
        if (row && row.cells++ > 0) sink.column();
      }
    },
    close(frame, stack) { if (active(stack)) boundary(frame, stack); },
    text(value, stack) { if (active(stack)) sink.write(value); },
  });
  return { text: sink.finish(), title };
}
async function extractPlain(text: string, signal?: AbortSignal): Promise<string> {
  const sink = new TextSink();
  for (let offset = 0; offset < text.length;) {
    checkAbort(signal);
    // Iterate scalars within each chunk without splitting surrogate pairs at chunk edges.
    let end = Math.min(offset + policy.chunkCharacters, text.length);
    if (end < text.length && /[\ud800-\udbff]/u.test(text[end - 1])) end--;
    for (let index = offset; index < end; index++) {
      const character = text[index];
      if (character === '\r') { sink.plainNewline(); }
      else if (character === '\n') { if (index === 0 || text[index - 1] !== '\r') sink.plainNewline(); }
      else if (/[\ud800-\udbff]/u.test(character)) { sink.write(text.slice(index, index + 2)); index++; }
      else sink.write(character);
    }
    offset = end;
    await yieldTurn();
  }
  checkAbort(signal);
  return sink.finish();
}
/** Pure extraction of untrusted DATA; no authorization inference, network, rendering or persistence. */
export async function extractKnowledgeWebText(source: KnowledgeWebReadResult, options: KnowledgeWebExtractionOptions = {}): Promise<KnowledgeWebExtraction> {
  try {
    checkAbort(options.signal);
    const input = validateSource(source, options.signal);
    const result = input.contentType === 'text/html' ? await extractHtml(input.text, options.signal)
      : { text: await extractPlain(input.text, options.signal), title: null };
    checkAbort(options.signal);
    if (!result.text.trim()) fail('EMPTY_TEXT');
    return Object.freeze({ extractionVersion: KNOWLEDGE_WEB_EXTRACTION_VERSION, contentType: input.contentType,
      title: result.title, text: result.text, sourceChecksum: input.checksum,
      textChecksum: createHash('sha256').update(result.text, 'utf8').digest('hex'),
      sourceByteLength: input.byteLength, textByteLength: Buffer.byteLength(result.text, 'utf8') });
  } catch (error) {
    let code: unknown;
    try {
      if (error instanceof KnowledgeWebExtractorError) code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
    } catch { /* Source getters may throw hostile exception objects; never expose them. */ }
    if (errorCodes.some(known => known === code)) throw new KnowledgeWebExtractorError(code as KnowledgeWebExtractorErrorCode);
    return fail('PARSE_FAILED');
  }
}
export default extractKnowledgeWebText;
