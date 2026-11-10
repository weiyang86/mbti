import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { reject } from "./mbti.http";

export const OPS_EXPORT_MAX = 5000;
const DAY = 86_400_000;
const invalid = (): never => reject(422, "INVALID_ORDER_QUERY", "订单筛选或分页格式无效");
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export type OrderFilters = { q?: string; status?: string; product_code?: string; from?: string; to?: string };
export type OrderQuery = { filters: OrderFilters; limit: number; fingerprint: string; cursor?: { createdAt: Date; id: string }; channel?: string };
function date(value: string, now: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2000-01-01" || value > now.toISOString().slice(0, 10)) invalid();
  const time = Date.parse(value + "T00:00:00.000Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) invalid();
  return time;
}
export function parseOrderQuery(value: unknown, summary = false, now = new Date()): OrderQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const query = value as Record<string, unknown>;
  const keys = summary ? ["from", "to", "channel"] : ["q", "status", "product_code", "from", "to", "limit", "cursor"];
  if (Object.keys(query).some(key => !keys.includes(key) || typeof query[key] !== "string" || !(query[key] as string).length)) invalid();
  const filters: OrderFilters = {};
  for (const key of ["q", "status", "product_code", "from", "to"] as const) if (query[key] !== undefined) filters[key] = query[key] as string;
  if (filters.q !== undefined && !identifier.test(filters.q)) invalid();
  if (filters.status !== undefined && !["pending", "paid", "failed"].includes(filters.status)) invalid();
  if (filters.product_code !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(filters.product_code)) invalid();
  if (!!filters.from !== !!filters.to || summary && !filters.from) invalid();
  if (filters.from && filters.to) {
    const start = date(filters.from, now), end = date(filters.to, now);
    if (end < start || (end - start) / DAY + 1 > 366) invalid();
  }
  const limit = query.limit === undefined ? 20 : /^[1-9][0-9]{0,2}$/.test(query.limit as string) ? Number(query.limit) : 0;
  if (limit < 1 || limit > 100) invalid();
  // Page size is part of the fingerprint. Canonical key order is independent of query parameter order.
  const fingerprint = createHash("sha256").update(JSON.stringify([filters.q ?? null, filters.status ?? null, filters.product_code ?? null, filters.from ?? null, filters.to ?? null, limit])).digest("hex");
  let cursor: OrderQuery["cursor"];
  if (query.cursor !== undefined) {
    const raw = query.cursor as string;
    if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw) || Buffer.from(raw, "base64url").toString("base64url") !== raw) invalid();
    let parsedRaw: unknown;
    try { parsedRaw = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")); } catch { invalid(); }
    if (!Array.isArray(parsedRaw) || parsedRaw.length !== 4) invalid();
    const cells = parsedRaw as unknown[];
    const version = cells[0], fp = cells[1], at = cells[2], id = cells[3];
    if (typeof at !== "string" || typeof id !== "string" || version !== 1 || fp !== fingerprint ||
      new Date(at).toISOString() !== at || !identifier.test(id)) invalid();
    // invalid() is never-returning; assertions keep the cursor typed after the guard.
    cursor = { createdAt: new Date(at as string), id: id as string };
  }
  const channel = query.channel as string | undefined;
  if (channel !== undefined && !["all", "wechat", "mp", "douyin", "xhs"].includes(channel)) invalid();
  return { filters, limit, fingerprint, ...(cursor ? { cursor } : {}), ...(channel ? { channel } : {}) };
}
export function orderWhere(query: OrderQuery): Prisma.MbtiOrderWhereInput {
  const f = query.filters;
  return { AND: [
    ...(f.q ? [{ OR: [{ id: f.q }, { resultId: f.q }] }] : []),
    ...(f.status ? [{ status: f.status }] : []),
    ...(f.product_code ? [{ productCode: f.product_code }] : []),
    ...(f.from && f.to ? [{ createdAt: { gte: new Date(f.from + "T00:00:00.000Z"), lt: new Date(Date.parse(f.to + "T00:00:00.000Z") + DAY) } }] : []),
    ...(query.cursor ? [{ OR: [{ createdAt: { lt: query.cursor.createdAt } }, { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } }] }] : [])
  ] };
}
export function orderCursor(query: OrderQuery, row: { createdAt: Date; id: string }) {
  return Buffer.from(JSON.stringify([1, query.fingerprint, row.createdAt.toISOString(), row.id])).toString("base64url");
}
export function csvCell(value: string | number | boolean) {
  let text = String(value);
  // Quote all cells; prefix possible spreadsheet formulas, even after whitespace/control characters.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
