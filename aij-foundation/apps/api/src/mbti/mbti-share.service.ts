import { HttpException, Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { MbtiResult } from "@prisma/client";
import { readApplicationEnvironment } from "../../../../scripts/runtime-environment.cjs";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";
import { object } from "./mbti.service";
import { TYPE_METAS } from "./mbti.types";

type Scene = "moments" | "avatar" | "meet_card";
const SCENES: Record<Scene, { width: number; height: number; title: string }> = {
  moments: { width: 1080, height: 1440, title: "分享我的 MBTI" },
  avatar: { width: 1080, height: 1080, title: "我的 MBTI 头像" },
  meet_card: { width: 1080, height: 1440, title: "很高兴认识你" }
};

// Only allowlisted type metadata enters the SVG. User labels, answers, IDs and credentials
// are deliberately absent, and no external URLs, scripts or embedded resources are used.
export function renderShareImage(typeCode: string, scene: Scene): Buffer {
  const meta = TYPE_METAS.find(item => item.type_code === typeCode);
  if (!meta) throw new Error("Unknown share type");
  const { width, height, title } = SCENES[scene];
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${meta.type_code} ${meta.name_zh}">
<defs><linearGradient id="paper" x2="1" y2="1"><stop stop-color="#ede8fb"/><stop offset="1" stop-color="#dceee6"/></linearGradient></defs>
<rect width="1080" height="${height}" fill="url(#paper)"/>
<circle cx="860" cy="260" r="290" fill="#7560df" opacity=".09"/>
<circle cx="140" cy="${height - 200}" r="270" fill="#70b393" opacity=".12"/>
<rect x="64" y="64" width="952" height="${height - 128}" rx="44" fill="#ffffff" fill-opacity=".76"/>
<g fill="#403650" font-family="PingFang SC, Microsoft YaHei, sans-serif">
<text x="120" y="170" font-size="30" letter-spacing="5">MBTI 搭子 / MY TYPE</text>
<text x="120" y="${Math.round(height * .33)}" font-size="38">${title}</text>
<text x="110" y="${Math.round(height * .53)}" font-size="184" font-weight="800" fill="#7560df">${meta.type_code}</text>
<text x="120" y="${Math.round(height * .63)}" font-size="58" font-weight="600">${meta.name_zh}</text>
<text x="120" y="${Math.round(height * .71)}" font-size="40">${meta.tagline}</text>
<path d="M120 ${height - 240} H960" stroke="#d9d1e7" stroke-width="2"/>
<text x="120" y="${height - 170}" font-size="29">每个类型，都有自己的精彩。</text>
<text x="120" y="${height - 116}" font-size="23" fill="#766e80">趣味人格探索 · 由本人主动分享</text>
</g></svg>`, "utf8");
}

function publicOrigin() {
  const env = readApplicationEnvironment();
  const url = new URL(env.MBTI_PUBLIC_ORIGIN || new URL(env.NEXT_PUBLIC_API_URL || "").origin);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid share origin");
  return url.origin;
}

@Injectable()
export class MbtiShareService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(ownerId: string, input: unknown) {
    const body = object(input);
    if (typeof body.result_id !== "string" || !body.result_id) reject(422, "INVALID_INPUT", "请选择分享结果");
    try {
      return await this.prisma.$transaction(async tx => {
        // Serialize with deletion: no stale result can create an orphan asset.
        const rows = await tx.$queryRaw<MbtiResult[]>`SELECT * FROM "MbtiResult" WHERE "id" = ${body.result_id} AND "ownerId" = ${ownerId} FOR UPDATE`;
        const result = rows[0];
        if (!result) reject(404, "NOT_FOUND", "资源不存在");
        const scene = body.scene ?? "moments";
        if (typeof scene !== "string" || !Object.hasOwn(SCENES, scene) || body.template_id !== undefined && body.template_id !== "default") reject(422, "INVALID_SHARE_STYLE", "分享场景或模板不可用");
        const origin = publicOrigin();
        const bytes = renderShareImage(result.typeCode, scene as Scene);
        const key = randomBytes(32).toString("hex");
        await tx.mbtiShareAsset.create({ data: { key, resultId: result.id, bytes: new Uint8Array(bytes) } });
        return { status: "ready", preview_url: `${origin}/api/v1/share/assets/${key}.svg` };
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      reject(503, "SHARE_PREVIEW_UNAVAILABLE", "分享预览暂不可用，请稍后重试");
    }
  }

  async asset(filename: string) {
    if (!/^[a-f0-9]{64}\.svg$/.test(filename)) reject(404, "NOT_FOUND", "资源不存在");
    const asset = await this.prisma.mbtiShareAsset.findUnique({ where: { key: filename.slice(0, -4) }, select: { bytes: true } });
    if (!asset) reject(404, "NOT_FOUND", "资源不存在");
    return Buffer.from(asset.bytes);
  }
}
