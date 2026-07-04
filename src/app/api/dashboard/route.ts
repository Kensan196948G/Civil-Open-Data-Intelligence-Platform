import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { STALE_CHECK_DAYS } from "@/lib/constants";

export async function GET() {
  const staleBefore = new Date(Date.now() - STALE_CHECK_DAYS * 24 * 60 * 60 * 1000);

  const [
    total,
    active,
    failed,
    needsReview,
    byCategory,
    byProvider,
    recentLogs,
    recentSources,
  ] = await Promise.all([
    prisma.dataSource.count(),
    prisma.dataSource.count({ where: { status: "active" } }),
    prisma.dataSource.count({ where: { status: { in: ["unstable", "deprecated"] } } }),
    prisma.dataSource.count({
      where: {
        OR: [
          { status: "unknown" },
          { commercialUse: "unknown" },
          { lastCheckedAt: null },
          { lastCheckedAt: { lt: staleBefore } },
        ],
      },
    }),
    prisma.dataSource.groupBy({ by: ["category"], _count: { _all: true } }),
    prisma.dataSource.groupBy({ by: ["providerId"], _count: { _all: true } }),
    prisma.fetchLog.findMany({
      include: { dataSource: { select: { id: true, name: true } } },
      orderBy: { executedAt: "desc" },
      take: 10,
    }),
    prisma.dataSource.findMany({
      include: { provider: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const providers = await prisma.provider.findMany({
    where: { id: { in: byProvider.map((p) => p.providerId) } },
    select: { id: true, name: true },
  });
  const providerNameMap = new Map(providers.map((p) => [p.id, p.name]));

  return NextResponse.json({
    counts: { total, active, failed, needsReview },
    byCategory: byCategory.map((c) => ({ category: c.category, count: c._count._all })),
    byProvider: byProvider.map((p) => ({
      providerId: p.providerId,
      providerName: providerNameMap.get(p.providerId) ?? "不明",
      count: p._count._all,
    })),
    recentLogs,
    recentSources,
  });
}
