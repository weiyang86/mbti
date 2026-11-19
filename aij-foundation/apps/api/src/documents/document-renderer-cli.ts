import { TextDecoder } from "node:util";
import { renderPlainDocument, DOCUMENT_FONT_SHA256, DocumentRenderError } from "./document-renderer";

// No flags, environment overrides, host paths, or body logging at this boundary.
export async function runDocumentRendererCli(): Promise<void> {
  const onOutputError = () => { process.exitCode = 1; };
  process.stdout.on("error", onOutputError);
  process.stderr.on("error", onOutputError);
  try {
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 80 * 1024) throw new Error("INVALID_INPUT");
      chunks.push(Buffer.from(chunk));
    }
    const request: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length)));
    if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).length !== 1 || !Object.hasOwn(request, "input")) throw new Error("INVALID_INPUT");
    const result = await renderPlainDocument((request as { input: unknown }).input, {
      fontPath: "/aij/assets/document-fonts/NotoSansCJKsc-Regular.otf", fontSha256: DOCUMENT_FONT_SHA256,
    });
    const base64 = result.bytes.toString("base64");
    if (base64.length > 4 * Math.ceil(5 * 1024 * 1024 / 3)) throw new Error("OUTPUT_LIMIT");
    const line = JSON.stringify({ schemaVersion: 1, format: result.format, mimeType: result.mimeType, size: result.size,
      sha256: result.sha256, pageCount: result.pageCount, rendererVersion: result.rendererVersion, base64 }) + "\n";
    if (Buffer.byteLength(line) > 8 * 1024 * 1024) throw new Error("OUTPUT_LIMIT");
    await new Promise<void>((resolve, reject) => process.stdout.write(line, error => error ? reject(error) : resolve()));
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write((error instanceof DocumentRenderError ? error.code : "INVALID_INPUT") + "\n");
  }
}
if (require.main === module) void runDocumentRendererCli();
