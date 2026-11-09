import { Injectable } from "@nestjs/common";
import { MbtiCard, MbtiCardExchange, Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";
import { TYPE_METAS } from "./mbti.types";

type Tx = Prisma.TransactionClient;
const order = [{ createdAt: "desc" }, { id: "desc" }] as const;
const visibilityKeys = { name: "visibilityName", interests: "visibilityInterests", declaration: "visibilityDeclaration", manual: "visibilityManual" } as const;
function invalid(): never { return reject(422, "INVALID_SOCIAL_INPUT", "名片或社交请求参数无效"); }
function missing(): never { return reject(404, "NOT_FOUND", "资源不存在"); }
function conflict(): never { return reject(409, "SOCIAL_CONFLICT", "当前关系状态或操作角色不允许此操作"); }
const meta = (code: string) => TYPE_METAS.find(item => item.type_code === code);
const pairKey = (a: string, b: string) => [a, b].sort().join(":");
const opaqueId = (prefix: string) => `${prefix}_${randomBytes(24).toString("base64url")}`;
function object(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) invalid();
  return input as Record<string, unknown>;
}
function text(input: unknown, max: number) {
  if (typeof input !== "string") invalid();
  const value = input.trim();
  if ([...value].length > max) invalid();
  return value;
}

/** Single owner for F4 projections, bidirectional blocks, and pair-serialized transitions.
 * Candidate policy is recorded in docs/integration; never serialize Prisma rows to HTTP.
 */
@Injectable()
export class MbtiSocialService {
  constructor(private readonly prisma: PrismaService) {}

