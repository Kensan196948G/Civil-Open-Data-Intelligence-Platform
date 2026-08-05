import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin-auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";

function intInRange(value: unknown, min: number, max: number, fallback: number) {
  if (value === undefined) return { ok: true as const, value: fallback };
  const num = Number(value);
  if (!Number.isInteger(num) || num < min || num > max) {
    return { ok: false as const };
  }
  return { ok: true as const, value: num };
}

function boolValue(value: unknown) {
  if (value === undefined) return { ok: true as const, value: false };
  if (typeof value === "boolean") return { ok: true as const, value };
  if (value === "true" || value === "1") return { ok: true as const, value: true };
  if (value === "false" || value === "0") return { ok: true as const, value: false };
  return { ok: false as const };
}

export async function GET(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:admin:ingestion:list", clientIdentifier(request), 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const jobs = await prisma.ingestionJob.findMany({
    include: {
      dataSource: { select: { id: true, name: true, category: true, status: true, qualityScore: true } },
      runs: { orderBy: { startedAt: "desc" }, take: 5 },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ jobs });
}

export async function POST(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:admin:ingestion:create", clientIdentifier(request), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await request.json().catch(() => null);
  const dataSourceId = typeof body?.dataSourceId === "string" ? body.dataSourceId.trim() : "";
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "";
  const interval = intInRange(body?.intervalMinutes, 5, 10_080, 1_440);
  const maxRecords = intInRange(body?.maxRecords, 1, 5_000, 500);
  const enabled = boolValue(body?.enabled);

  if (!dataSourceId || !name || !interval.ok || !maxRecords.ok || !enabled.ok) {
    return NextResponse.json(
      {
        error: "validation_error",
        message:
          "dataSourceId・name・intervalMinutes(5〜10080)・maxRecords(1〜5000)・enabled を正しく指定してください",
      },
      { status: 400 },
    );
  }

  const dataSource = await prisma.dataSource.findUnique({ where: { id: dataSourceId } });
  if (!dataSource) {
    return NextResponse.json({ error: "not_found", message: "データソースが見つかりません" }, { status: 404 });
  }

  const job = await prisma.ingestionJob.create({
    data: {
      dataSourceId,
      name,
      enabled: enabled.value,
      intervalMinutes: interval.value,
      maxRecords: maxRecords.value,
    },
  });
  await recordAudit({
    action: "定期収集ジョブ作成",
    target: dataSource.name,
    detail: `name=${name}, intervalMinutes=${interval.value}, maxRecords=${maxRecords.value}`,
    level: "success",
  });
  return NextResponse.json({ job }, { status: 201 });
}
