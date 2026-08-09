import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { requestId } from "@/lib/v1-response";

function status(lastObservedAt: Date | null, staleAfterMs: number): "ok" | "stale" | "unknown" {
  if (!lastObservedAt) return "unknown";
  return Date.now() - lastObservedAt.getTime() <= staleAfterMs ? "ok" : "stale";
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:etl:status", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);
  const [weatherCount, weatherMax, marineCount, marineMax, weatherAudit, marineAudit] = await Promise.all([
    prisma.weatherObservation.count(),
    prisma.weatherObservation.findFirst({ orderBy: { observedAt: "desc" } }),
    prisma.marineObservation.count(),
    prisma.marineObservation.findFirst({ orderBy: { observedAt: "desc" } }),
    prisma.auditLog.findFirst({ where: { action: "気象観測取り込み" }, orderBy: { occurredAt: "desc" } }),
    prisma.auditLog.findFirst({ where: { action: "海象観測取り込み" }, orderBy: { occurredAt: "desc" } }),
  ]);
  return NextResponse.json({
    data: {
      jobs: [
        {
          id: 1,
          name: "AMeDAS気象データ取得",
          source: "気象庁 AMeDAS",
          schedule: "10分毎",
          lastObservedAt: weatherMax?.observedAt ?? null,
          lastRunAt: weatherAudit?.occurredAt ?? null,
          status: status(weatherMax?.observedAt ?? null, 30 * 60_000),
          records: weatherCount,
        },
        {
          id: 2,
          name: "海象参考情報取得",
          source: "Open-Meteo Marine API（情報共有用）",
          schedule: "10分毎確認（参考情報・施工判断には使用しない）",
          lastObservedAt: marineMax?.observedAt ?? null,
          lastRunAt: marineAudit?.occurredAt ?? null,
          status: status(marineMax?.observedAt ?? null, 2 * 3600_000),
          records: marineCount,
        },
      ],
    },
    meta: { requestId: requestId(), retrievedAt: new Date().toISOString() },
  });
}
