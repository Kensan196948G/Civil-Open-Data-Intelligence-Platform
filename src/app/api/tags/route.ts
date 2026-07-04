import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { tagCreateSchema } from "@/lib/validators";

export async function GET() {
  const tags = await prisma.tag.findMany({
    include: { _count: { select: { sources: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ items: tags });
}

export async function POST(request: NextRequest) {
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
