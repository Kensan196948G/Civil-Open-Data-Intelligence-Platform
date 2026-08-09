import { NextRequest, NextResponse } from "next/server";
import { analyzeTerrain } from "@/lib/terrain/terrain-service";
import { DemTileStore } from "@/lib/terrain/elevation-sampler";
import { gsiFetch } from "@/lib/terrain/gsi-fetch";
import { isValidCoordinate } from "@/lib/terrain/domain";
import { checkRateLimit, clientIdentifier } from "@/lib/rate-limit";
import { decisionNotSupportedWarning, requestId, v1RateLimitResponse } from "@/lib/v1-response";
import { TtlCache } from "@/lib/ttl-cache";

const ALGORITHM_VERSION = "0.1.0";
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const ANALYSIS_CACHE_TTL_MS = 5 * 60_000;
const analysisCache = new TtlCache<unknown>(200, ANALYSIS_CACHE_TTL_MS);

function parseNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:terrain:analysis", clientIdentifier(request), RATE_LIMIT, RATE_WINDOW_MS);
  if (!rate.allowed) return v1RateLimitResponse(rate);

  const lat = parseNumber(request.nextUrl.searchParams.get("lat"));
  const lon = parseNumber(request.nextUrl.searchParams.get("lon"));
  if (lat === null || lon === null || !isValidCoordinate({ lat, lon })) {
    return errorResponse(
      "invalid_query",
      "lat は -90〜90、lon は -180〜180 の数値で指定してください",
      400,
    );
  }

  const id = requestId();
  const cacheKey = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const cached = analysisCache.get(cacheKey);
  if (cached !== undefined) {
    return NextResponse.json(cached, { headers: { "X-CODIP-Cache": "hit" } });
  }

  const result = await analyzeTerrain(
    { lat, lon },
    { store: new DemTileStore(gsiFetch), now: () => new Date() },
  );

  if (result.kind === "no-coverage") {
    return errorResponse(
      "no_coverage",
      "この範囲の DEM データはありません。データが無いことは安全を意味しません。",
      404,
    );
  }
  if (result.kind === "unavailable" || result.kind === "error") {
    return errorResponse(
      "upstream_unavailable",
      "DEM の取得に失敗しました。データの不在は断定できません (判定不能は安全を意味しません)。",
      503,
    );
  }

  const body = {
    data: {
      kind: "ok",
      center: result.center,
      stats: result.stats,
      classes: result.classes,
      quality: result.quality,
      provenance: result.provenance,
      extentM: result.extentM,
    },
    meta: {
      requestId: id,
      algorithmVersion: ALGORITHM_VERSION,
      generatedAt: new Date().toISOString(),
    },
    warnings: [
      decisionNotSupportedWarning,
      ...result.quality.warnings.map((message) => ({
        code: "data_quality_warning",
        severity: "warning" as const,
        message,
      })),
    ],
  };
  analysisCache.set(cacheKey, body);
  return NextResponse.json(body, { headers: { "X-CODIP-Cache": "miss" } });
}
