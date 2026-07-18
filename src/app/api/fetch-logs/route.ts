import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { safeFetchLogDto } from "@/lib/operational-dto";

export async function GET(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:fetch-logs", clientIdentifier(request), 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const sp = request.nextUrl.searchParams;
  const dataSourceId = sp.get("dataSourceId")?.trim();
  const success = sp.get("success");
  const rawTake = sp.get("take");
  const take = rawTake === null || rawTake === "" ? 100 : Number(rawTake);
  if (!Number.isInteger(take) || take < 1 || take > 1000) {
    return NextResponse.json(
      { error: "validation_error", message: "take の値が不正です" },
      { status: 400 },
    );
  }

  const logs = await prisma.fetchLog.findMany({
    where: {
      ...(dataSourceId ? { dataSourceId } : {}),
      ...(success === "true" ? { success: true } : {}),
      ...(success === "false" ? { success: false } : {}),
    },
    include: { dataSource: { select: { id: true, name: true } } },
    orderBy: { executedAt: "desc" },
    take,
  });

  return NextResponse.json({ items: logs.map((log) => safeFetchLogDto(log)) });
}
