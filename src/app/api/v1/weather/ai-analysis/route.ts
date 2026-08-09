import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { decisionNotSupportedWarning, requestId } from "@/lib/v1-response";

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:weather:ai-analysis", clientIdentifier(request), 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);
  const sp = request.nextUrl.searchParams;
  const siteId = sp.get("siteId");
  const workType = sp.get("workType") ?? "concrete";
  if (!siteId) {
    return NextResponse.json({ error: { code: "invalid_query", message: "siteId を指定してください" } }, { status: 400 });
  }
  const site = await prisma.constructionSite.findUnique({ where: { id: siteId } });
  if (!site) {
    return NextResponse.json({ error: { code: "not_found", message: "現場が見つかりません" } }, { status: 404 });
  }
  const [weather, marine, decision] = await Promise.all([
    prisma.weatherObservation.findFirst({ where: { siteId }, orderBy: { observedAt: "desc" } }),
    prisma.marineObservation.findFirst({
      where: { siteId, source: { not: "open_meteo_marine_info" } },
      orderBy: { observedAt: "desc" },
    }),
    prisma.decisionRecord.findFirst({ where: { siteId, workType }, orderBy: { generatedAt: "desc" } }),
  ]);

  const lines: string[] = [];
  lines.push(`現場「${site.name}」(${site.code}) の参考解説を生成しました。`);
  if (weather) {
    lines.push(
      `直近の気象観測 (${new Date(weather.observedAt).toLocaleString("ja-JP")}): ` +
        `気温 ${weather.temperatureC ?? "—"}℃、風速 ${weather.windSpeedMs ?? "—"}m/s、降水量 ${weather.precipMm ?? "—"}mm。`,
    );
  } else {
    lines.push("直近の気象観測データがありません。欠測は判定不能であり、施工可とみなせません。");
  }
  if (marine) {
    lines.push(
      `直近の海象観測 (${new Date(marine.observedAt).toLocaleString("ja-JP")}): 有義波高 ${marine.sigWaveHM ?? "—"}m、周期 ${marine.wavePeriodS ?? "—"}s。`,
    );
  }
  if (decision) {
    lines.push(`最新の自動判定 (${new Date(decision.generatedAt).toLocaleString("ja-JP")}) は「${decision.status}」です。`);
    lines.push(`判定理由: ${decision.reason.split("\n")[0]}`);
  } else {
    lines.push("この作業種別の自動判定履歴はまだありません。");
  }
  lines.push("⚠️ 本解説は参考情報です。施工可否・安全性・法令適合を断定しません。");

  return NextResponse.json({
    data: {
      siteId,
      workType,
      mode: "rule_based_fallback",
      generatedAt: new Date().toISOString(),
      commentary: lines.join("\n"),
    },
    meta: { requestId: requestId(), retrievedAt: new Date().toISOString() },
    warnings: [decisionNotSupportedWarning],
  });
}
