import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { getOperationSettings } from "@/lib/settings";
import { computeTotalScore, deriveQualityScores } from "@/lib/quality";

type RouteContext = { params: Promise<{ id: string }> };

/** 品質スコア再計算: 現況から品質サブスコアを算出し quality_checks に記録する */
export async function POST(request: NextRequest, context: RouteContext) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:quality:recalculate", clientIdentifier(request), 20, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const { id } = await context.params;
  const source = await prisma.dataSource.findUnique({
    where: { id },
    include: { provider: true },
  });
  if (!source) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [successCount, failureCount] = await Promise.all([
    prisma.fetchLog.count({ where: { dataSourceId: id, success: true } }),
    prisma.fetchLog.count({ where: { dataSourceId: id, success: false } }),
  ]);

  const { staleDays } = await getOperationSettings();
  const scores = deriveQualityScores({
    organizationType: source.provider.organizationType,
    lastCheckedAt: source.lastCheckedAt,
    successCount,
    failureCount,
    licenseName: source.licenseName,
    commercialUse: source.commercialUse,
    dataFormat: source.dataFormat,
    category: source.category,
    staleDays,
  });
  const totalScore = computeTotalScore(scores);

  const [check] = await prisma.$transaction([
    prisma.qualityCheck.create({
      data: { dataSourceId: id, ...scores, totalScore },
    }),
    prisma.dataSource.update({
      where: { id },
      data: { qualityScore: totalScore },
    }),
  ]);

  await recordAudit({
    action: "品質スコア再計算",
    target: source.name,
    detail: `スコア: ${totalScore}`,
    level: "info",
  });

  return NextResponse.json({ ...check, totalScore });
}
