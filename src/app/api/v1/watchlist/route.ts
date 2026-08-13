import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auditLogCreateData } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { requireRoleOrAdmin, userEmailFromRequest } from "@/lib/rbac";
import { demoUserEmailFromEnv } from "@/lib/demo-identity";

const TARGET_TYPES = new Set(["site", "dataSource", "ingestionJob"]);
const WATCH_ROLES = ["engineer", "data-steward", "admin", "auditor"] as const;

export async function GET(request: NextRequest) {
  const authError = await requireRoleOrAdmin(request, WATCH_ROLES);
  if (authError) return authError;
  const email = userEmailFromRequest(request) ?? demoUserEmailFromEnv();
  if (!email) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "管理認証が必要です（ウォッチリストは個人単位のため識別ヘッダーが必要）" } },
      { status: 401 },
    );
  }
  const rate = checkRateLimit("api:v1:watchlist:read", clientIdentifier(request), 60, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const entries = await prisma.watchlistEntry.findMany({
    where: { userEmail: email },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ data: { identity: email, entries } });
}

export async function POST(request: NextRequest) {
  const authError = await requireRoleOrAdmin(request, WATCH_ROLES);
  if (authError) return authError;
  const email = userEmailFromRequest(request) ?? demoUserEmailFromEnv();
  if (!email) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "管理認証が必要です（ウォッチリストは個人単位のため識別ヘッダーが必要）" } },
      { status: 401 },
    );
  }
  const rate = checkRateLimit("api:v1:watchlist:write", clientIdentifier(request), 20, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await request.json().catch(() => null);
  const targetType = typeof body?.targetType === "string" ? body.targetType : "";
  const targetId = typeof body?.targetId === "string" ? body.targetId.trim() : "";
  if (!TARGET_TYPES.has(targetType) || !targetId || targetId.length > 200) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "targetType(site|dataSource|ingestionJob) と targetId(1〜200文字) を確認してください" } },
      { status: 400 },
    );
  }

  const existing = await prisma.watchlistEntry.findUnique({
    where: { userEmail_targetType_targetId: { userEmail: email, targetType, targetId } },
  });
  if (existing) {
    return NextResponse.json(
      { error: { code: "duplicate", message: "既にウォッチリストへ登録されています" } },
      { status: 409 },
    );
  }

  const entry = await prisma.$transaction(async (tx) => {
    const row = await tx.watchlistEntry.create({
      data: { userEmail: email, targetType, targetId, enabled: true },
    });
    await tx.auditLog.create({
      data: auditLogCreateData({
        actor: "管理者",
        action: "watchlist.add",
        target: `${targetType}:${targetId}`,
        detail: `user=${email}`,
        level: "info",
      }),
    });
    return row;
  });

  return NextResponse.json({ data: { entry } }, { status: 201 });
}
