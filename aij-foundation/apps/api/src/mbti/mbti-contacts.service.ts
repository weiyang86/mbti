import { Injectable } from "@nestjs/common";
import { MbtiContactRequest, MbtiPrivateContacts, Prisma } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { MbtiContactStorage } from "./mbti-contact-storage.service";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";
import { MbtiSocialService } from "./mbti-social.service";

type Tx = Prisma.TransactionClient;
const CHANNELS = ["wechat", "qq", "phone"] as const;
type Channel = typeof CHANNELS[number];
type Contacts = Partial<Record<Channel, string>>;
const patterns = { wechat: /^[a-zA-Z][a-zA-Z0-9_-]{5,19}$/, qq: /^[1-9]\d{4,11}$/, phone: /^1[3-9]\d{9}$/ };
const active = ["pending", "accepted"];
function invalid(): never { return reject(422, "INVALID_CONTACT_INPUT", "联系方式或申请参数无效"); }
function missing(): never { return reject(404, "NOT_FOUND", "资源不存在"); }
function conflict(): never { return reject(409, "CONTACT_CONFLICT", "当前状态或请求渠道不可用"); }
function unavailable(): never { return reject(503, "CONTACT_STORAGE_UNAVAILABLE", "联系方式暂不可用，请稍后重试"); }
function object(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid();
  return value as Record<string, unknown>;
}
function parseContacts(input: unknown): Contacts {
  const body = object(input, CHANNELS);
  const result: Contacts = {};
  for (const key of CHANNELS) if (Object.hasOwn(body, key)) {
    if (typeof body[key] !== "string") invalid();
    const value = body[key].trim();
    if (value && !patterns[key].test(value)) invalid();
    if (value) result[key] = value;
  }
  return result;
}
function parseChannels(input: unknown): Channel[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 3 || new Set(input).size !== input.length || input.some(key => !CHANNELS.includes(key))) invalid();
  return CHANNELS.filter(key => input.includes(key));
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** F5 business authorization over Foundation's private adapter; no FileAsset/scope impersonation.
 * Immutable objects are never removed as transaction compensation: commit ambiguity or another
 * reader must not lose a referenced object. Orphan/retired private objects need reviewed offline GC.
 * No plaintext or raw IO errors are logged, cached, or persisted in ordinary DB fields.
 */
@Injectable()
export class MbtiContactsService {
  constructor(private readonly prisma: PrismaService, private readonly social: MbtiSocialService, private readonly storage: MbtiContactStorage) {}

