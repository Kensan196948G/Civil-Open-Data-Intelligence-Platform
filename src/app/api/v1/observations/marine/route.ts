import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { auditLogCreateData } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { requestId } from "@/lib/v1-response";
import { dateParam, intParam } from "@/lib/query-params";

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:observations:marine", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);
  const sp = request.nextUrl.searchParams;
  const siteId = sp.get("siteId");
  if (!siteId) {
    return NextResponse.json({ error: { code: "invalid_query", message: "siteId を指定してください" } }, { status: 400 });
  }
  // クランプは NaN を素通しするため検証にならない。不正値は 400 で弾き、
  // take: NaN / lte: Invalid Date が Prisma へ到達しないようにする。
  const t1 = dateParam(sp, "t1", new Date());
  if (!t1) {
    return NextResponse.json({ error: { code: "invalid_query", message: "t1 は解釈可能な日時で指定してください" } }, { status: 400 });
  }
  const t0 = dateParam(sp, "t0", new Date(t1.getTime() - 24 * 3600 * 1000));
  if (!t0) {
    return NextResponse.json({ error: { code: "invalid_query", message: "t0 は解釈可能な日時で指定してください" } }, { status: 400 });
  }
  if (t0.getTime() > t1.getTime()) {
    return NextResponse.json({ error: { code: "invalid_query", message: "t0 は t1 以前を指定してください" } }, { status: 400 });
  }
  const limit = intParam(sp, "limit", 200, 1, 2000);
  if (limit === null) {
    return NextResponse.json({ error: { code: "invalid_query", message: "limit は 1〜2000 の整数で指定してください" } }, { status: 400 });
  }
  const rows = await prisma.marineObservation.findMany({
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
  const rate = checkRateLimit("api:v1:observations:write", clientIdentifier(request), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await request.json().catch(() => null);
  if (!Array.isArray(body) || body.length === 0) {
    return NextResponse.json({ error: { code: "invalid_query", message: "観測値の配列を指定してください" } }, { status: 400 });
  }
  let inserted = 0;
  for (const row of body) {
    const siteId = String(row.siteId ?? "");
    const observedAt = row.observedAt ? new Date(row.observedAt) : null;
    if (!siteId || !observedAt || Number.isNaN(observedAt.getTime())) continue;
    const dataVersion = Number(row.dataVersion ?? 1);
    const data = {
      siteId,
      observedAt,
      sigWaveHM: toNumber(row.sigWaveHM),
      wavePeriodS: toNumber(row.wavePeriodS),
      waveDirDeg: toNumber(row.waveDirDeg),
      tideLevelM: toNumber(row.tideLevelM),
      currentSpeedMs: toNumber(row.currentSpeedMs),
      currentDirDeg: toNumber(row.currentDirDeg),
      dataVersion,
      source: typeof row.source === "string" ? row.source : "jma_wave",
    };
    await prisma.marineObservation.upsert({
      where: { siteId_observedAt_dataVersion: { siteId, observedAt, dataVersion } },
      create: data,
      update: data,
    });
    inserted += 1;
  }
  await prisma.auditLog.create({
    data: auditLogCreateData({ action: "海象観測取り込み", target: "marine_observations", detail: `rows=${body.length}` }),
  });
  return NextResponse.json({ data: { inserted, updated: 0, total: body.length } }, { status: 201 });
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
