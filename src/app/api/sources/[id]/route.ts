import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dataSourceUpdateSchema } from "@/lib/validators";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const source = await prisma.dataSource.findUnique({
    where: { id },
    include: {
      provider: true,
      tags: { include: { tag: true } },
      fetchLogs: { orderBy: { executedAt: "desc" }, take: 50 },
      sampleResponses: { orderBy: { createdAt: "desc" }, take: 5 },
      qualityChecks: { orderBy: { checkedAt: "desc" }, take: 5 },
      relatedUseCases: true,
    },
  });
  if (!source) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(source);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const existing = await prisma.dataSource.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = dataSourceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { providerId, providerName, providerOrganizationType, tagIds, ...data } = parsed.data;
  void providerName;
  void providerOrganizationType;

  const updated = await prisma.dataSource.update({
    where: { id },
    data: {
      ...data,
      ...(providerId ? { providerId } : {}),
      ...(tagIds
        ? {
            tags: {
              deleteMany: {},
              create: tagIds.map((tagId) => ({ tagId })),
            },
          }
        : {}),
    },
    include: { provider: true, tags: { include: { tag: true } } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const existing = await prisma.dataSource.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await prisma.dataSource.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
