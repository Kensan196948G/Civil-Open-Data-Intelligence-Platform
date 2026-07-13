import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier } from "@/lib/rate-limit";
import { findStandardRecordsForSearch } from "@/lib/standard-records";
import {
  catalogMetadataWarning,
  decisionNotSupportedWarning,
  qualityStatus,
  requestId,
  toIso,
  v1RateLimitResponse,
} from "@/lib/v1-response";
import { sanitizeUrl } from "@/lib/url-safety";

function intParam(sp: URLSearchParams, name: string, fallback: number, min: number, max: number) {
  const raw = sp.get(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function cursorParam(sp: URLSearchParams) {
  const raw = sp.get("cursor");
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 5000 ? value : null;
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:records:search", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return v1RateLimitResponse(rate);

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const category = sp.get("category")?.trim();
  const updatedSince = sp.get("updatedSince")?.trim();
  const limit = intParam(sp, "limit", 50, 1, 200);
  const cursor = cursorParam(sp);

  if (limit === null || cursor === null) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "limit は1〜200、cursor は0〜5000の整数で指定してください" } },
      { status: 400 },
    );
  }
  if (q && q.length < 2) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "キーワード検索は2文字以上で指定してください" } },
      { status: 400 },
    );
  }

  let updatedSinceDate: Date | undefined;
  if (updatedSince) {
    updatedSinceDate = new Date(updatedSince);
    if (Number.isNaN(updatedSinceDate.getTime())) {
      return NextResponse.json(
        { error: { code: "invalid_query", message: "updatedSince はISO8601日時で指定してください" } },
        { status: 400 },
      );
    }
  }

  const standardized = await findStandardRecordsForSearch({
    q,
    category,
    updatedSince: updatedSinceDate,
    limit,
    cursor,
  });
  if (standardized) {
    return NextResponse.json({
      data: { records: standardized.records },
      meta: {
        requestId: requestId(),
        retrievedAt: new Date().toISOString(),
        sourceCount: standardized.records.length,
        total: standardized.total,
        nextCursor: standardized.nextCursor,
        mode: "standard_records",
      },
      warnings: [decisionNotSupportedWarning],
    });
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
  if (updatedSinceDate) where.updatedAt = { gte: updatedSinceDate };

  const [items, total] = await Promise.all([
    prisma.dataSource.findMany({
      where,
      include: { provider: true, tags: { include: { tag: true } } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: cursor,
    }),
    prisma.dataSource.count({ where }),
  ]);

  const records = items.map((source) => ({
    recordId: `catalog:${source.id}`,
    sourceId: source.id,
    sourceRecordId: source.id,
    category: source.category,
    title: source.name,
    description: source.description,
    prefectureCode: null,
    municipalityCode: null,
    address: null,
    geometry: null,
    observedAt: null,
    publishedAt: null,
    retrievedAt: toIso(source.lastCheckedAt ?? source.updatedAt),
    validFrom: null,
    validTo: null,
    sourceUrl: sanitizeUrl(source.officialUrl),
    licenseId: source.licenseName,
    qualityStatus: qualityStatus(source),
    rawDataReference: null,
    properties: {
      provider: {
        id: source.provider.id,
        name: source.provider.name,
        organizationType: source.provider.organizationType,
        officialUrl: source.provider.officialUrl ? sanitizeUrl(source.provider.officialUrl) : source.provider.officialUrl,
      },
      dataFormat: source.dataFormat,
      accessType: source.accessType,
      endpointUrl: source.endpointUrl ? sanitizeUrl(source.endpointUrl) : source.endpointUrl,
      documentationUrl: source.documentationUrl ? sanitizeUrl(source.documentationUrl) : source.documentationUrl,
      requiresApiKey: source.requiresApiKey,
      commercialUse: source.commercialUse,
      attributionRequired: source.attributionRequired,
      trustLevel: source.trustLevel,
      qualityScore: source.qualityScore,
      status: source.status,
      tags: source.tags.map((item) => ({ id: item.tag.id, name: item.tag.name, color: item.tag.color })),
      createdAt: toIso(source.createdAt),
      updatedAt: toIso(source.updatedAt),
    },
  }));

  const nextCursor = cursor + items.length < total ? String(cursor + items.length) : null;
  return NextResponse.json({
    data: { records },
    meta: {
      requestId: requestId(),
      retrievedAt: new Date().toISOString(),
      sourceCount: records.length,
      total,
      nextCursor,
      mode: "catalog_metadata",
    },
    warnings: [catalogMetadataWarning("catalog_metadata"), decisionNotSupportedWarning],
  });
}
