import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isAdminHeaders } from "@/lib/admin-auth";
import { getOperationSettings } from "@/lib/settings";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { safeFetchLogDto } from "@/lib/operational-dto";
import { safeSourceDto } from "@/lib/source-dto";

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:dashboard", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const includeLogs = isAdminHeaders(request.headers);
  const { staleDays } = await getOperationSettings();
  const staleBefore = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

  const [
    total,
    active,
    failed,
    needsReview,
    byCategory,
    byProvider,
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
  const recentLogs = includeLogs
    ? await prisma.fetchLog.findMany({
        include: { dataSource: { select: { id: true, name: true } } },
        orderBy: { executedAt: "desc" },
        take: 10,
      })
    : [];

  return NextResponse.json({
    counts: { total, active, failed, needsReview },
    byCategory: byCategory.map((c) => ({ category: c.category, count: c._count._all })),
    byProvider: byProvider.map((p) => ({
      providerId: p.providerId,
      providerName: providerNameMap.get(p.providerId) ?? "不明",
      count: p._count._all,
    })),
    recentLogs: recentLogs.map((log) => safeFetchLogDto(log)),
    sensitiveOperationalData: includeLogs ? "included" : "requires_admin",
    recentSources: recentSources.map((source) => safeSourceDto(source)),
  });
}
