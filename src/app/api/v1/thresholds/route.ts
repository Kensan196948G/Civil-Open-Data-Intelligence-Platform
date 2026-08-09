import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { auditLogCreateData } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { requestId } from "@/lib/v1-response";

const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
const OPERATORS = new Set(["<", "<=", ">", ">=", "==", "!="]);

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:thresholds", clientIdentifier(request), RATE_LIMIT, RATE_WINDOW_MS);
  if (!rate.allowed) return rateLimitResponse(rate);

  const sp = request.nextUrl.searchParams;
  const siteId = sp.get("siteId");
  const workType = sp.get("workType");
  const thresholds = await prisma.weatherThreshold.findMany({
    where: {
      ...(siteId ? { OR: [{ siteId }, { siteId: null }] } : { siteId: null }),
      ...(workType ? { workType } : {}),
    },
    orderBy: [{ workType: "asc" }, { metric: "asc" }, { severity: "asc" }],
  });
  return NextResponse.json({
    data: { thresholds },
    meta: { requestId: requestId(), retrievedAt: new Date().toISOString(), sourceCount: thresholds.length },
  });
}

export async function POST(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:v1:thresholds:write", clientIdentifier(request), 30, RATE_WINDOW_MS);
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await request.json().catch(() => null);
  const workType = typeof body?.workType === "string" ? body.workType : "";
  const metric = typeof body?.metric === "string" ? body.metric : "";
  const op = typeof body?.op === "string" ? body.op : "";
  const value = Number(body?.value);
  const severity = body?.severity;
  if (!workType || !metric || !OPERATORS.has(op) || !Number.isFinite(value) || (severity !== "warn" && severity !== "stop")) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "workType/metric/op/value/severity(warn|stop) を確認してください" } },
      { status: 400 },
    );
  }
  if (body?.siteId !== undefined && body.siteId !== null) {
    const site = await prisma.constructionSite.findUnique({ where: { id: String(body.siteId) } });
    if (!site) {
      return NextResponse.json({ error: { code: "not_found", message: "siteId の現場が存在しません" } }, { status: 404 });
    }
  }

  const threshold = await prisma.$transaction(async (tx) => {
    const row = await tx.weatherThreshold.create({
      data: {
        siteId: body.siteId ?? null,
        workType,
        metric,
        op,
        value,
        severity,
        activeFrom: body.activeFrom ? new Date(body.activeFrom) : null,
        activeTo: body.activeTo ? new Date(body.activeTo) : null,
        note: typeof body.note === "string" ? body.note : null,
      },
    });
    await tx.auditLog.create({
      data: auditLogCreateData({ action: "閾値登録", target: `${workType}:${metric}`, detail: `閾値 ${op}${value} (${severity}) を登録` }),
    });
    return row;
  });
  return NextResponse.json({ data: { threshold } }, { status: 201 });
}
