import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { requestId } from "@/lib/v1-response";
import { returnPeriods } from "@/lib/analysis/return-period";
import { dateParam } from "@/lib/query-params";

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:analysis:wave50", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);
  const sp = request.nextUrl.searchParams;
  const siteId = sp.get("siteId");
  // OpenAPI は enum: [gumbel, weibull] を公開契約として宣言している。
  // 未知の値を黙って gumbel へ倒すと、契約外の入力に 200 を返して
  // 「利用者が weibull のつもりで gumbel の結果を受け取る」事故になる。
  const rawMethod = sp.get("method");
  if (rawMethod !== null && rawMethod !== "gumbel" && rawMethod !== "weibull") {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "method は gumbel または weibull です" } },
      { status: 400 },
    );
  }
  const method = rawMethod === "weibull" ? "weibull" : "gumbel";
  if (!siteId) {
    return NextResponse.json({ error: { code: "invalid_query", message: "siteId を指定してください" } }, { status: 400 });
  }
  // 期間は任意。未指定なら全履歴を対象とする（従来どおり）。
  const from = dateParam(sp, "from", EPOCH_START);
  if (!from) {
    return NextResponse.json({ error: { code: "invalid_query", message: "from は解釈可能な日時で指定してください" } }, { status: 400 });
  }
  const to = dateParam(sp, "to", FAR_FUTURE);
  if (!to) {
    return NextResponse.json({ error: { code: "invalid_query", message: "to は解釈可能な日時で指定してください" } }, { status: 400 });
  }
  if (from.getTime() > to.getTime()) {
    return NextResponse.json({ error: { code: "invalid_query", message: "from は to 以前を指定してください" } }, { status: 400 });
  }

  // 年最大値しか使わないので観測日時と波高だけを取り出す。
  // 上限を1件超えて取得し、超過を「黙って切り捨てる」のではなく 422 で知らせる。
  // 静かな truncation は推算結果を無言で誤らせるため採用しない。
  const rows = await prisma.marineObservation.findMany({
    where: {
      siteId,
      sigWaveHM: { not: null },
      observedAt: { gte: from, lte: to },
      source: { not: "open_meteo_marine_info" },
    },
    orderBy: { observedAt: "asc" },
    select: { observedAt: true, sigWaveHM: true },
    take: MAX_OBSERVATIONS + 1,
  });
  if (rows.length > MAX_OBSERVATIONS) {
    return NextResponse.json(
      {
        error: {
          code: "range_too_large",
          message: `対象観測が${MAX_OBSERVATIONS}件を超えます。from / to で期間を絞って再実行してください`,
        },
      },
      { status: 422 },
    );
  }
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

/**
 * 1リクエストで扱う観測件数の上限。
 * 10分間隔なら1年で約52,560件なので、およそ10年分に相当する。
 * Cloudflare Workers の 128MB 制限に対して余裕を残すための有界化。
 */
const MAX_OBSERVATIONS = 600_000;

/** from / to の既定値。未指定時は従来どおり全履歴を対象とする。 */
const EPOCH_START = new Date(0);
const FAR_FUTURE = new Date("9999-12-31T23:59:59.999Z");

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
