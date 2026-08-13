import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auditLogCreateData } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { requireRoleOrAdmin, userEmailFromRequest } from "@/lib/rbac";
import { demoUserEmailFromEnv } from "@/lib/demo-identity";

// rbac-design.md: auditor はウォッチリスト・通知設定不可（読み取り専用）。
const WATCH_ROLES = ["engineer", "data-steward", "admin"] as const;

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
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

  const { id } = await context.params;
  const deleted = await prisma.$transaction(async (tx) => {
    const result = await tx.watchlistEntry.deleteMany({
      where: { id, userEmail: email },
    });
    await tx.auditLog.create({
      data: auditLogCreateData({
        actor: "管理者",
        action: "watchlist.remove",
        target: id,
        detail: `user=${email}`,
        level: "info",
      }),
    });
    return result;
  });
  if (deleted.count === 0) {
    return NextResponse.json(
      { error: { code: "not_found", message: "ウォッチリスト登録が見つかりません" } },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: { removed: id } });
}

/**
 * ウォッチリスト登録の有効/無効を切り替える。
 * 通知ダイジェスト（scripts/ingestion/notification-check.js）は enabled=true の
 * エントリのみ対象にするため、配信の一時停止はこの PATCH で行う。
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
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
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "enabled(boolean) を指定してください" } },
      { status: 400 },
    );
  }

  const { id } = await context.params;
  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.watchlistEntry.findFirst({
      where: { id, userEmail: email },
    });
    if (!existing) return null;
    const row = await tx.watchlistEntry.update({
      where: { id },
      data: { enabled: body.enabled },
    });
    await tx.auditLog.create({
      data: auditLogCreateData({
        actor: "管理者",
        action: "watchlist.toggle",
        target: id,
        detail: `user=${email} enabled=${body.enabled}`,
        level: "info",
      }),
    });
    return row;
  });

  if (!updated) {
    return NextResponse.json(
      { error: { code: "not_found", message: "ウォッチリスト登録が見つかりません" } },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: { entry: updated } });
}
