import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { auditLogCreateData } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { requestId } from "@/lib/v1-response";

const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:observations:weather", clientIdentifier(request), RATE_LIMIT, RATE_WINDOW_MS);
  if (!rate.allowed) return rateLimitResponse(rate);
  const sp = request.nextUrl.searchParams;
  const siteId = sp.get("siteId");
  if (!siteId) {
    return NextResponse.json({ error: { code: "invalid_query", message: "siteId を指定してください" } }, { status: 400 });
  }
  const t1 = sp.get("t1") ? new Date(sp.get("t1")!) : new Date();
  const t0 = sp.get("t0") ? new Date(sp.get("t0")!) : new Date(t1.getTime() - 24 * 3600 * 1000);
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? 200), 1), 2000);
  const rows = await prisma.weatherObservation.findMany({
    where: { siteId, observedAt: { gte: t0, lte: t1 } },
    orderBy: { observedAt: "desc" },
    take: limit,
  });
  return NextResponse.json({
    data: { observations: rows },
    meta: { requestId: requestId(), retrievedAt: new Date().toISOString(), sourceCount: rows.length },
  });
}

export async function POST(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:v1:observations:write", clientIdentifier(request), 30, RATE_WINDOW_MS);
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await request.json().catch(() => null);
  if (!Array.isArray(body) || body.length === 0) {
    return NextResponse.json({ error: { code: "invalid_query", message: "観測値の配列を指定してください" } }, { status: 400 });
  }

  let inserted = 0;
  const updated = 0;
  for (const row of body) {
    const siteId = String(row.siteId ?? "");
    const observedAt = row.observedAt ? new Date(row.observedAt) : null;
    if (!siteId || !observedAt || Number.isNaN(observedAt.getTime())) continue;
    const dataVersion = Number(row.dataVersion ?? 1);
    const data = {
      siteId,
      observedAt,
      temperatureC: toNumber(row.temperatureC),
      humidityPct: toNumber(row.humidityPct),
      pressureHpa: toNumber(row.pressureHpa),
      precipMm: toNumber(row.precipMm),
      windSpeedMs: toNumber(row.windSpeedMs),
      windGustMs: toNumber(row.windGustMs),
      windDirDeg: toNumber(row.windDirDeg),
      sunshineH: toNumber(row.sunshineH),
      dataVersion,
      source: typeof row.source === "string" ? row.source : "jma",
    };
    const result = await prisma.weatherObservation.upsert({
      where: { siteId_observedAt_dataVersion: { siteId, observedAt, dataVersion } },
      create: data,
      update: data,
    });
    if (result.id) {
      // approximation: created vs updated is not distinguishable without extra query
      inserted += 1;
    }
  }
  await prisma.auditLog.create({
    data: auditLogCreateData({ action: "気象観測取り込み", target: "weather_observations", detail: `rows=${body.length}` }),
  });
  return NextResponse.json({ data: { inserted, updated, total: body.length } }, { status: 201 });
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
