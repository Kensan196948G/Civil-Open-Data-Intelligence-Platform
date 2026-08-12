import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { auditLogCreateData } from "@/lib/audit";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { normalizeEmail, ROLE_NAMES } from "@/lib/rbac";

const SCOPE_PATTERN = /^(global|[a-z][a-z0-9-]*(?::[a-z0-9-]+)?)$/;

export async function GET(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:admin:roles:read", clientIdentifier(request), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const assignments = await prisma.roleAssignment.findMany({
    where: { revokedAt: null },
    include: { role: { select: { name: true, priority: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    data: {
      roles: ROLE_NAMES,
      assignments: assignments.map((a) => ({
        id: a.id,
        userEmail: a.userEmail,
        role: a.role.name,
        priority: a.role.priority,
        scope: a.scope,
        grantedBy: a.grantedBy,
        expiresAt: a.expiresAt,
        createdAt: a.createdAt,
      })),
    },
  });
}

export async function POST(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:admin:roles:write", clientIdentifier(request), 10, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await request.json().catch(() => null);
  const email = typeof body?.userEmail === "string" ? normalizeEmail(body.userEmail) : "";
  const roleName = typeof body?.role === "string" ? body.role : "";
  const scope = typeof body?.scope === "string" && body.scope ? body.scope : "global";
  const grantedBy =
    typeof body?.grantedBy === "string" && body.grantedBy.trim()
      ? body.grantedBy.trim().slice(0, 200)
      : "admin";
  let expiresAt: Date | null = null;
  if (body?.expiresAt != null) {
    const parsed = new Date(String(body.expiresAt));
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: { code: "invalid_query", message: "expiresAt は ISO 8601 日付にしてください" } },
        { status: 422 },
      );
    }
    expiresAt = parsed;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "userEmail を確認してください" } },
      { status: 400 },
    );
  }
  if (!ROLE_NAMES.includes(roleName)) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: `role は ${ROLE_NAMES.join(" / ")} のいずれか` } },
      { status: 400 },
    );
  }
  if (!SCOPE_PATTERN.test(scope)) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "scope は global または site:<id> 形式" } },
      { status: 400 },
    );
  }

  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    return NextResponse.json(
      { error: { code: "not_found", message: "ロールが未登録です。シードを実行してください" } },
      { status: 409 },
    );
  }
  const active = await prisma.roleAssignment.findFirst({
    where: { userEmail: email, roleId: role.id, scope, revokedAt: null },
  });
  if (active) {
    return NextResponse.json(
      { error: { code: "duplicate", message: `${email} は既に ${roleName} (${scope}) です` } },
      { status: 409 },
    );
  }

  const assignment = await prisma.$transaction(async (tx) => {
    const row = await tx.roleAssignment.create({
      data: { userEmail: email, roleId: role.id, scope, grantedBy, expiresAt },
    });
    await tx.auditLog.create({
      data: auditLogCreateData({
        actor: "管理者",
        action: "role.assign",
        target: email,
        detail: `role=${roleName} scope=${scope}${expiresAt ? ` expiresAt=${expiresAt.toISOString()}` : ""} grantedBy=${grantedBy}`,
        level: "warning",
      }),
    });
    return row;
  });

  return NextResponse.json(
    { data: { assignment: { id: assignment.id, userEmail: email, role: roleName, scope } } },
    { status: 201 },
  );
}
