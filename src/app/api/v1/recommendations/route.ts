import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier } from "@/lib/rate-limit";
import { scoreDataSources, type RecommendationCandidate } from "@/lib/recommendations";
import { decisionNotSupportedWarning, requestId, v1RateLimitResponse } from "@/lib/v1-response";

function intParam(sp: URLSearchParams, name: string, fallback: number, min: number, max: number) {
  const raw = sp.get(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:recommendations", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return v1RateLimitResponse(rate);

  const sp = request.nextUrl.searchParams;
  const query = sp.get("query")?.trim() ?? "";
  const limit = intParam(sp, "limit", 5, 1, 20);
  if (limit === null) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "limit は1〜20の整数で指定してください" } },
      { status: 400 },
    );
  }
  if (query.length < 2) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "query は2文字以上で指定してください" } },
      { status: 400 },
    );
  }

  const sources = await prisma.dataSource.findMany({
    include: {
      tags: { include: { tag: true } },
      relatedUseCases: true,
    },
    orderBy: [{ qualityScore: "desc" }, { updatedAt: "desc" }],
    take: 500,
  });
  const recommendations = scoreDataSources(sources as unknown as RecommendationCandidate[], query, limit);
  return NextResponse.json({
    data: { recommendations },
    meta: {
      requestId: requestId(),
      retrievedAt: new Date().toISOString(),
      query,
      count: recommendations.length,
      mode: "rule_based_recommendations",
    },
    warnings: [
      {
        code: "rule_based_ai",
        severity: "info",
        message:
          "現行コンシェルジュはキーワード・品質・利用シーンによるルールベース推薦です。LLM/RAG導入はロードマップ上で段階的に進めます。",
      },
      decisionNotSupportedWarning,
    ],
  });
}
