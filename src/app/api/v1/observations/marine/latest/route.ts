import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:observations:marine", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);
  const siteId = request.nextUrl.searchParams.get("siteId");
  if (!siteId) {
    return NextResponse.json({ error: { code: "invalid_query", message: "siteId を指定してください" } }, { status: 400 });
  }
  const row = await prisma.marineObservation.findFirst({
    where: { siteId },
    orderBy: { observedAt: "desc" },
  });
  if (!row) {
    return NextResponse.json({ error: { code: "not_found", message: "海象観測データがありません" } }, { status: 404 });
  }
  return NextResponse.json({ data: { observation: row } });
}
