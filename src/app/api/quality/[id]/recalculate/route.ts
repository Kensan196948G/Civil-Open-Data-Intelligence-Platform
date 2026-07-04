import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeTotalScore, deriveQualityScores } from "@/lib/quality";

type RouteContext = { params: Promise<{ id: string }> };

/** 品質スコア再計算: 現況から品質サブスコアを算出し quality_checks に記録する */
export async function POST(_request: NextRequest, context: RouteContext) {
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

  const scores = deriveQualityScores({
    organizationType: source.provider.organizationType,
    lastCheckedAt: source.lastCheckedAt,
    successCount,
    failureCount,
    licenseName: source.licenseName,
    commercialUse: source.commercialUse,
    dataFormat: source.dataFormat,
    category: source.category,
  });
  const totalScore = computeTotalScore(scores);

  const check = await prisma.qualityCheck.create({
    data: { dataSourceId: id, ...scores, totalScore },
  });

  await prisma.dataSource.update({
    where: { id },
    data: { qualityScore: totalScore },
  });

  return NextResponse.json({ ...check, totalScore });
}
