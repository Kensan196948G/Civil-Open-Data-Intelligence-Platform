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

/** bufferM の上限。radiusM(最大100km)へ加算されるため、合計が非現実的にならない値に留める。 */
const MAX_BUFFER_M = 10_000;

/** GeoJSON polygon の総頂点数上限。ST_GeomFromGeoJSON と後続の空間演算の負荷を有界にする。 */
const MAX_POLYGON_VERTICES = 10_000;

/** 地理座標の範囲。境界値は有効とする。 */
function validLngLat(lng: number, lat: number): boolean {
  return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

function validBboxTuple(bbox: Array<number | null>): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox as [number, number, number, number];
  return validLngLat(minLng, minLat) && validLngLat(maxLng, maxLat) && minLng < maxLng && minLat < maxLat;
}

type PolygonVerdict = { ok: true } | { ok: false; message: string };

/**
 * GeoJSON の LinearRing 集合を検証し、総頂点数を返す。不正なら null。
 *
 * RFC 7946 の LinearRing は「4点以上」かつ「先頭と末尾が一致（閉じている）」
 * であることを要求する。閉鎖条件を見ないと未閉鎖のリングが PostGIS へ渡り、
 * ST_GeomFromGeoJSON 側の挙動に委ねることになる。
 * position は3要素目（標高）を許すが、**全要素が有限数値である**ことを求める
 * （先頭2要素だけ見ると `[139, 35, "invalid"]` を受け入れてしまう）。
 */
function countRingVertices(rings: unknown): number | null {
  if (!Array.isArray(rings) || rings.length === 0) return null;
  let total = 0;
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 4) return null;
    for (const position of ring) {
      if (!Array.isArray(position) || position.length < 2 || position.length > 3) return null;
      for (const component of position) {
        if (typeof component !== "number" || !Number.isFinite(component)) return null;
      }
      const [lng, lat] = position as number[];
      if (!validLngLat(lng, lat)) return null;
    }
    // 閉鎖条件: 先頭と末尾の position が一致すること
    const first = ring[0] as number[];
    const last = ring[ring.length - 1] as number[];
    if (first.length !== last.length || first.some((value, i) => value !== last[i])) return null;
    total += ring.length;
  }
  return total;
}

function validatePolygonGeoJson(value: unknown): PolygonVerdict {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "polygon はGeoJSONオブジェクトが必要です" };
  }
  const geo = value as { type?: unknown; coordinates?: unknown };
  if (geo.type !== "Polygon" && geo.type !== "MultiPolygon") {
    return { ok: false, message: "polygon.type は Polygon または MultiPolygon です" };
  }
  let vertices: number | null = 0;
  if (geo.type === "Polygon") {
    vertices = countRingVertices(geo.coordinates);
  } else {
    if (!Array.isArray(geo.coordinates) || geo.coordinates.length === 0) {
      return { ok: false, message: "polygon.coordinates の形式が不正です" };
    }
    let total = 0;
    for (const polygon of geo.coordinates) {
      const count = countRingVertices(polygon);
      if (count === null) {
        total = -1;
        break;
      }
      total += count;
    }
    vertices = total >= 0 ? total : null;
  }
  if (vertices === null) {
    return {
      ok: false,
      message:
        "polygon.coordinates は1つ以上のリングを持ち、各リングは4点以上・先頭と末尾が一致（閉じている）・" +
        "各座標は有限数値で経度-180〜180・緯度-90〜90である必要があります",
    };
  }
  if (vertices > MAX_POLYGON_VERTICES) {
    return { ok: false, message: `polygon の頂点数は${MAX_POLYGON_VERTICES}以下です（指定: ${vertices}）` };
  }
  return { ok: true };
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
  // bufferM は radiusM に加算されて ST_DWithin の距離になる
  // (src/lib/standard-records.ts の `radiusM + bufferM`)。上限が無いと
  // radiusM の 100km 制限を加算で突破でき、GIST インデックスが効かない
  // 測地距離計算が standard_records 全行に走る。未認証で到達できるため
  // 単独で DB の CPU を枯渇させられた。
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
  // bbox と polygon には地理座標の範囲検査を入れたが、circle の中心だけ
  // 有限数値の検査しか無く、lat:91 / lng:181 が ST_MakePoint へ渡っていた。
  if (mode === "circle" && center && !validLngLat(center.lng as number, center.lat as number)) {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "center は経度-180〜180・緯度-90〜90で指定してください" } },
      { status: 400 },
    );
  }
  if (mode === "circle" && (radiusM == null || radiusM < 1 || radiusM > 100_000)) {
    return NextResponse.json({ error: { code: "invalid_body", message: "radiusM は1〜100000です" } }, { status: 400 });
  }
  if (bufferM < 0 || bufferM > MAX_BUFFER_M) {
    return NextResponse.json(
      { error: { code: "invalid_body", message: `bufferM は0〜${MAX_BUFFER_M}です` } },
      { status: 400 },
    );
  }
  if (mode === "bbox" && (!bbox || bbox.some((value) => value == null))) {
    return NextResponse.json({ error: { code: "invalid_body", message: "bbox は [minLng,minLat,maxLng,maxLat] の数値4つです" } }, { status: 400 });
  }
  // 数値4つであることに加えて、地理座標として成立していることを要求する。
  // 範囲検査が無いと [-1e9,-1e9,1e9,1e9] のような包絡矩形が通り、
  // 全件走査と同義になる。判定は layers/[id]/features の parseBbox と同じ形。
  if (mode === "bbox" && bbox && !validBboxTuple(bbox)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_body",
          message: "bbox は経度-180〜180・緯度-90〜90で、minLng<maxLng かつ minLat<maxLat が必要です",
        },
      },
      { status: 400 },
    );
  }
  if (mode === "polygon" && (!body.polygon || typeof body.polygon !== "object")) {
    return NextResponse.json({ error: { code: "invalid_body", message: "polygon はGeoJSONオブジェクトが必要です" } }, { status: 400 });
  }
  // typeof === "object" だけでは {} や [] が ST_GeomFromGeoJSON へ到達し、
  // 未処理の例外で 500 になる。型と頂点数をここで確定させる。
  if (mode === "polygon") {
    const verdict = validatePolygonGeoJson(body.polygon);
    if (!verdict.ok) {
      return NextResponse.json({ error: { code: "invalid_body", message: verdict.message } }, { status: 400 });
    }
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
