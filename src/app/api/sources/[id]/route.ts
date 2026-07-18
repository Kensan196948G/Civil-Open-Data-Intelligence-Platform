import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isAdminHeaders, requireAdminRequest } from "@/lib/admin-auth";
import { apiKeyHttpsInvariantViolation, dataSourceUpdateSchema } from "@/lib/validators";
import { safeFetchLogDto, safeSampleResponseDto } from "@/lib/operational-dto";
import { safeSourceDto } from "@/lib/source-dto";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const includeSensitive = isAdminHeaders(request.headers);
  const source = await prisma.dataSource.findUnique({
    where: { id },
    include: {
      provider: true,
      tags: { include: { tag: true } },
      qualityChecks: { orderBy: { checkedAt: "desc" }, take: 5 },
      relatedUseCases: true,
      ...(includeSensitive
        ? {
            fetchLogs: { orderBy: { executedAt: "desc" }, take: 50 },
            sampleResponses: { orderBy: { createdAt: "desc" }, take: 5 },
          }
        : {}),
    },
  });
  if (!source) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const safeSource = safeSourceDto(source, { includeSensitive });
  return NextResponse.json({
    ...safeSource,
    fetchLogs: includeSensitive && "fetchLogs" in source ? source.fetchLogs.map((log) => safeFetchLogDto(log)) : [],
    sampleResponses:
      includeSensitive && "sampleResponses" in source
        ? source.sampleResponses.map((sample) => safeSampleResponseDto(sample))
        : [],
    sensitiveOperationalData: includeSensitive ? "included" : "requires_admin",
  });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;

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

  // requiresApiKey→HTTPS 不変条件は複数フィールドにまたがるため、部分更新の
  // payload 単体では検査できない。既存レコードとマージした「保存後の実効状態」で
  // 検査する (Codex review / adversarial review 指摘対応)。
  const invariantViolation = apiKeyHttpsInvariantViolation({
    requiresApiKey: data.requiresApiKey ?? existing.requiresApiKey,
    endpointUrl: data.endpointUrl !== undefined ? data.endpointUrl : existing.endpointUrl,
    officialUrl: data.officialUrl !== undefined ? data.officialUrl : existing.officialUrl,
  });
  if (invariantViolation) {
    return NextResponse.json(
      {
        error: "validation_error",
        details: { formErrors: [], fieldErrors: { [invariantViolation.path]: [invariantViolation.message] } },
      },
      { status: 400 },
    );
  }

  if (providerId) {
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) {
      return NextResponse.json(
        { error: "validation_error", message: "指定された提供元が存在しません" },
        { status: 400 },
      );
    }
  }

  const distinctTagIds = tagIds ? [...new Set(tagIds)] : undefined;
  if (distinctTagIds?.length) {
    const count = await prisma.tag.count({ where: { id: { in: distinctTagIds } } });
    if (count !== distinctTagIds.length) {
      return NextResponse.json(
        { error: "validation_error", message: "指定されたタグに存在しないIDが含まれています" },
        { status: 400 },
      );
    }
  }

  let updated;
  try {
    updated = await prisma.dataSource.update({
      where: { id },
      data: {
        ...data,
        ...(providerId ? { providerId } : {}),
        ...(distinctTagIds !== undefined
          ? {
              tags: {
                deleteMany: {},
                create: distinctTagIds.map((tagId) => ({ tagId })),
              },
            }
          : {}),
      },
      include: { provider: true, tags: { include: { tag: true } } },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "duplicate", message: "同じ公式URLのデータソースが既に登録されています" },
        { status: 409 },
      );
    }
    throw error;
  }

  return NextResponse.json(safeSourceDto(updated, { includeSensitive: true }));
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;

  const { id } = await context.params;
  const existing = await prisma.dataSource.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await prisma.dataSource.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
