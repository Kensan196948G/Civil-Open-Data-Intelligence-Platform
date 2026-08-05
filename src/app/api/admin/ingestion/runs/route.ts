import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";

const VALID_STATUSES = new Set(["pending", "running", "success", "failed", "skipped", "stopped"]);

export async function GET(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:admin:ingestion:runs", clientIdentifier(request), 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const sp = request.nextUrl.searchParams;
  const status = sp.get("status")?.trim() ?? "";
  if (status && !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "invalid_query", message: "status が不正です" }, { status: 400 });
  }
  const limitRaw = Number(sp.get("limit") ?? "50");
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 200 ? limitRaw : 50;
  const runs = await prisma.ingestionRun.findMany({
    where: status ? { status } : undefined,
    include: { ingestionJob: { include: { dataSource: { select: { id: true, name: true } } } } },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
  return NextResponse.json({ runs });
}
