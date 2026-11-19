/** UTF-8 decoding and the upload byte limit also apply at the import boundary. */
export const KNOWLEDGE_CSV_LIMITS = Object.freeze({
  bytes: 50 * 1024, rows: 200, columns: 32, cellCharacters: 2000,
  headerCharacters: 100, contentCharacters: 50000
});

export class KnowledgeCsvError extends Error {}

/** Strict comma CSV, scanned once by Unicode code point; no formula evaluation. */
export function parseKnowledgeCsv(input: string): string {
  const limits = KNOWLEDGE_CSV_LIMITS;
  const fail = (message: string): never => { throw new KnowledgeCsvError(message); };
  if (Buffer.byteLength(input, "utf8") > limits.bytes) fail("CSV exceeds 50KiB");
  let headers: string[] | undefined;
  let row: string[] = [], cell = "", cellCharacters = 0;
  let state: "start" | "bare" | "quoted" | "closed" = "start";
  let pending = false, rows = 0, contentCharacters = 0;
  const sections: string[] = [];
  const append = (value: string) => {
    cellCharacters += 1;
    if (cellCharacters > (headers ? limits.cellCharacters : limits.headerCharacters)) fail("CSV cell or header is too long");
    cell += value;
  };
  const finishCell = () => {
    if (row.length >= limits.columns) fail("CSV exceeds 32 columns");
    row.push(cell); cell = ""; cellCharacters = 0; state = "start";
  };
  const finishRow = () => {
    finishCell();
    if (!headers) {
      headers = row.map(value => value.trim());
      if (headers.some(value => !value) || new Set(headers).size !== headers.length) fail("CSV headers must be non-empty and unique after trimming");
    } else {
      if (row.length !== headers.length) fail("CSV row has a different column count");
      if (rows >= limits.rows) fail("CSV exceeds 200 data rows");
      if (row.every(value => !value.trim())) fail("CSV data row is empty");
      rows += 1;
      // Indent embedded value newlines and escape header newlines for readable fields.
      const section = `${rows > 1 ? "\n\n" : ""}Row ${rows}\n` + row.map((value, index) =>
        `${headers![index].replaceAll("\n", "\\n")}: ${value.replaceAll("\n", "\n  ")}`).join("\n");
      contentCharacters += [...section].length;
      if (contentCharacters > limits.contentCharacters) fail("CSV generated content exceeds 50000 characters");
      sections.push(section);
    }
    row = []; pending = false;
  };
  for (let index = input.startsWith("\uFEFF") ? 1 : 0; index < input.length;) {
    const code = input.codePointAt(index)!;
    let character = String.fromCodePoint(code);
    index += character.length;
    if ((code < 32 && code !== 10 && code !== 13) || (code >= 127 && code <= 159) || (code >= 0xd800 && code <= 0xdfff)) {
      fail("CSV contains invalid text or controls");
    }
    if (character === "\r") {
      if (input[index] !== "\n") fail("CSV requires LF or CRLF line endings");
      index += 1; character = "\n";
    }
    if (character === '"') {
      pending = true;
      if (state === "start") state = "quoted";
      else if (state === "quoted") {
        if (input[index] === '"') { append('"'); index += 1; }
        else state = "closed";
      } else fail("CSV contains malformed quotes");
    } else if (state === "quoted") {
      pending = true; append(character);
    } else if (character === ",") {
      pending = true; finishCell();
    } else if (character === "\n") {
      finishRow();
    } else {
      if (state === "closed") fail("CSV contains text after a closing quote");
      pending = true; state = "bare"; append(character);
    }
  }
  if (state === "quoted") fail("CSV contains an unclosed quote");
  if (pending) finishRow();
  if (!headers || !rows) fail("CSV requires a header and at least one data row");
  return sections.join("");
}
