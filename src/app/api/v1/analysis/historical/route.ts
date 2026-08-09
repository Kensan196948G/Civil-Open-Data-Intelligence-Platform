import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { requestId } from "@/lib/v1-response";

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
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
  const [weather, marine] = await Promise.all([
    prisma.weatherObservation.findMany({ where: { siteId, observedAt: { gte: from, lt: to } } }),
    prisma.marineObservation.findMany({
      where: { siteId, observedAt: { gte: from, lt: to }, source: { not: "open_meteo_marine_info" } },
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
      maxWindMs: winds.length ? round(Math.max(...winds)) : null,
      avgTempC: round(mean(temps)),
      totalRainMm: round(rains.length ? rains.reduce((a, b) => a + b, 0) : null),
      rainDays: rains.filter((v) => v > 0).length || null,
      avgWaveHM: round(mean(waves)),
      maxWaveHM: waves.length ? round(Math.max(...waves)) : null,
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
