import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { readApplicationEnvironment } from "../../../../scripts/runtime-environment.cjs";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";
import { object } from "./mbti.service";

const GUEST_TOKEN = /^[A-Za-z0-9_-]{64}$/;
const SESSION_DAYS = 90;
const WECHAT_TIMEOUT_MS = 5000;

type Identity = { openId: string; unionId?: string; provider: "wechat" | "mock" };

/**
 * Mini-program login. The existing guest row stays the data owner, so a visitor can
 * bind its history by presenting the current guest token. A real code2Session call is
 * used only when the server has both appid and secret; otherwise development falls back
 * to a deterministic mock identity and production stays unavailable.
 */
@Injectable()
export class MbtiWechatAuthService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  async login(input: unknown) {
    const body = object(input);
    if (Object.keys(body).some(key => !["code", "guest_token"].includes(key))) reject(422, "INVALID_INPUT", "登录参数无效");
    if (typeof body.code !== "string" || !body.code || body.code.length > 256) reject(422, "INVALID_INPUT", "登录凭证无效");
    if (body.guest_token !== undefined && (typeof body.guest_token !== "string" || !GUEST_TOKEN.test(body.guest_token))) {
      reject(422, "INVALID_INPUT", "游客凭证格式无效");
    }
    const identity = await this.resolveIdentity(body.code);
    const token = randomBytes(48).toString("base64url");
    const tokenHash = this.hash(token);
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    try {
      const guestId = await this.bind(identity, typeof body.guest_token === "string" ? body.guest_token : "", tokenHash, expiresAt);
      return {
        token,
        guest_token: token,
        expires_at: expiresAt.toISOString(),
        user_id: guestId,
        provider: identity.provider,
        logged_in_at: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        reject(409, "IDENTITY_CONFLICT", "当前游客数据已绑定其他登录身份");
      }
      throw error;
    }
  }

  private async resolveIdentity(code: string): Promise<Identity> {
    const env = readApplicationEnvironment();
    const appid = (env.MBTI_WECHAT_APPID || "").trim();
    const secret = (env.MBTI_WECHAT_SECRET || "").trim();
    if (!appid || !secret) {
      if (env.NODE_ENV === "production") reject(503, "WECHAT_LOGIN_UNAVAILABLE", "微信登录暂不可用，请稍后重试");
      // Deterministic in development: the client keeps one mock code so re-login is stable.
      return { openId: "mock_" + createHash("sha256").update(code).digest("hex").slice(0, 40), provider: "mock" };
    }
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.searchParams.set("appid", appid);
    url.searchParams.set("secret", secret);
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");
    let payload: { openid?: unknown; unionid?: unknown; errcode?: unknown };
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(WECHAT_TIMEOUT_MS) });
      payload = await response.json() as { openid?: unknown; unionid?: unknown; errcode?: unknown };
    } catch {
      reject(503, "WECHAT_LOGIN_UNAVAILABLE", "微信登录暂不可用，请稍后重试");
    }
    const openid = payload.openid;
    if (payload.errcode !== undefined || typeof openid !== "string" || !openid) {
      reject(401, "WECHAT_LOGIN_FAILED", "微信登录失败，请重试");
    }
    return {
      openId: openid,
      ...(typeof payload.unionid === "string" && payload.unionid ? { unionId: payload.unionid } : {}),
      provider: "wechat",
    };
  }

  private bind(identity: Identity, guestToken: string, tokenHash: string, expiresAt: Date) {
    return this.prisma.$transaction(async tx => {
      // Serialize first logins for the same openId; unique indexes remain the final guard.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"mbti-wechat:" + identity.openId},0))`;
      const existing = await tx.mbtiWechatIdentity.findUnique({ where: { openId: identity.openId } });
      let guestId: string;
      if (existing) {
        guestId = existing.guestId;
      } else {
        const supplied = guestToken ? await tx.mbtiGuest.findUnique({ where: { tokenHash: this.hash(guestToken) } }) : null;
        if (supplied) {
          if (await tx.mbtiWechatIdentity.findUnique({ where: { guestId: supplied.id } })) {
            reject(409, "IDENTITY_CONFLICT", "当前游客数据已绑定其他登录身份");
          }
          guestId = supplied.id;
        } else {
          guestId = (await tx.mbtiGuest.create({ data: { tokenHash, expiresAt } })).id;
        }
      }
      // Rotate the data-owner token on every login; the previous token stops working.
      await tx.mbtiGuest.update({ where: { id: guestId }, data: { tokenHash, expiresAt } });
      if (existing) {
        await tx.mbtiWechatIdentity.update({
          where: { openId: identity.openId },
          data: { lastLoginAt: new Date(), ...(identity.unionId ? { unionId: identity.unionId } : {}) },
        });
      } else {
        await tx.mbtiWechatIdentity.create({
          data: { openId: identity.openId, ...(identity.unionId ? { unionId: identity.unionId } : {}), guestId },
        });
      }
      return guestId;
    }, { maxWait: 5000, timeout: 10000 });
  }
}
