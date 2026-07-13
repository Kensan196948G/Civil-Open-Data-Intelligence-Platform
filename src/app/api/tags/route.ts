import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { tagCreateSchema } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:tags", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const tags = await prisma.tag.findMany({
    include: { _count: { select: { sources: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ items: tags });
}

export async function POST(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;
  const rate = checkRateLimit("api:tags:write", clientIdentifier(request), 30, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const body = await request.json().catch(() => null);
  const parsed = tagCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const existing = await prisma.tag.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    return NextResponse.json(
      { error: "duplicate", message: "同名のタグが既に存在します" },
      { status: 409 },
    );
  }
  const tag = await prisma.tag.create({ data: parsed.data });
  return NextResponse.json(tag, { status: 201 });
}
