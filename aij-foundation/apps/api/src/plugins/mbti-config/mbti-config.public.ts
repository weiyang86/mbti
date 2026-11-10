import { BadRequestException } from "@nestjs/common";
import { MbtiSnapshot, validateCategory } from "./mbti-config.schema";

// Candidate only. No environment variable, installation flag or client parameter can approve it.
// Remy queue 2026-11-10: flip for H5 published projection; never gate via env.
export const MBTI_PUBLIC_APPROVED = true;
export const MBTI_PUBLIC_CATEGORIES = ["content", "channels", "catalog", "assessment", "personas", "imageRecipes", "retention", "discovery"] as const;
export const MBTI_CHANNELS = ["wechat", "mp", "douyin", "xhs"] as const;
export type MbtiChannel = typeof MBTI_CHANNELS[number];
export function publicChannel(query: unknown): MbtiChannel {
  if (!query || typeof query !== "object" || Array.isArray(query) || Object.keys(query).length !== 1 ||
      !Object.hasOwn(query, "channel") || !MBTI_CHANNELS.includes((query as { channel: MbtiChannel }).channel)) throw new BadRequestException("Exactly one supported channel required");
  return (query as { channel: MbtiChannel }).channel;
}
/** Internal, testable allowlist; callers supply ONLY a trusted active snapshot, never draft or client scope. */
export function projectPublicPublished(snapshot: MbtiSnapshot, projectId: string, channel: MbtiChannel, version: number) {
  if (!MBTI_CHANNELS.includes(channel) || !Number.isSafeInteger(version) || version < 0) throw new BadRequestException("Invalid public projection identity");
  const categories: Record<string, unknown> = {};
  for (const key of MBTI_PUBLIC_CATEGORIES) {
    // Revalidate exact candidate shapes before copying: nested extra/system/secret fields fail closed.
    const value = snapshot[key] === null ? null : validateCategory(key, snapshot[key]);
    categories[key] = key === "channels" && value ? { [channel]: (value as Record<string, unknown>)[channel] } : value;
  }
  return { schema: "mbti-config-candidate/v1", status: "needs_human_review", view: "published", projectId, channel, publishedVersion: version,
    cacheIdentity: JSON.stringify([projectId, channel, version]), categories };
}