  noInput(query: unknown, body?: unknown) {
    object(query ?? {}, []);
    if (body !== undefined && body !== null) object(body, []);
  }
  private snapshot<T>(work: (tx: Tx) => Promise<T>) {
    return this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
  }
  async pairLock(tx: Tx, a: string, b: string) {
    // DB transaction lock spans create/respond/revoke/block/unblock, including across processes.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mbti-social-pair:${pairKey(a, b)}`}, 0))`;
  }
  /** Shared with F5: public opt-out and private epochs serialize with pair-authorized reads/writes.
   * Pair operations acquire pair first, then ordered owners; owner-only updates never acquire pair.
   */
  async lockOwners(tx: Tx, ...owners: string[]) {
    for (const owner of [...new Set(owners)].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mbti-social-owner:${owner}`}, 0))`;
    }
  }
  async contactCards(tx: Tx, a: string, b: string) {
    const first = await tx.mbtiCard.findUnique({ where: { ownerId: a } });
    const second = await tx.mbtiCard.findUnique({ where: { ownerId: b } });
    if (!first || !second || !await this.visible(tx, b, first) || !await this.visible(tx, a, second)) return null;
    return { first, second };
  }
  private async ownCard(tx: Tx, ownerId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mbti-card:${ownerId}`}, 0))`;
    const existing = await tx.mbtiCard.findUnique({ where: { ownerId } });
    if (existing) return existing;
    const latest = await this.latest(tx, ownerId);
    return tx.mbtiCard.create({ data: { id: opaqueId("card"), ownerId, typeCode: latest && meta(latest.typeCode) ? latest.typeCode : "" } });
  }
  private latest(tx: Tx, ownerId: string) {
    return tx.mbtiResult.findFirst({ where: { ownerId }, orderBy: [{ submittedAt: "desc" }, { id: "desc" }] });
  }
  private async mine(tx: Tx, row: MbtiCard) {
    const latest = await this.latest(tx, row.ownerId);
    return { id: row.id, nickname: row.nickname, type_code: row.typeCode, type_name: meta(row.typeCode)?.name_zh ?? "",
      declaration: row.declaration, interests: row.interests, style: row.style, discoverable: row.discoverable,
      visibility: { name: row.visibilityName, interests: row.visibilityInterests, declaration: row.visibilityDeclaration, manual: row.visibilityManual },
      has_visual_set: false, ...(latest && latest.typeCode === row.typeCode ? { latest_result_id: latest.id } : {}), updated_at: row.updatedAt.toISOString() };
  }
  async myCard(ownerId: string) {
    return this.prisma.$transaction(async tx => this.mine(tx, await this.ownCard(tx, ownerId)));
  }
  async updateCard(ownerId: string, input: unknown) {
    const body = object(input, ["nickname", "type_code", "declaration", "interests", "style", "visibility", "discoverable"]);
    const data: Prisma.MbtiCardUpdateInput = {};
    if (Object.hasOwn(body, "nickname")) data.nickname = text(body.nickname, 40);
    if (Object.hasOwn(body, "declaration")) data.declaration = text(body.declaration, 160);
    if (Object.hasOwn(body, "type_code")) {
      if (typeof body.type_code !== "string" || !meta(body.type_code)) invalid();
      data.typeCode = body.type_code;
    }
    if (Object.hasOwn(body, "style")) {
      if (typeof body.style !== "string" || !["illustration", "editorial", "game"].includes(body.style)) invalid();
      data.style = body.style;
    }
    if (Object.hasOwn(body, "discoverable")) {
      if (typeof body.discoverable !== "boolean") invalid();
      data.discoverable = body.discoverable;
    }
    if (Object.hasOwn(body, "interests")) {
      if (!Array.isArray(body.interests) || body.interests.length > 10) invalid();
      data.interests = [...new Set(body.interests.map(value => text(value, 24)).filter(Boolean))];
    }
    if (Object.hasOwn(body, "visibility")) {
      const partial = object(body.visibility, Object.keys(visibilityKeys));
      for (const key of Object.keys(visibilityKeys) as (keyof typeof visibilityKeys)[]) if (Object.hasOwn(partial, key)) {
        if (typeof partial[key] !== "boolean") invalid();
        data[visibilityKeys[key]] = partial[key];
      }
    }
    return this.prisma.$transaction(async tx => {
      await this.lockOwners(tx, ownerId);
      // Column-level patch plus owner lock prevents concurrent visibility subkey lost updates.
      const row = await this.ownCard(tx, ownerId);
      if ((body.discoverable ?? row.discoverable) && !meta((body.type_code ?? row.typeCode) as string)) invalid();
      if (body.discoverable === false) {
        await tx.mbtiContactRequest.updateMany({ where: { OR: [{ senderId: ownerId }, { recipientId: ownerId }], status: { in: ["pending", "accepted"] } }, data: { status: "revoked" } });
      }
      return this.mine(tx, await tx.mbtiCard.update({ where: { ownerId }, data }));
    });
  }
  /** Reused by all public projections and transitions; F5 must recheck this live fact too. */
  async isBlocked(tx: Tx, a: string, b: string) {
    return !!await tx.mbtiSocialBlock.findFirst({ where: { active: true, OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] }, select: { blockerId: true } });
  }
  private async cardById(tx: Tx, id: string) {
    const row = await tx.mbtiCard.findUnique({ where: { id } });
    if (!row) missing();
    return row;
  }
  private async visible(tx: Tx, observerId: string, row: MbtiCard) {
    return row.discoverable && !!meta(row.typeCode) && !await this.isBlocked(tx, observerId, row.ownerId);
  }
  private async requireVisible(tx: Tx, observerId: string, row: MbtiCard) {
    if (!await this.visible(tx, observerId, row)) missing();
    return row;
  }
  private publicProjection(row: MbtiCard) {
    return { id: row.id, nickname: row.visibilityName ? row.nickname : "", type_code: row.typeCode, type_name: meta(row.typeCode)!.name_zh,
      declaration: row.visibilityDeclaration ? row.declaration : "", interests: row.visibilityInterests ? row.interests : [], style: row.style,
      ...(row.visibilityManual ? { manual: {
        recharge: row.typeCode[0] === "I" ? "独处一会儿再出发，允许我慢慢恢复电量。" : "和熟悉的人一起活动，可能更容易让我恢复电量。",
        communication: row.typeCode[2] === "F" ? "先理解感受，再一起讨论下一步。" : "把事实和需求说清楚，一起看可行的办法。",
        care: row.typeCode[3] === "J" ? "重要安排提前说，我更容易安心。" : "留一点调整空间，我更容易投入。"
      } } : {}) };
  }
  async publicCard(ownerId: string, id: string) {
    return this.snapshot(async tx => this.publicProjection(await this.requireVisible(tx, ownerId, await this.cardById(tx, id))));
  }
  private async relation(tx: Tx, a: string, b: string) {
    const key = pairKey(a, b);
    // Active relation wins even if multiple creation timestamps tie at millisecond precision.
    return await tx.mbtiCardExchange.findFirst({ where: { pairKey: key, status: { in: ["pending", "accepted"] } } })
      ?? tx.mbtiCardExchange.findFirst({ where: { pairKey: key }, orderBy: [...order] });
  }
  private async summary(tx: Tx, observerId: string, row: MbtiCard, own: MbtiCard | null) {
    const card = this.publicProjection(row);
    const relation = await this.relation(tx, observerId, row.ownerId);
    return { id: card.id, nickname: card.nickname, type_code: card.type_code, type_name: card.type_name,
      avatar_text: card.type_code.slice(0, 2), avatar_color: "#53677a", tagline: meta(row.typeCode)!.tagline,
      interests: card.interests, same_type: !!own?.typeCode && own.typeCode === row.typeCode,
      shared_interests: own?.visibilityInterests ? card.interests.filter(item => own.interests.includes(item)) : [],
      exchange_status: relation?.status ?? "none", is_demo: false };
  }
  async buddies(ownerId: string, input: unknown) {
    const query = object(input ?? {}, ["mode", "type_code", "limit"]);
    const mode = query.mode ?? "recommend";
    if (mode !== "recommend" && mode !== "same") invalid();
    if (query.type_code !== undefined && (typeof query.type_code !== "string" || !meta(query.type_code))) invalid();
    if (query.limit !== undefined && (typeof query.limit !== "string" || !/^\d+$/.test(query.limit))) invalid();
    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid();
    return this.snapshot(async tx => {
      const own = await tx.mbtiCard.findUnique({ where: { ownerId } });
      if (mode === "same" && (!own?.typeCode || (query.type_code !== undefined && query.type_code !== own.typeCode))) invalid();
      const typeCode = mode === "same" ? own!.typeCode : query.type_code as string | undefined;
      // Filter BOTH block directions in SQL before stable ordering/take, not after pagination.
      const rows = await tx.mbtiCard.findMany({ where: { discoverable: true, ownerId: { not: ownerId }, ...(typeCode ? { typeCode } : {}),
        owner: { socialBlocksSent: { none: { active: true, blockedId: ownerId } }, socialBlocksReceived: { none: { active: true, blockerId: ownerId } } } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit });
      return { items: await Promise.all(rows.map(row => this.summary(tx, ownerId, row, own))) };
    });
  }
  async buddy(ownerId: string, id: string) {
    return this.snapshot(async tx => {
      const row = await this.requireVisible(tx, ownerId, await this.cardById(tx, id));
      const own = await tx.mbtiCard.findUnique({ where: { ownerId } });
      return { ...await this.summary(tx, ownerId, row, own), compatibility_hint: "相处方式因人而异，可以从尊重彼此的边界开始。" };
    });
  }
  async blocked(ownerId: string) {
    return this.snapshot(async tx => {
      const rows = await tx.mbtiSocialBlock.findMany({ where: { blockerId: ownerId, active: true },
        orderBy: [{ lastBlockedAt: "desc" }, { blockedId: "desc" }], select: { blocked: { select: { card: { select: { id: true } } } } } });
      return { items: rows.flatMap(row => row.blocked.card ? [{ id: row.blocked.card.id, nickname: "匿名搭子", type_code: "", type_name: "",
        avatar_text: "匿", avatar_color: "#53677a", tagline: "", interests: [], same_type: false, shared_interests: [], exchange_status: "none", is_demo: false }] : []) };
    });
  }
  async block(ownerId: string, id: string, active: boolean) {
    return this.prisma.$transaction(async tx => {
      // Known-ID management works after either-direction block or withdrawal from discovery.
      const target = await this.cardById(tx, id);
      if (target.ownerId === ownerId) invalid();
      await this.pairLock(tx, ownerId, target.ownerId);
      if (!active) {
        await tx.mbtiSocialBlock.updateMany({ where: { blockerId: ownerId, blockedId: target.ownerId, active: true }, data: { active: false } });
        return;
      }
      const existing = await tx.mbtiSocialBlock.findUnique({ where: { blockerId_blockedId: { blockerId: ownerId, blockedId: target.ownerId } } });
      if (!existing?.active) await tx.mbtiSocialBlock.upsert({ where: { blockerId_blockedId: { blockerId: ownerId, blockedId: target.ownerId } },
        create: { blockerId: ownerId, blockedId: target.ownerId }, update: { active: true, lastBlockedAt: new Date() } });
      await tx.mbtiCardExchange.updateMany({ where: { pairKey: pairKey(ownerId, target.ownerId), status: { in: ["pending", "accepted"] } }, data: { status: "revoked" } });
      await tx.mbtiContactRequest.updateMany({ where: { OR: [{ senderId: ownerId, recipientId: target.ownerId }, { senderId: target.ownerId, recipientId: ownerId }], status: { in: ["pending", "accepted"] } }, data: { status: "revoked" } });
      return { blocked: true };
    });
  }
  private async exchangeProjection(tx: Tx, observerId: string, row: MbtiCardExchange) {
    const otherId = row.senderId === observerId ? row.recipientId : row.senderId;
    const other = await tx.mbtiCard.findUnique({ where: { ownerId: otherId } });
    if (!other || !await this.visible(tx, observerId, other)) return null;
    const own = await tx.mbtiCard.findUnique({ where: { ownerId: observerId } });
    return { id: row.id, buddy_id: other.id, buddy: await this.summary(tx, observerId, other, own),
      direction: row.senderId === observerId ? "outgoing" : "incoming", status: row.status, created_at: row.createdAt.toISOString(),
      ...(row.respondedAt ? { responded_at: row.respondedAt.toISOString() } : {}), simulated: false };
  }
  private async requiredExchangeProjection(tx: Tx, ownerId: string, row: MbtiCardExchange) {
    const payload = await this.exchangeProjection(tx, ownerId, row);
    // A concurrent discovery opt-out must roll the write back, never return a null success.
    if (!payload) missing();
    return payload;
  }
  async exchanges(ownerId: string) {
    return this.snapshot(async tx => {
      const rows = await tx.mbtiCardExchange.findMany({ where: { OR: [{ senderId: ownerId }, { recipientId: ownerId }] }, orderBy: [...order] });
      const items = await Promise.all(rows.map(row => this.exchangeProjection(tx, ownerId, row)));
      return { items: items.filter(item => item !== null) };
    });
  }
  async createExchange(ownerId: string, input: unknown) {
    const body = object(input, ["buddy_id"]);
    if (typeof body.buddy_id !== "string" || !body.buddy_id || body.buddy_id.length > 200) invalid();
    try {
      return await this.prisma.$transaction(async tx => {
        const target = await this.cardById(tx, body.buddy_id as string);
        await this.pairLock(tx, ownerId, target.ownerId);
        await this.requireVisible(tx, ownerId, await this.cardById(tx, target.id));
        // Both participants must be readable before any new/retried pending is returned.
        // Do not lazily create a sender here: opting in is an explicit cards/me action.
        const sender = await tx.mbtiCard.findUnique({ where: { ownerId } });
        if (!sender) missing();
        await this.requireVisible(tx, target.ownerId, sender);
        if (target.ownerId === ownerId) invalid();
        const active = await tx.mbtiCardExchange.findFirst({ where: { pairKey: pairKey(ownerId, target.ownerId), status: { in: ["pending", "accepted"] } } });
        if (active) {
          if (active.status !== "pending" || active.senderId !== ownerId) conflict();
          return { created: false, payload: await this.requiredExchangeProjection(tx, ownerId, active) };
        }
        const row = await tx.mbtiCardExchange.create({ data: { id: opaqueId("exchange"), pairKey: pairKey(ownerId, target.ownerId), senderId: ownerId, recipientId: target.ownerId } });
        return { created: true, payload: await this.requiredExchangeProjection(tx, ownerId, row) };
      });
    } catch (error) {
      // The DB partial unique index remains a last defense, never an exposed SQL/500 response.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") conflict();
      throw error;
    }
  }
  private async actionable(tx: Tx, ownerId: string, id: string) {
    const first = await tx.mbtiCardExchange.findUnique({ where: { id } });
    if (!first || (first.senderId !== ownerId && first.recipientId !== ownerId)) missing();
    await this.pairLock(tx, first.senderId, first.recipientId);
    const row = await tx.mbtiCardExchange.findUniqueOrThrow({ where: { id } });
    const otherId = row.senderId === ownerId ? row.recipientId : row.senderId;
    const other = await tx.mbtiCard.findUnique({ where: { ownerId: otherId } });
    if (!other) missing();
    await this.requireVisible(tx, ownerId, other);
    return row;
  }
  async respond(ownerId: string, id: string, input: unknown) {
    return this.prisma.$transaction(async tx => {
      // Ownership/visibility precedes role/state/input disclosure, including invalid third-party bodies.
      const row = await this.actionable(tx, ownerId, id);
      if (row.recipientId !== ownerId || row.status !== "pending") conflict();
      const body = object(input, ["action"]);
      if (body.action !== "accept" && body.action !== "decline") invalid();
      const updated = await tx.mbtiCardExchange.update({ where: { id }, data: { status: body.action === "accept" ? "accepted" : "declined", respondedAt: new Date() } });
      return await this.requiredExchangeProjection(tx, ownerId, updated);
    });
  }
  async revoke(ownerId: string, id: string) {
    return this.prisma.$transaction(async tx => {
      const row = await this.actionable(tx, ownerId, id);
      if (row.senderId !== ownerId) conflict();
      if (row.status === "revoked") return;
      if (row.status !== "pending" && row.status !== "accepted") conflict();
      await tx.mbtiCardExchange.update({ where: { id }, data: { status: "revoked" } });
      await tx.mbtiContactRequest.updateMany({ where: { exchangeId: id, status: { in: ["pending", "accepted"] } }, data: { status: "revoked" } });
    });
  }
}
