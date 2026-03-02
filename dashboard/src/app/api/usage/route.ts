import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [byModel, byDay, byServer, byWorkdir, totals] = await Promise.all([
    // Per-model breakdown
    prisma.usageEntry.groupBy({
      by: ["model"],
      where: { userId },
      _sum: { cost: true, inputTokens: true, outputTokens: true, cacheCreationInputTokens: true, cacheReadInputTokens: true },
      _count: true,
    }),
    // Daily breakdown (last 30 days)
    prisma.$queryRaw<Array<{ day: string; cost: number; tokens: bigint; entries: bigint }>>`
      SELECT
        TO_CHAR("timestamp", 'YYYY-MM-DD') AS day,
        SUM(cost)::float AS cost,
        SUM("inputTokens" + "outputTokens" + "cacheCreationInputTokens" + "cacheReadInputTokens") AS tokens,
        COUNT(*)::bigint AS entries
      FROM "UsageEntry"
      WHERE "userId" = ${userId}
        AND "timestamp" > NOW() - INTERVAL '30 days'
      GROUP BY day
      ORDER BY day
    `,
    // Per-server breakdown
    prisma.usageEntry.groupBy({
      by: ["serverId"],
      where: { userId },
      _sum: { cost: true, inputTokens: true, outputTokens: true, cacheCreationInputTokens: true, cacheReadInputTokens: true },
      _count: true,
      _min: { timestamp: true },
      _max: { timestamp: true },
    }),
    // Top workdirs by cost
    prisma.usageEntry.groupBy({
      by: ["workdir"],
      where: { userId },
      _sum: { cost: true },
      _count: true,
      orderBy: { _sum: { cost: "desc" } },
      take: 10,
    }),
    // Grand totals
    prisma.usageEntry.aggregate({
      where: { userId },
      _sum: { cost: true, inputTokens: true, outputTokens: true, cacheCreationInputTokens: true, cacheReadInputTokens: true },
      _count: true,
    }),
  ]);

  const s = totals._sum;
  const totalInput = s.inputTokens ?? 0;
  const totalOutput = s.outputTokens ?? 0;
  const totalCacheCreate = s.cacheCreationInputTokens ?? 0;
  const totalCacheRead = s.cacheReadInputTokens ?? 0;

  return NextResponse.json({
    totals: {
      cost: s.cost ?? 0,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheCreationInputTokens: totalCacheCreate,
      cacheReadInputTokens: totalCacheRead,
      totalTokens: totalInput + totalOutput + totalCacheCreate + totalCacheRead,
      entries: totals._count,
      cacheHitRate: totalInput + totalCacheCreate > 0
        ? totalCacheRead / (totalInput + totalCacheCreate + totalCacheRead)
        : 0,
    },
    byModel: byModel.map((m) => ({
      model: m.model,
      cost: m._sum.cost ?? 0,
      inputTokens: m._sum.inputTokens ?? 0,
      outputTokens: m._sum.outputTokens ?? 0,
      cacheCreationInputTokens: m._sum.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: m._sum.cacheReadInputTokens ?? 0,
      entries: m._count,
    })),
    byDay: byDay.map((d) => ({
      day: d.day,
      cost: d.cost,
      tokens: Number(d.tokens),
      entries: Number(d.entries),
    })),
    byServer: byServer.map((sv) => ({
      serverId: sv.serverId,
      cost: sv._sum.cost ?? 0,
      inputTokens: sv._sum.inputTokens ?? 0,
      outputTokens: sv._sum.outputTokens ?? 0,
      entries: sv._count,
      firstSeen: sv._min.timestamp?.toISOString() ?? "",
      lastSeen: sv._max.timestamp?.toISOString() ?? "",
    })),
    topWorkdirs: byWorkdir.map((w) => ({
      workdir: w.workdir,
      cost: w._sum.cost ?? 0,
      entries: w._count,
    })),
  });
}
