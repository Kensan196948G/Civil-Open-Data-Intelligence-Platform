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
  if (typeof value === "boolean") return { ok: true as const, value };
  if (value === "true" || value === "1") return { ok: true as const, value: true };
  if (value === "false" || value === "0") return { ok: true as const, value: false };
  return { ok: false as const };
}

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:admin:ingestion:update", clientIdentifier(request), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);
  const { id } = await params;
  const body = await request.json().catch(() => null);

  const updates: Record<string, unknown> = {};
  if (body?.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "validation_error", message: "name は空にできません" }, { status: 400 });
    }
    updates.name = body.name.trim();
  }
  if (body?.enabled !== undefined) {
    const enabled = boolValue(body.enabled);
    if (!enabled.ok) {
      return NextResponse.json({ error: "validation_error", message: "enabled は真偽値で指定してください" }, { status: 400 });
    }
    updates.enabled = enabled.value;
  }
  if (body?.intervalMinutes !== undefined) {
    const interval = intInRange(body.intervalMinutes, 5, 10_080, 1_440);
    if (!interval.ok) {
      return NextResponse.json({ error: "validation_error", message: "intervalMinutes は5〜10080で指定してください" }, { status: 400 });
    }
    updates.intervalMinutes = interval.value;
  }
  if (body?.maxRecords !== undefined) {
    const maxRecords = intInRange(body.maxRecords, 1, 5_000, 500);
    if (!maxRecords.ok) {
      return NextResponse.json({ error: "validation_error", message: "maxRecords は1〜5000で指定してください" }, { status: 400 });
    }
    updates.maxRecords = maxRecords.value;
  }

  const job = await prisma.ingestionJob.update({ where: { id }, data: updates });
  await recordAudit({ action: "定期収集ジョブ更新", target: job.name, detail: JSON.stringify(updates) });
  return NextResponse.json({ job });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:admin:ingestion:delete", clientIdentifier(request), 10, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);
  const { id } = await params;
  const job = await prisma.ingestionJob.findUnique({ where: { id } });
  if (!job) {
    return NextResponse.json({ error: "not_found", message: "定期収集ジョブが見つかりません" }, { status: 404 });
  }
  await prisma.ingestionJob.delete({ where: { id } });
  await recordAudit({ action: "定期収集ジョブ削除", target: job.name, detail: `id=${id}`, level: "warning" });
  return NextResponse.json({ ok: true });
}
