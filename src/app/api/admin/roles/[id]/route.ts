import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { auditLogCreateData } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { invalidateRoleCache } from "@/lib/rbac";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:admin:roles:write", clientIdentifier(request), 10, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const { id } = await context.params;
  const existing = await prisma.roleAssignment.findUnique({ where: { id } });
  if (!existing || existing.revokedAt) {
    return NextResponse.json(
      { error: { code: "not_found", message: "割当が見つからないか、既に失効済みです" } },
      { status: 404 },
    );
  }

  const now = new Date();
  // updateMany で「revokedAt IS NULL の行だけ」を失効させ、並行失効と競合しない。
  const revoked = await prisma.roleAssignment.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: now },
  });
  if (revoked.count === 0) {
    return NextResponse.json(
      { error: { code: "not_found", message: "割当が見つからないか、既に失効済みです" } },
      { status: 404 },
    );
  }
  await prisma.auditLog.create({
    data: auditLogCreateData({
      actor: "管理者",
      action: "role.revoke",
      target: existing.userEmail,
      detail: `roleAssignment=${id} scope=${existing.scope}`,
      level: "warning",
    }),
  });
  invalidateRoleCache(existing.userEmail, existing.scope);

  return NextResponse.json({ data: { revoked: id } });
}
