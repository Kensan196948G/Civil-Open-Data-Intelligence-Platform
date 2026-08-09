import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { requestId } from "@/lib/v1-response";
import { returnPeriods } from "@/lib/analysis/return-period";

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:analysis:wave50", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);
  const sp = request.nextUrl.searchParams;
  const siteId = sp.get("siteId");
  const method = sp.get("method") === "weibull" ? "weibull" : "gumbel";
  if (!siteId) {
    return NextResponse.json({ error: { code: "invalid_query", message: "siteId を指定してください" } }, { status: 400 });
  }
  const rows = await prisma.marineObservation.findMany({
    where: { siteId, sigWaveHM: { not: null }, source: { not: "open_meteo_marine_info" } },
    orderBy: { observedAt: "asc" },
  });
  if (rows.length < 2) {
    return NextResponse.json(
      { error: { code: "insufficient_data", message: "波高データが2件未満のため確率波推算を実行できません" } },
      { status: 422 },
    );
  }
  const yearMax = new Map<number, number>();
  for (const row of rows) {
    const y = row.observedAt.getUTCFullYear();
    const h = row.sigWaveHM as number;
    if (!yearMax.has(y) || h > (yearMax.get(y) as number)) {
      yearMax.set(y, h);
    }
  }
  const annualMax = [...yearMax.entries()].sort((a, b) => a[0] - b[0]).map(([year, maxWaveHM]) => ({ year, maxWaveHM: round(maxWaveHM) }));
  const values = annualMax.map((v) => v.maxWaveHM as number);
  if (values.length < 2) {
    return NextResponse.json({ error: { code: "insufficient_data", message: "年最大波高が2年分未満のため推算できません" } }, { status: 422 });
  }
  try {
    const periods = returnPeriods(values, method).map((p) => ({
      periodYears: p.periodYears,
      waveHM: round(p.value),
      warning: null,
    }));
    return NextResponse.json({
      data: {
        siteId,
        method,
        dataYears: values.length,
        sufficientData: values.length >= 10,
        annualMax,
        returnPeriods: periods,
        note: values.length < 10 ? "データが10年未満のため推定精度が低い可能性があります" : null,
      },
      meta: { requestId: requestId(), retrievedAt: new Date().toISOString() },
    });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "insufficient_data", message: error instanceof Error ? error.message : "推算に失敗しました" } },
      { status: 422 },
    );
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
