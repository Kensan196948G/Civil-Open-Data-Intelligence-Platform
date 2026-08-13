import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auditLogCreateData } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { requireRoleOrAdmin, userEmailFromRequest } from "@/lib/rbac";

const WATCH_ROLES = ["engineer", "data-steward", "admin", "auditor"] as const;

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authError = await requireRoleOrAdmin(request, WATCH_ROLES);
  if (authError) return authError;
  const email = userEmailFromRequest(request);
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
