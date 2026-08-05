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

function haversineDistanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

function pointDistanceM(geometry: unknown, lat: number, lng: number): number | null {
  if (!geometry || typeof geometry !== "object") return null;
  const type = (geometry as { type?: unknown }).type;
  const coordinates = (geometry as { coordinates?: unknown }).coordinates;
  const coordArray = coordinates as unknown[] | null;
  if (type === "Point" && Array.isArray(coordArray) && coordArray.length >= 2) {
    return haversineDistanceM(lat, lng, Number(coordArray[1]), Number(coordArray[0]));
  }
  if (type === "MultiPoint" && Array.isArray(coordArray?.[0])) {
    const point = (coordArray as unknown[])[0] as number[];
    return haversineDistanceM(lat, lng, Number(point[1]), Number(point[0]));
  }
  return null;
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:assessments:point", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return v1RateLimitResponse(rate);

  const sp = request.nextUrl.searchParams;
  const lat = requiredNumberParam(sp, "lat", -90, 90);
  const lng = requiredNumberParam(sp, "lng", -180, 180);
  const radiusParam = optionalNumberParam(sp, "radiusM", 1, 100_000);
  const categoryParam = categoryList(sp);
  if (lat === null || lng === null || !radiusParam.ok || !categoryParam.ok) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "lat/lng/radiusM(1〜100000)/categories を正しく指定してください" } },
      { status: 400 },
    );
  }

  const radiusM = radiusParam.value ?? 1_000;
  const categories = categoryParam.value;
  const standardized = await findStandardRecordsForPoint({ lat, lng, radiusM, categories });

  if (standardized) {
    const summary = new Map<
      string,
      { category: string; recordCount: number; layers: Map<string, { layerId: string; title: string; count: number; minDistanceM: number | null }> }
    >();
    for (const record of standardized.records) {
      const key = record.category;
      if (!summary.has(key)) {
        summary.set(key, { category: key, recordCount: 0, layers: new Map() });
      }
      const group = summary.get(key)!;
      group.recordCount += 1;
      const layerId = record.sourceId;
      const title = String(record.properties.dataSource?.title ?? layerId);
      if (!group.layers.has(layerId)) {
        group.layers.set(layerId, { layerId, title, count: 0, minDistanceM: null });
      }
      const layer = group.layers.get(layerId)!;
      layer.count += 1;
      const distance = pointDistanceM(record.geometry, lat, lng);
      if (distance != null && (layer.minDistanceM == null || distance < layer.minDistanceM)) {
        layer.minDistanceM = Math.round(distance);
      }
    }
    const summaryRows = [...summary.values()].map((group) => ({
      category: group.category,
      recordCount: group.recordCount,
      layers: [...group.layers.values()],
    }));
    return NextResponse.json({
      data: {
        point: { lat, lng, radiusM },
        summary: summaryRows,
        records: standardized.records,
        spatialEvaluation: { status: "evaluated", evaluated: true, reason: null },
        dataAvailability: "standard_records",
        geometryStatus: "standardized",
      },
      meta: {
        requestId: requestId(),
        retrievedAt: new Date().toISOString(),
        categoryCount: summaryRows.length,
        recordCount: standardized.records.length,
        mode: "point_cross_section",
      },
      warnings: [decisionNotSupportedWarning],
    });
  }

  const where: Prisma.DataSourceWhereInput = {
    OR: [{ dataFormat: { in: GEOSPATIAL_FORMATS } }, { accessType: "tile" }],
  };
  if (categories.length > 0) where.category = { in: categories };
  const candidateSources = await prisma.dataSource.findMany({
    where,
    include: { provider: true, tags: { include: { tag: true } } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({
    data: {
      point: { lat, lng, radiusM },
      summary: [],
      records: [],
      candidateLayers: candidateSources.map((source) => ({
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
        provider: { id: source.provider.id, name: source.provider.name, organizationType: source.provider.organizationType },
        tags: source.tags.map((item) => ({ id: item.tag.id, name: item.tag.name, color: item.tag.color })),
      })),
      spatialEvaluation: { status: "not_available", evaluated: false, reason: "standard_records_not_ingested" },
      dataAvailability: "catalog_only",
      geometryStatus: "not_standardized",
    },
    meta: {
      requestId: requestId(),
      retrievedAt: new Date().toISOString(),
      sourceCount: candidateSources.length,
      mode: "catalog_point_cross_section",
    },
    warnings: [
      {
        code: "not_standardized",
        severity: "info",
        message: "標準化済み地物が未投入のため地点横断評価は実行していません。候補レイヤーの出典・品質状態を確認してください。",
        mode: "catalog_point_cross_section",
      },
      decisionNotSupportedWarning,
    ],
  });
}
