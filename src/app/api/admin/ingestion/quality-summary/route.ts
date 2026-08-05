import { NextRequest, NextResponse } from "next/server";
import { PrismaClient as PostgreSQLPrismaClient } from ".prisma/client-postgresql";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { getQualityMonitoringSummary } from "@/lib/ingestion/quality-monitor";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";

const pg = prisma as unknown as PostgreSQLPrismaClient;

export async function GET(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:admin:ingestion:quality", clientIdentifier(request), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const sp = request.nextUrl.searchParams;
  const hoursRaw = Number(sp.get("hours") ?? "24");
  const hours = Number.isFinite(hoursRaw) && hoursRaw >= 1 && hoursRaw <= 168 ? hoursRaw : 24;
  const summary = await getQualityMonitoringSummary(pg, { hours });
  return NextResponse.json({ summary });
}
