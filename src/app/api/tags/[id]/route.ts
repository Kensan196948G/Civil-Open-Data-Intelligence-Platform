import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:tags:write", clientIdentifier(request), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const { id } = await context.params;
  const existing = await prisma.tag.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await prisma.tag.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
