import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminRequest } from "@/lib/admin-auth";
import { recordAudit } from "@/lib/audit";
import { dataSourceCreateSchema } from "@/lib/validators";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { safeSourceDto } from "@/lib/source-dto";

function intParam(
  sp: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number | null {
  const raw = sp.get(name);
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:sources", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const category = sp.get("category")?.trim();
  const providerId = sp.get("providerId")?.trim();
  const dataFormat = sp.get("dataFormat")?.trim();
  const requiresApiKey = sp.get("requiresApiKey");
  const status = sp.get("status")?.trim();
  const tagId = sp.get("tag")?.trim();
  const trustLevel = intParam(sp, "trustLevel", 0, 1, 5);
  const take = intParam(sp, "take", 100, 1, 200);
  const skip = intParam(sp, "skip", 0, 0, 5000);
  if (trustLevel === null || take === null || skip === null) {
    return NextResponse.json(
      { error: "validation_error", message: "trustLevel/take/skip の値が不正です。takeは最大200、skipは最大5000です" },
      { status: 400 },
    );
  }
  if (q && q.length < 2) {
    return NextResponse.json(
      { error: "validation_error", message: "キーワード検索は2文字以上で指定してください" },
      { status: 400 },
    );
  }

  const where: Prisma.DataSourceWhereInput = {};
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { nameEn: { contains: q } },
      { description: { contains: q } },
    ];
  }
  if (category) where.category = category;
  if (providerId) where.providerId = providerId;
  if (dataFormat) where.dataFormat = dataFormat;
  if (requiresApiKey === "true") where.requiresApiKey = true;
  if (requiresApiKey === "false") where.requiresApiKey = false;
  if (status) where.status = status;
  if (tagId) where.tags = { some: { tagId } };
  if (trustLevel > 0) where.trustLevel = { gte: trustLevel };

  const [items, total] = await Promise.all([
    prisma.dataSource.findMany({
      where,
      include: { provider: true, tags: { include: { tag: true } } },
      orderBy: { updatedAt: "desc" },
      take,
      skip,
    }),
    prisma.dataSource.count({ where }),
  ]);

  return NextResponse.json({ items: items.map((item) => safeSourceDto(item)), total });
}

export async function POST(request: NextRequest) {
  const authError = requireAdminRequest(request);
  if (authError) return authError;

  const body = await request.json().catch(() => null);
  const parsed = dataSourceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { providerId, providerName, providerOrganizationType, tagIds, ...data } = parsed.data;

  let resolvedProviderId = providerId;
  if (!resolvedProviderId) {
    if (!providerName) {
      return NextResponse.json(
        { error: "validation_error", message: "providerId または providerName が必要です" },
        { status: 400 },
      );
    }
    const provider = await prisma.provider.upsert({
      where: { name: providerName },
      update: {},
      create: {
        name: providerName,
        organizationType: providerOrganizationType ?? "private",
      },
    });
    resolvedProviderId = provider.id;
  } else {
    const provider = await prisma.provider.findUnique({ where: { id: resolvedProviderId } });
    if (!provider) {
      return NextResponse.json(
        { error: "validation_error", message: "指定された提供元が存在しません" },
        { status: 400 },
      );
    }
  }

  if (tagIds?.length) {
    const count = await prisma.tag.count({ where: { id: { in: tagIds } } });
    if (count !== new Set(tagIds).size) {
      return NextResponse.json(
        { error: "validation_error", message: "指定されたタグに存在しないIDが含まれています" },
        { status: 400 },
      );
    }
  }

  // 同一URLの重複登録防止
  const duplicate = await prisma.dataSource.findFirst({
    where: { officialUrl: data.officialUrl },
  });
  if (duplicate) {
    return NextResponse.json(
      { error: "duplicate", message: `同じ公式URLのデータソースが既に登録されています: ${duplicate.name}` },
      { status: 409 },
    );
  }

  let created;
  try {
    created = await prisma.dataSource.create({
      data: {
        ...data,
        providerId: resolvedProviderId,
        tags: tagIds?.length
          ? { create: [...new Set(tagIds)].map((tagId) => ({ tagId })) }
          : undefined,
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

  await recordAudit({
    action: "データソース登録",
    target: created.name,
    detail: "新規登録",
    level: "info",
  });

  return NextResponse.json(safeSourceDto(created, { includeSensitive: true }), { status: 201 });
}
