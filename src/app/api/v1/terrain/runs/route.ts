import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { auditLogCreateData } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { requestId } from "@/lib/v1-response";
import { intParam } from "@/lib/query-params";

const TABS = new Set(["terrain", "section", "confirm", "output"]);

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:terrain:runs", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);
  // クランプは NaN を素通しするため検証にならない (take: NaN が Prisma へ到達する)。
  const limit = intParam(request.nextUrl.searchParams, "limit", 50, 1, 200);
  if (limit === null) {
    return NextResponse.json({ error: { code: "invalid_query", message: "limit は 1〜200 の整数で指定してください" } }, { status: 400 });
  }
  const runs = await prisma.terrainAnalysisRun.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return NextResponse.json({
    data: { runs },
    meta: { requestId: requestId(), retrievedAt: new Date().toISOString(), sourceCount: runs.length },
  });
}

export async function POST(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:v1:terrain:runs:write", clientIdentifier(request), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await request.json().catch(() => null);
  const lat = Number(body?.lat);
  const lon = Number(body?.lon);
  const tab = typeof body?.tab === "string" ? body.tab : "";
  const payload = body?.payload;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180 || !TABS.has(tab) || payload === null || payload === undefined) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "lat/lon/tab(terrain|section|confirm|output)/payload を確認してください" } },
      { status: 400 },
    );
  }

  const run = await prisma.$transaction(async (tx) => {
    const row = await tx.terrainAnalysisRun.create({
      data: { lat, lon, tab, payload: payload as never },
    });
    await tx.auditLog.create({
      data: auditLogCreateData({ action: "地形案件保存", target: row.id, detail: `point=${lat},${lon} tab=${tab}` }),
    });
    return row;
  });
  return NextResponse.json({ data: { run } }, { status: 201 });
}
