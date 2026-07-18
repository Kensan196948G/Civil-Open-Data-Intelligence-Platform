import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, clientIdentifier } from "@/lib/rate-limit";
import { findStandardFeaturesForLayer } from "@/lib/standard-records";
import { decisionNotSupportedWarning, qualityStatus, requestId, toIso, v1RateLimitResponse } from "@/lib/v1-response";
import { sanitizeUrl } from "@/lib/url-safety";

type Params = { params: Promise<{ id: string }> };
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
  return Number.isInteger(value) && value >= 0 && value <= 100_000 ? value : null;
}

function parseBbox(value: string | null): { ok: true; value?: [number, number, number, number] } | { ok: false } {
  if (!value) return { ok: true };
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return { ok: false };
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng >= -180 && maxLng <= 180 && minLat >= -90 && maxLat <= 90 && minLng < maxLng && minLat < maxLat) {
    return { ok: true, value: [minLng, minLat, maxLng, maxLat] };
  }
  return { ok: false };
}

export async function GET(request: NextRequest, { params }: Params) {
  const rate = checkRateLimit("api:v1:layers:features", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return v1RateLimitResponse(rate);

  const format = request.nextUrl.searchParams.get("format") ?? "geojson";
  const bbox = parseBbox(request.nextUrl.searchParams.get("bbox"));
  const limit = intParam(request.nextUrl.searchParams, "limit", 1_000, 1, 5_000);
  const cursor = cursorParam(request.nextUrl.searchParams);
  if (format !== "geojson") {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "format は geojson のみ対応しています" } },
      { status: 400 },
    );
  }
  if (!bbox.ok) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "bbox は minLng,minLat,maxLng,maxLat 形式で指定してください" } },
      { status: 400 },
    );
  }
  if (limit === null || cursor === null) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "limit は1〜5000、cursor は0〜100000の整数で指定してください" } },
      { status: 400 },
    );
  }

  const { id } = await params;
  const source = await prisma.dataSource.findFirst({
    where: {
      id,
      OR: [{ dataFormat: { in: GEOSPATIAL_FORMATS } }, { accessType: "tile" }],
    },
    include: { provider: true, tags: { include: { tag: true } } },
  });
  if (!source) {
    return NextResponse.json(
      { error: { code: "not_found", message: "指定されたレイヤーが見つかりません" } },
      { status: 404 },
    );
  }

  const standardized = await findStandardFeaturesForLayer({
    sourceId: source.id,
    bbox: bbox.value,
    limit,
    cursor,
  });
  if (standardized) {
    return NextResponse.json({
      type: "FeatureCollection",
      features: standardized.features,
      metadata: {
        requestId: requestId(),
        retrievedAt: new Date().toISOString(),
        layerId: source.id,
        sourceId: source.id,
        title: source.name,
        category: source.category,
        sourceUrl: sanitizeUrl(source.officialUrl),
        licenseId: source.licenseName,
        qualityStatus: qualityStatus(source),
        dataFormat: source.dataFormat,
        accessType: source.accessType,
        lastCheckedAt: toIso(source.lastCheckedAt),
        provider: {
          id: source.provider.id,
          name: source.provider.name,
          organizationType: source.provider.organizationType,
        },
        tags: source.tags.map((item) => ({ id: item.tag.id, name: item.tag.name, color: item.tag.color })),
        standardizedFeatures: true,
        dataAvailability: "standard_records",
        geometryStatus: "standardized",
        featureCount: standardized.metadata.featureCount,
        bbox: standardized.metadata.bbox,
        nextCursor: standardized.metadata.nextCursor,
        truncated: standardized.metadata.truncated,
        mode: "standard_records_features",
      },
      warnings: [decisionNotSupportedWarning],
    });
  }

  return NextResponse.json({
    type: "FeatureCollection",
    features: [],
    metadata: {
      requestId: requestId(),
      retrievedAt: new Date().toISOString(),
      layerId: source.id,
      sourceId: source.id,
      title: source.name,
      category: source.category,
      sourceUrl: sanitizeUrl(source.officialUrl),
      licenseId: source.licenseName,
      qualityStatus: qualityStatus(source),
      dataFormat: source.dataFormat,
      accessType: source.accessType,
      lastCheckedAt: toIso(source.lastCheckedAt),
      provider: {
        id: source.provider.id,
        name: source.provider.name,
        organizationType: source.provider.organizationType,
      },
      tags: source.tags.map((item) => ({ id: item.tag.id, name: item.tag.name, color: item.tag.color })),
      standardizedFeatures: false,
      dataAvailability: "catalog_only",
      geometryStatus: "not_standardized",
      featureCount: 0,
      bbox: null,
      mode: "catalog_layer_metadata",
    },
    warnings: [
      {
        code: "not_standardized",
        severity: "info",
        message: "現行MVPでは標準化済み地物を未投入のため、featuresは空配列です。出典・ライセンス・品質状態を確認するためのレイヤー契約として利用してください。",
        sourceId: source.id,
        mode: "catalog_layer_metadata",
      },
      {
        code: "decision_not_supported",
        severity: "warning",
        message: "施工可否・安全性・法令適合の最終判断には使用しないでください。",
        sourceId: source.id,
      },
    ],
  });
}
