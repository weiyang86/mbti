import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { documentBody, documentId, documentObject, documentRevision } from "./personal-documents.dto";

export type PersonalDocumentSection = {
  id: string;
  index: number;
  title: string;
  level: number;
  start: number;
  end: number;
};

export type PersonalDocumentSectionIndex = {
  format: "aij-plain-sections-v1";
  documentId: string;
  revision: number;
  bodySha256: string;
  bodyLength: number;
  bodyByteLength: number;
  sections: PersonalDocumentSection[];
};

/** Index a single authorized snapshot; offsets always refer to its unmodified UTF16 body. */
export function buildPersonalDocumentSectionIndex(raw: unknown): PersonalDocumentSectionIndex {
  const source = documentObject(raw, ["id", "revision", "body"], ["id", "revision", "body"]);
  const id = documentId(source.id), revision = documentRevision(source.revision), body = documentBody(source.body);
  const sections: PersonalDocumentSection[] = [];
  let fence: { marker: string; length: number } | undefined;

  function append(start: number, title: string, level: number): void {
    if (sections.length >= 128) throw new BadRequestException("Personal document section limit exceeded");
    if (sections.length) sections[sections.length - 1].end = start;
    const index = sections.length;
    sections.push({ id: `section-${index}`, index, title, level, start, end: body.length });
  }

  for (let start = 0; start < body.length;) {
    let end = start;
    while (end < body.length && body[end] !== "\r" && body[end] !== "\n") end++;
    const line = body.slice(start, end);
    if (fence) {
      const closing = /^(`+|~+)[ \t]*$/.exec(line);
      if (closing && closing[0].length === line.length && closing[1][0] === fence.marker && closing[1].length >= fence.length) fence = undefined;
    } else {
      const opening = /^(`{3,}|~{3,})/.exec(line);
      if (opening) fence = { marker: opening[1][0], length: opening[1].length };
      else {
        const heading = /^(#{1,6})[ \t]+([\s\S]*)$/.exec(line);
        if (heading) {
          let titleStart = 0, titleEnd = heading[2].length;
          while (titleStart < titleEnd && (heading[2][titleStart] === " " || heading[2][titleStart] === "\t")) titleStart++;
          while (titleEnd > titleStart && (heading[2][titleEnd - 1] === " " || heading[2][titleEnd - 1] === "\t")) titleEnd--;
          const title = heading[2].slice(titleStart, titleEnd);
          const length = [...title].length;
          if (length < 1 || length > 256) throw new BadRequestException("Invalid personal document section title");
          if (!sections.length && start > 0) append(0, "正文", 0);
          append(start, title, heading[1].length);
        }
      }
    }
    start = end < body.length ? end + (body[end] === "\r" && body[end + 1] === "\n" ? 2 : 1) : end;
  }
  if (!sections.length) append(0, "正文", 0);
  return {
    format: "aij-plain-sections-v1", documentId: id, revision,
    bodySha256: createHash("sha256").update(body, "utf8").digest("hex"),
    bodyLength: body.length, bodyByteLength: Buffer.byteLength(body, "utf8"), sections
  };
}
