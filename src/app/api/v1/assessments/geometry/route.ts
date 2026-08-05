import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier } from "@/lib/rate-limit";
import { findStandardRecordsForGeometry } from "@/lib/standard-records";
import { decisionNotSupportedWarning, qualityStatus, requestId, toIso, v1RateLimitResponse } from "@/lib/v1-response";
import { sanitizeUrl } from "@/lib/url-safety";

const GEOSPATIAL_FORMATS = ["GeoJSON", "Shapefile", "CityGML", "PNG"];

function numberOrNull(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function intOrNull(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value;
}

function buildSummary(records: Array<{ category: string; sourceId: string; geometry: unknown; properties: { dataSource?: { title?: string } } }>) {
  const map = new Map<string, { category: string; recordCount: number; layers: Map<string, { layerId: string; title: string; count: number }> }>();
  for (const record of records) {
    if (!map.has(record.category)) {
      map.set(record.category, { category: record.category, recordCount: 0, layers: new Map() });
    }
    const group = map.get(record.category)!;
    group.recordCount += 1;
    const layerId = record.sourceId;
    const title = String(record.properties.dataSource?.title ?? layerId);
    if (!group.layers.has(layerId)) group.layers.set(layerId, { layerId, title, count: 0 });
    group.layers.get(layerId)!.count += 1;
  }
  return [...map.values()].map((group) => ({
    category: group.category,
    recordCount: group.recordCount,
    layers: [...group.layers.values()],
  }));
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit("api:v1:assessments:geometry", clientIdentifier(request), 60, 60_000);
  if (!rate.allowed) return v1RateLimitResponse(rate);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: { code: "invalid_body", message: "JSONボディが必要です" } }, { status: 400 });
  }
  const mode = body.mode;
  if (mode !== "circle" && mode !== "bbox" && mode !== "polygon") {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "mode は circle / bbox / polygon のいずれかです" } },
      { status: 400 },
    );
  }

  const center =
    mode === "circle" && body.center && typeof body.center === "object"
      ? {
          lat: numberOrNull((body.center as { lat?: unknown }).lat),
          lng: numberOrNull((body.center as { lng?: unknown }).lng),
        }
      : null;
  const radiusM = numberOrNull(body.radiusM);
  const bufferM = numberOrNull(body.bufferM) ?? 0;
  const bbox =
    mode === "bbox" && Array.isArray(body.bbox) && body.bbox.length === 4
      ? (body.bbox as unknown[]).map(numberOrNull)
      : null;
  const q = typeof body.q === "string" ? body.q.trim() : "";
  const limit = intOrNull(body.limit) ?? 100;
  const cursor = intOrNull(body.cursor) ?? 0;

  if (mode === "circle" && (!center || center.lat == null || center.lng == null)) {
    return NextResponse.json({ error: { code: "invalid_body", message: "circle は center.lat/lng が必要です" } }, { status: 400 });
  }
  if (mode === "circle" && (radiusM == null || radiusM < 1 || radiusM > 100_000)) {
    return NextResponse.json({ error: { code: "invalid_body", message: "radiusM は1〜100000です" } }, { status: 400 });
  }
  if (mode === "bbox" && (!bbox || bbox.some((value) => value == null))) {
    return NextResponse.json({ error: { code: "invalid_body", message: "bbox は [minLng,minLat,maxLng,maxLat] の数値4つです" } }, { status: 400 });
  }
  if (mode === "polygon" && (!body.polygon || typeof body.polygon !== "object")) {
    return NextResponse.json({ error: { code: "invalid_body", message: "polygon はGeoJSONオブジェクトが必要です" } }, { status: 400 });
  }
  if (limit < 1 || limit > 5000 || cursor < 0 || cursor > 100_000) {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "limit は1〜5000、cursor は0〜100000です" } },
      { status: 400 },
    );
  }

  const bboxTuple =
    bbox && bbox.every((value) => value != null)
      ? ([bbox[0], bbox[1], bbox[2], bbox[3]] as [number, number, number, number])
      : undefined;
  const standardized = await findStandardRecordsForGeometry({
    mode,
    center: center && center.lat != null && center.lng != null ? { lat: center.lat, lng: center.lng } : undefined,
    radiusM: radiusM ?? undefined,
    bbox: bboxTuple,
    polygonGeoJson: mode === "polygon" ? body.polygon : undefined,
    bufferM,
    q: q || undefined,
    limit,
    cursor,
  });

  if (standardized) {
    const summary = buildSummary(
      standardized.records as unknown as Array<{
        category: string;
        sourceId: string;
        geometry: unknown;
        properties: { dataSource?: { title?: string } };
      }>,
    );
    return NextResponse.json({
      data: {
        query: { mode, center, radiusM, bbox, bufferM, q: q || null },
        summary,
        records: standardized.records,
        spatialEvaluation: { status: "evaluated", evaluated: true, reason: null },
        dataAvailability: "standard_records",
        geometryStatus: "standardized",
      },
      meta: {
        requestId: requestId(),
        retrievedAt: new Date().toISOString(),
        categoryCount: summary.length,
        recordCount: standardized.records.length,
        total: standardized.total,
        nextCursor: standardized.nextCursor,
        mode: "geometry_assessment",
      },
      warnings: [decisionNotSupportedWarning],
    });
  }

  const where: Prisma.DataSourceWhereInput = {
    OR: [{ dataFormat: { in: GEOSPATIAL_FORMATS } }, { accessType: "tile" }],
  };
  const candidateSources = await prisma.dataSource.findMany({
    where,
    include: { provider: true, tags: { include: { tag: true } } },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({
    data: {
      query: { mode, center, radiusM, bbox, bufferM, q: q || null },
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
      mode: "catalog_geometry_assessment",
    },
    warnings: [
      {
        code: "not_standardized",
        severity: "info",
        message: "標準化済み地物が未投入のため空間評価は実行していません。候補レイヤーの出典・品質状態を確認してください。",
        mode: "catalog_geometry_assessment",
      },
      decisionNotSupportedWarning,
    ],
  });
}