  noInput(query: unknown, body?: unknown) {
    object(query ?? {}, []);
    if (body !== undefined) object(body, []);
  }
  private transaction<T>(work: (tx: Tx) => Promise<T>) {
    // READ COMMITTED: after advisory lock acquisition every fact must be read freshly.
    return this.prisma.$transaction(work, { timeout: 20000 });
  }
  private async read(row: MbtiPrivateContacts | null): Promise<Contacts> {
    if (!row?.objectKey) return {};
    try {
      const bytes = await this.storage.read(row.ownerId, row.objectKey);
      if (bytes.length !== row.size || digest(bytes) !== row.checksum) unavailable();
      return parseContacts(JSON.parse(bytes.toString("utf8")));
    } catch { unavailable(); }
  }
  async mine(ownerId: string) {
    return this.transaction(async tx => {
      await this.social.lockOwners(tx, ownerId);
      return this.read(await tx.mbtiPrivateContacts.findUnique({ where: { ownerId } }));
    });
  }
  async replace(ownerId: string, input: unknown) {
    const next = parseContacts(input);
    return this.transaction(async tx => {
      await this.social.lockOwners(tx, ownerId);
      const row = await tx.mbtiPrivateContacts.upsert({ where: { ownerId }, create: { ownerId }, update: {} });
      if (JSON.stringify(await this.read(row)) === JSON.stringify(next)) return next;
      let reference: { objectKey: string | null; checksum: string | null; size: number } = { objectKey: null, checksum: null, size: 0 };
      if (Object.keys(next).length) {
        const bytes = Buffer.from(JSON.stringify(next));
        const objectKey = randomUUID();
        try { await this.storage.write(ownerId, objectKey, bytes); } catch { unavailable(); }
        reference = { objectKey, checksum: digest(bytes), size: bytes.length };
      }
      await tx.mbtiPrivateContacts.update({ where: { ownerId }, data: { ...reference, epoch: { increment: 1 } } });
      await tx.mbtiContactRequest.updateMany({ where: { recipientId: ownerId, status: { in: active } }, data: { status: "revoked" } });
      return next;
    });
  }
  async clear(ownerId: string) {
    return this.transaction(async tx => {
      await this.social.lockOwners(tx, ownerId);
      // Erasure of live reference/authorization remains possible even if old private bytes fail IO.
      await tx.mbtiPrivateContacts.updateMany({ where: { ownerId, objectKey: { not: null } }, data: { objectKey: null, checksum: null, size: 0, epoch: { increment: 1 } } });
      await tx.mbtiContactRequest.updateMany({ where: { recipientId: ownerId, status: { in: active } }, data: { status: "revoked" } });
    });
  }
  private async facts(tx: Tx, row: MbtiContactRequest) {
    const cards = await this.social.contactCards(tx, row.senderId, row.recipientId);
    const contact = await tx.mbtiPrivateContacts.findUnique({ where: { ownerId: row.recipientId } });
    const exchange = await tx.mbtiCardExchange.findUnique({ where: { id: row.exchangeId } });
    const bound = exchange && ((exchange.senderId === row.senderId && exchange.recipientId === row.recipientId) || (exchange.senderId === row.recipientId && exchange.recipientId === row.senderId));
    return { cards, contact, valid: !!cards && !!contact?.objectKey && contact.epoch === row.contactEpoch && !!bound && exchange.status === "accepted" };
  }
  private async projection(tx: Tx, ownerId: string, row: MbtiContactRequest) {
    const otherId = row.senderId === ownerId ? row.recipientId : row.senderId;
    const cards = await this.social.contactCards(tx, ownerId, otherId);
    if (!cards) return null;
    const live = await this.facts(tx, row);
    return { id: row.id, buddy_id: cards.second.id, direction: row.senderId === ownerId ? "outgoing" : "incoming",
      status: active.includes(row.status) && !live.valid ? "revoked" : row.status, channels: row.channels,
      created_at: row.createdAt.toISOString(), ...(row.respondedAt ? { responded_at: row.respondedAt.toISOString() } : {}), simulated: false };
  }
  async list(ownerId: string, input: unknown) {
    const query = object(input ?? {}, ["buddy_id"]);
    if (query.buddy_id !== undefined && (typeof query.buddy_id !== "string" || !query.buddy_id || query.buddy_id.length > 200)) invalid();
    return this.transaction(async tx => {
      // Lists expose no values; every item rechecks the current visibility and bound facts.
      const rows = await tx.mbtiContactRequest.findMany({ where: { OR: [{ senderId: ownerId }, { recipientId: ownerId }] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      const items = [];
      for (const row of rows) {
        const payload = await this.projection(tx, ownerId, row);
        if (payload && (query.buddy_id === undefined || payload.buddy_id === query.buddy_id)) items.push(payload);
      }
      return { items };
    });
  }
  async create(ownerId: string, input: unknown) {
    const body = object(input, ["buddy_id", "channels"]);
    if (typeof body.buddy_id !== "string" || !body.buddy_id || body.buddy_id.length > 200) invalid();
    const channels = parseChannels(body.channels);
    try {
      return await this.transaction(async tx => {
        const target = await tx.mbtiCard.findUnique({ where: { id: body.buddy_id as string } });
        if (!target) missing();
        if (target.ownerId === ownerId) invalid();
        await this.social.pairLock(tx, ownerId, target.ownerId);
        await this.social.lockOwners(tx, ownerId, target.ownerId);
        if (!await this.social.contactCards(tx, ownerId, target.ownerId)) missing();
        const exchange = await tx.mbtiCardExchange.findFirst({ where: { status: "accepted", OR: [{ senderId: ownerId, recipientId: target.ownerId }, { senderId: target.ownerId, recipientId: ownerId }] } });
        if (!exchange) conflict();
        const contact = await tx.mbtiPrivateContacts.findUnique({ where: { ownerId: target.ownerId } });
        const values = await this.read(contact);
        if (!contact?.objectKey || channels.some(key => !values[key])) conflict();
        const existing = await tx.mbtiContactRequest.findFirst({ where: { senderId: ownerId, recipientId: target.ownerId, status: { in: active } } });
        if (existing) {
          if (!(await this.facts(tx, existing)).valid) {
            await tx.mbtiContactRequest.update({ where: { id: existing.id }, data: { status: "revoked" } });
          } else {
            if (existing.status !== "pending" || JSON.stringify(existing.channels) !== JSON.stringify(channels)) conflict();
            return { created: false, payload: await this.projection(tx, ownerId, existing) };
          }
        }
        const row = await tx.mbtiContactRequest.create({ data: { id: `contact_${randomBytes(24).toString("base64url")}`, senderId: ownerId, recipientId: target.ownerId, exchangeId: exchange.id, contactEpoch: contact.epoch, channels } });
        return { created: true, payload: await this.projection(tx, ownerId, row) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") conflict();
      throw error;
    }
  }
  private async actionable(tx: Tx, ownerId: string, id: string) {
    const first = await tx.mbtiContactRequest.findUnique({ where: { id } });
    if (!first || (first.senderId !== ownerId && first.recipientId !== ownerId)) missing();
    await this.social.pairLock(tx, first.senderId, first.recipientId);
    await this.social.lockOwners(tx, first.senderId, first.recipientId);
    const row = await tx.mbtiContactRequest.findUniqueOrThrow({ where: { id } });
    const facts = await this.facts(tx, row);
    if (!facts.cards) missing();
    return { row, ...facts };
  }
  async respond(ownerId: string, id: string, input: unknown) {
    return this.transaction(async tx => {
      const { row, valid, contact } = await this.actionable(tx, ownerId, id);
      if (row.recipientId !== ownerId || row.status !== "pending" || !valid) conflict();
      const body = object(input, ["action"]);
      if (body.action !== "accept" && body.action !== "decline") invalid();
      // Accept exact requested set, freshly checked; IO failure cannot grant from cached contents.
      if (body.action === "accept") {
        const values = await this.read(contact);
        if (row.channels.some(key => !values[key as Channel])) conflict();
      }
      const updated = await tx.mbtiContactRequest.update({ where: { id }, data: { status: body.action === "accept" ? "accepted" : "declined", respondedAt: new Date() } });
      return this.projection(tx, ownerId, updated);
    });
  }
  async revoke(ownerId: string, id: string) {
    return this.transaction(async tx => {
      const { row } = await this.actionable(tx, ownerId, id);
      if (row.status === "revoked") return;
      if (!active.includes(row.status)) conflict();
      await tx.mbtiContactRequest.update({ where: { id }, data: { status: "revoked" } });
    });
  }
  async granted(ownerId: string, id: string) {
    return this.transaction(async tx => {
      const { row, valid, contact } = await this.actionable(tx, ownerId, id);
      if (row.senderId !== ownerId || row.status !== "accepted" || !valid) missing();
      const values = await this.read(contact);
      if (row.channels.some(key => !values[key as Channel])) missing();
      return { channels: row.channels.map(channel => ({ channel, value: values[channel as Channel]! })) };
    });
  }
}
