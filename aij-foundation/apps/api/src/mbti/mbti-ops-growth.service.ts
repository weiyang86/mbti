import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { reject } from "./mbti.http";

const CHANNELS = ["wechat", "mp", "douyin", "xhs"] as const;

/** Growth metrics only from MbtiGrowthEvent. Empty ledger => unavailable, never invented rates. */
@Injectable()
export class MbtiOpsGrowthService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: unknown) {
    const body = query && typeof query === "object" && !Array.isArray(query) ? query as Record<string, unknown> : {};
    if (Object.keys(body).some(k => !["from", "to", "channel"].includes(k)) ||
      typeof body.from !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.from) ||
      typeof body.to !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.to) || body.from > body.to) {
      reject(422, "INVALID_GROWTH_QUERY", "须提供有效 from/to（YYYY-MM-DD）");
    }
    const channel = body.channel === undefined || body.channel === "all" ? "all" : body.channel;
    if (channel !== "all" && (typeof channel !== "string" || !(CHANNELS as readonly string[]).includes(channel))) {
      reject(422, "INVALID_GROWTH_QUERY", "channel 无效");
    }
    const count = await this.prisma.mbtiGrowthEvent.count({
      where: {
        dayKey: { gte: body.from as string, lte: body.to as string },
        ...(channel === "all" ? {} : { channel }),
      },
    });
    if (count === 0) {
      return {
        schema: "mbti-ops-growth-summary-candidate/v1",
        status: "needs_human_review",
        interval: { from: body.from, to: body.to },
        channel,
        metrics: null,
        unavailableReason: "growth_events_unavailable",
        note: "无访问/预览/分享事件；不会用订单或 guest 数冒充渠道指标",
      };
    }
    const rows = await this.prisma.mbtiGrowthEvent.groupBy({
      by: ["channel", "eventType"],
      where: {
        dayKey: { gte: body.from as string, lte: body.to as string },
        ...(channel === "all" ? {} : { channel }),
      },
      _count: { _all: true },
    });
    return {
      schema: "mbti-ops-growth-summary-candidate/v1",
      status: "needs_human_review",
      interval: { from: body.from, to: body.to },
      channel,
      metrics: {
        by_channel_event: rows.map(row => ({ channel: row.channel, event_type: row.eventType, count: row._count._all })),
      },
      unavailableReason: null,
      note: "计数为事件行数，非去重用户；预览后付费率等衍生指标仍需成熟队列定义",
    };
  }
}
