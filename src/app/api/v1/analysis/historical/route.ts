import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { requestId } from "@/lib/v1-response";

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * 最大値。Math.max(...values) のスプレッドは要素数が多いと引数上限に触れて
 * RangeError になるため使わない（1年分の10分間隔観測は約52,560件で、
 * 集計対象を広げると容易に到達しうる）。
 */
function maxOf(values: number[]): number | null {
  if (!values.length) return null;
  let max = values[0];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] > max) max = values[i];
  }
  return round(max);
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:analysis:historical", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);
  const sp = request.nextUrl.searchParams;
  const siteId = sp.get("siteId");
  if (!siteId) {
    return NextResponse.json({ error: { code: "invalid_query", message: "siteId を指定してください" } }, { status: 400 });
  }
  const year = Number(sp.get("year") ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: { code: "invalid_query", message: "year が不正です" } }, { status: 400 });
  }
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  // 集計に使う列だけを取り出す。10分間隔の観測なら1年で約52,560行あり、
  // 全列をロードすると Workers の 128MB 制限に対して余裕が無くなる。
  const [weather, marine] = await Promise.all([
    prisma.weatherObservation.findMany({
      where: { siteId, observedAt: { gte: from, lt: to } },
      select: { observedAt: true, windSpeedMs: true, temperatureC: true, precipMm: true },
    }),
    prisma.marineObservation.findMany({
      where: { siteId, observedAt: { gte: from, lt: to }, source: { not: "open_meteo_marine_info" } },
      select: { observedAt: true, sigWaveHM: true },
    }),
  ]);
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const winds = weather.filter((w) => w.observedAt.getUTCMonth() === m - 1 && w.windSpeedMs !== null).map((w) => w.windSpeedMs as number);
    const temps = weather.filter((w) => w.observedAt.getUTCMonth() === m - 1 && w.temperatureC !== null).map((w) => w.temperatureC as number);
    const rains = weather.filter((w) => w.observedAt.getUTCMonth() === m - 1 && w.precipMm !== null).map((w) => w.precipMm as number);
    const waves = marine.filter((w) => w.observedAt.getUTCMonth() === m - 1 && w.sigWaveHM !== null).map((w) => w.sigWaveHM as number);
    months.push({
      month: m,
      avgWindMs: round(mean(winds)),
      maxWindMs: maxOf(winds),
      avgTempC: round(mean(temps)),
      totalRainMm: round(rains.length ? rains.reduce((a, b) => a + b, 0) : null),
      rainDays: rains.filter((v) => v > 0).length || null,
      avgWaveHM: round(mean(waves)),
      maxWaveHM: maxOf(waves),
    });
  }
  return NextResponse.json({
    data: { siteId, year, dataSource: "backend", months },
    meta: { requestId: requestId(), retrievedAt: new Date().toISOString() },
  });
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1000) / 1000;
}
