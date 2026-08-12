import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { auditLogCreateData } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";

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

  await prisma.$transaction(async (tx) => {
    await tx.roleAssignment.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: auditLogCreateData({
        actor: "管理者",
        action: "role.revoke",
        target: existing.userEmail,
        detail: `roleAssignment=${id} scope=${existing.scope}`,
        level: "warning",
      }),
    });
  });

  return NextResponse.json({ data: { revoked: id } });
}
