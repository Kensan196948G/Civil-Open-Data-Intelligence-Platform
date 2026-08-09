import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { auditLogCreateData } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";

const RATE_WINDOW_MS = 60_000;
const OPERATORS = new Set(["<", "<=", ">", ">=", "==", "!="]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:v1:thresholds:write", clientIdentifier(request), 30, RATE_WINDOW_MS);
  if (!rate.allowed) return rateLimitResponse(rate);
  const { id } = await params;

  const existing = await prisma.weatherThreshold.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "閾値が見つかりません" } }, { status: 404 });
  }
  const body = await request.json().catch(() => null);
  const changes: Record<string, unknown> = {};
  if (body?.workType !== undefined) changes.workType = String(body.workType);
  if (body?.metric !== undefined) changes.metric = String(body.metric);
  if (body?.op !== undefined) {
    if (!OPERATORS.has(String(body.op))) {
      return NextResponse.json({ error: { code: "invalid_query", message: "op が不正です" } }, { status: 400 });
    }
    changes.op = String(body.op);
  }
  if (body?.value !== undefined) {
    const value = Number(body.value);
    if (!Number.isFinite(value)) {
      return NextResponse.json({ error: { code: "invalid_query", message: "value が不正です" } }, { status: 400 });
    }
    changes.value = value;
  }
  if (body?.severity !== undefined) {
    if (body.severity !== "warn" && body.severity !== "stop") {
      return NextResponse.json({ error: { code: "invalid_query", message: "severity は warn|stop のみです" } }, { status: 400 });
    }
    changes.severity = body.severity;
  }
  if (body?.activeFrom !== undefined) changes.activeFrom = body.activeFrom ? new Date(body.activeFrom) : null;
  if (body?.activeTo !== undefined) changes.activeTo = body.activeTo ? new Date(body.activeTo) : null;
  if (body?.note !== undefined) changes.note = body.note;

  const threshold = await prisma.$transaction(async (tx) => {
    const row = await tx.weatherThreshold.update({ where: { id }, data: changes });
    await tx.auditLog.create({
      data: auditLogCreateData({ action: "閾値更新", target: id, detail: JSON.stringify({ changes }) }),
    });
    return row;
  });
  return NextResponse.json({ data: { threshold } });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:v1:thresholds:write", clientIdentifier(request), 30, RATE_WINDOW_MS);
  if (!rate.allowed) return rateLimitResponse(rate);
  const { id } = await params;

  const existing = await prisma.weatherThreshold.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: { code: "not_found", message: "閾値が見つかりません" } }, { status: 404 });
  }
  await prisma.$transaction(async (tx) => {
    await tx.weatherThreshold.delete({ where: { id } });
    await tx.auditLog.create({
      data: auditLogCreateData({ action: "閾値削除", target: id, detail: "閾値を削除" }),
    });
  });
  return new NextResponse(null, { status: 204 });
}
