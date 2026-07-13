import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier } from "@/lib/rate-limit";
import { findStandardRecordsForPoint } from "@/lib/standard-records";
import { decisionNotSupportedWarning, qualityStatus, requestId, toIso, v1RateLimitResponse } from "@/lib/v1-response";
import { sanitizeUrl } from "@/lib/url-safety";

const GEOSPATIAL_FORMATS = ["GeoJSON", "Shapefile", "CityGML", "PNG"];
const MAX_CATEGORIES = 20;
const MAX_CATEGORY_LENGTH = 64;

function optionalNumberParam(sp: URLSearchParams, name: string, min: number, max: number) {
  const raw = sp.get(name);
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true as const, value: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < min || value > max) {
    return { ok: false as const };
  }
  return { ok: true as const, value };
}

function requiredNumberParam(sp: URLSearchParams, name: string, min: number, max: number) {
  const parsed = optionalNumberParam(sp, name, min, max);
  if (!parsed.ok || parsed.value === null) return null;
  return parsed.value;
}

function categoryList(sp: URLSearchParams) {
  const categories = (sp.get("categories") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (categories.length > MAX_CATEGORIES || categories.some((value) => value.length > MAX_CATEGORY_LENGTH)) {
    return { ok: false as const };
  }

  return { ok: true as const, value: categories };
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:records:point", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return v1RateLimitResponse(rate);

  const sp = request.nextUrl.searchParams;
  const lat = requiredNumberParam(sp, "lat", -90, 90);
  const lng = requiredNumberParam(sp, "lng", -180, 180);
  const radiusParam = optionalNumberParam(sp, "radiusM", 1, 100_000);
  const categoryParam = categoryList(sp);

  if (lat === null || lng === null) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "lat は -90〜90、lng は -180〜180 の数値で指定してください" } },
      { status: 400 },
    );
  }
  if (!radiusParam.ok) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "radiusM は1〜100000の数値で指定してください" } },
      { status: 400 },
    );
  }
  if (!categoryParam.ok) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "categories は20件以内、各64文字以内のカンマ区切りで指定してください" } },
      { status: 400 },
    );
  }

  const radiusM = radiusParam.value ?? 1_000;
  const categories = categoryParam.value;

  const standardized = await findStandardRecordsForPoint({ lat, lng, radiusM, categories });
  if (standardized) {
    return NextResponse.json({
      data: {
        point: { lat, lng, radiusM },
        records: standardized.records,
        candidateLayers: [],
        spatialEvaluation: {
          status: "evaluated",
          evaluated: true,
          reason: null,
        },
        dataAvailability: "standard_records",
        geometryStatus: "standardized",
      },
      meta: {
        requestId: requestId(),
        retrievedAt: new Date().toISOString(),
        sourceCount: standardized.records.length,
        total: standardized.total,
        nextCursor: standardized.nextCursor,
        mode: "standard_records_point",
      },
      warnings: [decisionNotSupportedWarning],
    });
  }

  const where: Prisma.DataSourceWhereInput = {
    OR: [{ dataFormat: { in: GEOSPATIAL_FORMATS } }, { accessType: "tile" }],
  };
  if (categories.length > 0) {
    where.category = { in: categories };
  }

  const candidateSources = await prisma.dataSource.findMany({
    where,
    include: { provider: true, tags: { include: { tag: true } } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const candidateLayers = candidateSources.map((source) => ({
    layerId: source.id,
    sourceId: source.id,
    title: source.name,
    category: source.category,
    dataFormat: source.dataFormat,
    sourceUrl: sanitizeUrl(source.officialUrl),
    licenseId: source.licenseName,
    qualityStatus: qualityStatus(source),
    qualityScore: source.qualityScore,
    lastCheckedAt: toIso(source.lastCheckedAt),
    featuresUrl: `/api/v1/layers/${source.id}/features`,
    dataAvailability: "catalog_only",
    geometryStatus: "not_standardized",
    provider: {
      id: source.provider.id,
      name: source.provider.name,
      organizationType: source.provider.organizationType,
    },
    tags: source.tags.map((item) => ({ id: item.tag.id, name: item.tag.name, color: item.tag.color })),
  }));

  return NextResponse.json({
    data: {
      point: { lat, lng, radiusM },
      records: [],
      candidateLayers,
      spatialEvaluation: {
        status: "not_available",
        evaluated: false,
        reason: "standard_records_not_ingested",
      },
      dataAvailability: "catalog_only",
      geometryStatus: "not_standardized",
    },
    meta: {
      requestId: requestId(),
      retrievedAt: new Date().toISOString(),
      sourceCount: candidateLayers.length,
      mode: "catalog_point_metadata",
    },
    warnings: [
      {
        code: "not_standardized",
        severity: "info",
        message: "現行MVPでは標準化済み地物を未投入のため、地点包含・周辺判定は実行していません。候補レイヤーの出典・品質状態を確認してください。",
        mode: "catalog_point_metadata",
      },
      {
        code: "decision_not_supported",
        severity: "warning",
        message: "施工可否・安全性・法令適合の最終判断には使用しないでください。",
      },
    ],
  });
}
