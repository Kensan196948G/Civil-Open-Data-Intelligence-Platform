import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier } from "@/lib/rate-limit";
import {
  decisionNotSupportedWarning,
  qualityStatus,
  requestId,
  toIso,
  v1RateLimitResponse,
} from "@/lib/v1-response";
import { sanitizeUrl } from "@/lib/url-safety";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const rate = checkRateLimit("api:v1:sources:freshness", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return v1RateLimitResponse(rate);

  const { id } = await params;
  const source = await prisma.dataSource.findUnique({
    where: { id },
    include: { provider: true },
  });
  if (!source) {
    return NextResponse.json(
      { error: { code: "not_found", message: "指定されたデータソースが見つかりません" } },
      { status: 404 },
    );
  }

  const [lastSuccess, lastFailure] = await Promise.all([
    prisma.fetchLog.findFirst({
      where: { dataSourceId: id, success: true },
      orderBy: { executedAt: "desc" },
    }),
    prisma.fetchLog.findFirst({
      where: { dataSourceId: id, success: false },
      orderBy: { executedAt: "desc" },
    }),
  ]);
  const consecutiveFailureCount = await prisma.fetchLog.count({
    where: {
      dataSourceId: id,
      success: false,
      ...(lastSuccess ? { executedAt: { gt: lastSuccess.executedAt } } : {}),
    },
  });

  return NextResponse.json({
    data: {
      sourceId: source.id,
      title: source.name,
      category: source.category,
      provider: {
        id: source.provider.id,
        name: source.provider.name,
        organizationType: source.provider.organizationType,
      },
      sourceUrl: sanitizeUrl(source.officialUrl),
      licenseId: source.licenseName,
      status: source.status,
      qualityStatus: qualityStatus(source),
      qualityScore: source.qualityScore,
      lastCheckedAt: toIso(source.lastCheckedAt),
      lastSuccessAt: toIso(lastSuccess?.executedAt),
      lastFailureAt: toIso(lastFailure?.executedAt),
      consecutiveFailureCount,
      retrievedAt: new Date().toISOString(),
    },
    meta: {
      requestId: requestId(),
      retrievedAt: new Date().toISOString(),
      sourceCount: 1,
    },
    warnings: [
      {
        code: "freshness_metadata_only",
        severity: "info",
        message: "公開元データの鮮度確認支援APIです。",
        mode: "source_freshness",
        sourceId: source.id,
      },
      { ...decisionNotSupportedWarning, sourceId: source.id },
    ],
  });
}
