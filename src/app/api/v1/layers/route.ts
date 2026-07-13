import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier } from "@/lib/rate-limit";
import { findStandardLayers } from "@/lib/standard-records";
import { decisionNotSupportedWarning, qualityStatus, requestId, toIso, v1RateLimitResponse } from "@/lib/v1-response";
import { sanitizeUrl } from "@/lib/url-safety";

const GEOSPATIAL_FORMATS = ["GeoJSON", "Shapefile", "CityGML", "PNG"];

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
  const rate = checkRateLimit("api:v1:layers", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return v1RateLimitResponse(rate);

  const sp = request.nextUrl.searchParams;
  const q = sp.get("q")?.trim();
  const category = sp.get("category")?.trim();
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

  const standardized = await findStandardLayers({ q, category, limit, cursor });
  if (standardized) {
    return NextResponse.json({
      data: { layers: standardized.layers },
      meta: {
        requestId: requestId(),
        retrievedAt: new Date().toISOString(),
        sourceCount: standardized.layers.length,
        total: standardized.total,
        nextCursor: standardized.nextCursor,
        mode: "standard_records_layers",
      },
      warnings: [decisionNotSupportedWarning],
    });
  }

  const where: Prisma.DataSourceWhereInput = {
    OR: [{ dataFormat: { in: GEOSPATIAL_FORMATS } }, { accessType: "tile" }],
  };
  if (q) {
    where.AND = [
      {
        OR: [
          { name: { contains: q } },
          { nameEn: { contains: q } },
          { description: { contains: q } },
        ],
      },
    ];
  }
  if (category) where.category = category;

  const [sources, total] = await Promise.all([
    prisma.dataSource.findMany({
      where,
      include: { provider: true, tags: { include: { tag: true } } },
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: cursor,
    }),
    prisma.dataSource.count({ where }),
  ]);

  const layers = sources.map((source) => ({
    layerId: source.id,
    sourceId: source.id,
    title: source.name,
    description: source.description,
    category: source.category,
    dataFormat: source.dataFormat,
    accessType: source.accessType,
    sourceUrl: sanitizeUrl(source.officialUrl),
    licenseId: source.licenseName,
    qualityStatus: qualityStatus(source),
    qualityScore: source.qualityScore,
    status: source.status,
    updatedAt: toIso(source.updatedAt),
    lastCheckedAt: toIso(source.lastCheckedAt),
    retrievedAt: toIso(source.lastCheckedAt ?? source.updatedAt),
    featuresUrl: `/api/v1/layers/${source.id}/features`,
    provider: {
      id: source.provider.id,
      name: source.provider.name,
      organizationType: source.provider.organizationType,
    },
    attributionRequired: source.attributionRequired,
    commercialUse: source.commercialUse,
    tags: source.tags.map((item) => ({ id: item.tag.id, name: item.tag.name, color: item.tag.color })),
    dataAvailability: "catalog_only",
    geometryStatus: "not_standardized",
    featureCount: null,
    bbox: null,
    capabilities: {
      format: "geojson",
      bbox: false,
      standardizedFeatures: false,
    },
  }));

  return NextResponse.json({
    data: { layers },
    meta: {
      requestId: requestId(),
      retrievedAt: new Date().toISOString(),
      sourceCount: layers.length,
      total,
      nextCursor: cursor + sources.length < total ? String(cursor + sources.length) : null,
      mode: "catalog_layer_metadata",
    },
    warnings: [
      {
        code: "catalog_metadata_only",
        severity: "info",
        message: "現行MVPはレイヤー候補の台帳メタデータを返します。標準化済み地物はPostGIS standard_records投入後に提供します。",
        mode: "catalog_layer_metadata",
      },
      decisionNotSupportedWarning,
    ],
  });
}
