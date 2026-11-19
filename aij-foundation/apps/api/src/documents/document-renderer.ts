import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { Document, Packer, Paragraph, TextRun, Tab, HeadingLevel } from "docx";
import PDFDocument from "pdfkit";

export type DocumentRenderInput = { format: "docx" | "pdf"; name: string; body: string };
export type DocumentRenderOptions = { fontPath: string; fontSha256: string };
export type DocumentRenderResult = {
  format: "docx" | "pdf"; mimeType: string; bytes: Buffer; size: number; sha256: string;
  pageCount: number | null; rendererVersion: "aij-plain-document-v1";
};
export const DOCUMENT_RENDERER_VERSION = "aij-plain-document-v1" as const;
export const DOCUMENT_FONT_SHA256 = "2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b";
export const DOCUMENT_MAX_OUTPUT = 5 * 1024 * 1024;
export type DocumentRenderErrorCode = "INVALID_INPUT" | "FONT_UNAVAILABLE" | "FONT_MISMATCH" | "UNSUPPORTED_GLYPH" | "PAGE_LIMIT" | "OUTPUT_LIMIT" | "RENDER_FAILED";
export class DocumentRenderError extends Error {
  constructor(readonly code: DocumentRenderErrorCode) { super(code); this.name = "DocumentRenderError"; }
}
function fail(code: DocumentRenderErrorCode): never { throw new DocumentRenderError(code); }
function inputValue(raw: unknown): DocumentRenderInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) fail("INVALID_INPUT");
  const keys = Reflect.ownKeys(raw);
  if (keys.length !== 3 || keys.some(k => typeof k !== "string" || !["format", "name", "body"].includes(k) || (!Object.getOwnPropertyDescriptor(raw, k)!.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(raw, k)!, "value")))) fail("INVALID_INPUT");
  const { format, name, body } = raw as DocumentRenderInput;
  if (format !== "docx" && format !== "pdf") fail("INVALID_INPUT");
  if (typeof name !== "string" || name.length > 320 || name !== name.trim() || [...name].length < 1 || [...name].length > 160 || !/[^\p{White_Space}\p{Cf}\p{M}]/u.test(name) || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(name)) fail("INVALID_INPUT");
  if (typeof body !== "string" || Buffer.byteLength(body, "utf8") > 65536 || Buffer.from(body, "utf8").toString("utf8") !== body || [...body].some(c => { const n = c.codePointAt(0)!; return n < 32 && ![9, 10, 13].includes(n) || n >= 127 && n <= 159; })) fail("INVALID_INPUT");
  if (body.split(/\r\n|\r|\n/).length > 2048) fail("INVALID_INPUT");
  return { format, name, body };
}
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function fontDocument(font: Buffer): PDFKit.PDFDocument {
  const doc = new PDFDocument({ font: null as unknown as string, size: "A4", margin: 72, autoFirstPage: false, compress: true, info: { Producer: DOCUMENT_RENDERER_VERSION, Creator: DOCUMENT_RENDERER_VERSION } });
  doc.font(font);
  return doc;
}
function checkCoverage(doc: PDFKit.PDFDocument, input: DocumentRenderInput) {
  // PDFKit's pinned embedded font implementation delegates coverage to fontkit.
  const embedded = (doc as unknown as { _font: { font: { hasGlyphForCodePoint(n: number): boolean } } })._font.font;
  for (const c of new Set(input.name + input.body + " ")) {
    const n = c.codePointAt(0)!;
    if ([9, 10, 13].includes(n)) continue;
    if (n === 0xfffe || n === 0xffff || !embedded.hasGlyphForCodePoint(n)) fail("UNSUPPORTED_GLYPH");
  }
}
function tabs(text: string): string {
  let column = 0;
  return [...text].map(c => { if (c === "\t") { const n = 4 - column % 4; column += n; return " ".repeat(n); } column++; return c; }).join("");
}
async function pdf(doc: PDFKit.PDFDocument, input: DocumentRenderInput): Promise<{ bytes: Buffer; pageCount: number }> {
  return new Promise((resolve, reject) => {
    let size = 0, pageCount = 0, settled = false;
    const chunks: Buffer[] = [];
    const abort = (error: unknown) => { if (settled) return; settled = true; chunks.length = 0; doc.destroy(); reject(error); };
    doc.on("error", () => abort(new DocumentRenderError("RENDER_FAILED")));
    doc.on("data", (chunk: Buffer) => { size += chunk.length; if (size > DOCUMENT_MAX_OUTPUT) abort(new DocumentRenderError("OUTPUT_LIMIT")); else if (!settled) chunks.push(chunk); });
    doc.on("end", () => { if (!settled) { settled = true; resolve({ bytes: Buffer.concat(chunks, size), pageCount }); } });
    doc.on("pageAdded", () => { if (++pageCount > 100) fail("PAGE_LIMIT"); });
    try {
      doc.addPage();
      doc.fontSize(18).text(input.name, { lineGap: 4 });
      doc.moveDown(0.7).fontSize(11);
      for (const line of input.body.split(/\r\n|\r|\n/)) {
        // Empty paragraphs consume a real line; TABs use deterministic four-column stops.
        doc.text(tabs(line) || " ", { lineGap: 4 });
      }
      doc.end();
    } catch (error) { abort(error); }
  });
}
function wordRuns(line: string): TextRun[] {
  return line.split("\t").flatMap((part, i) => [ ...(i ? [new TextRun({ children: [new Tab()] })] : []), new TextRun({ text: part, font: { ascii: "Noto Sans CJK SC", hAnsi: "Noto Sans CJK SC", eastAsia: "Noto Sans CJK SC", cs: "Noto Sans CJK SC" } }) ]);
}
export async function renderPlainDocument(raw: unknown, options: DocumentRenderOptions): Promise<DocumentRenderResult> {
  let doc: PDFKit.PDFDocument | undefined;
  try {
    const input = inputValue(raw);
    if (!options || options.fontSha256 !== DOCUMENT_FONT_SHA256) fail("FONT_MISMATCH");
    let font: Buffer;
    try {
      const handle = await open(options.fontPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size !== 16437364) fail("FONT_MISMATCH");
        font = Buffer.alloc(16437364);
        let offset = 0;
        while (offset < font.length) {
          const { bytesRead } = await handle.read(font, offset, font.length - offset, offset);
          if (!bytesRead) fail("FONT_MISMATCH");
          offset += bytesRead;
        }
        if ((await handle.stat()).size !== font.length) fail("FONT_MISMATCH");
      } finally { await handle.close(); }
    } catch (error) {
      if (error instanceof DocumentRenderError) throw error;
      fail("FONT_UNAVAILABLE");
    }
    if (font.length !== 16437364 || digest(font) !== DOCUMENT_FONT_SHA256) fail("FONT_MISMATCH");
    doc = fontDocument(font);
    checkCoverage(doc, input);
    let bytes: Buffer, pageCount: number | null = null;
    if (input.format === "pdf") ({ bytes, pageCount } = await pdf(doc, input));
    else {
      doc.destroy();
      bytes = await Packer.toBuffer(new Document({
        creator: DOCUMENT_RENDERER_VERSION, title: input.name,
        styles: { default: { document: { run: { font: "Noto Sans CJK SC", size: 22 }, paragraph: { spacing: { after: 100, line: 320 } } } } },
        sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: input.name, bold: true, size: 36, font: { eastAsia: "Noto Sans CJK SC", ascii: "Noto Sans CJK SC", hAnsi: "Noto Sans CJK SC" } })] }),
          ...input.body.split(/\r\n|\r|\n/).map(line => new Paragraph({ children: wordRuns(line), tabStops: [1,2,3,4,5,6,7,8,9,10].map(n => ({ type: "left" as const, position: n * 440 })) })),
        ] }],
      }));
    }
    if (bytes.length > DOCUMENT_MAX_OUTPUT) fail("OUTPUT_LIMIT");
    return { format: input.format, mimeType: input.format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf", bytes, size: bytes.length, sha256: digest(bytes), pageCount, rendererVersion: DOCUMENT_RENDERER_VERSION };
  } catch (error) {
    doc?.destroy();
    if (error instanceof DocumentRenderError) throw error;
    fail("RENDER_FAILED");
  }
}
