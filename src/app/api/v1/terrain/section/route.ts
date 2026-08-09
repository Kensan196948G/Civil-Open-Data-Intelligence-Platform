import { NextRequest, NextResponse } from "next/server";
import { analyzeSection } from "@/lib/terrain/section-service";
import { DemTileStore } from "@/lib/terrain/elevation-sampler";
import { gsiFetch } from "@/lib/terrain/gsi-fetch";
import { isValidCoordinate } from "@/lib/terrain/domain";
import { checkRateLimit, clientIdentifier } from "@/lib/rate-limit";
import { decisionNotSupportedWarning, requestId, v1RateLimitResponse } from "@/lib/v1-response";

const ALGORITHM_VERSION = "0.1.0";
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

function parseNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:terrain:section", clientIdentifier(request), RATE_LIMIT, RATE_WINDOW_MS);
  if (!rate.allowed) return v1RateLimitResponse(rate);

  const sp = request.nextUrl.searchParams;
  const startLat = parseNumber(sp.get("startLat"));
  const startLon = parseNumber(sp.get("startLon"));
  const endLat = parseNumber(sp.get("endLat"));
  const endLon = parseNumber(sp.get("endLon"));
  const start = startLat === null || startLon === null ? null : { lat: startLat, lon: startLon };
  const end = endLat === null || endLon === null ? null : { lat: endLat, lon: endLon };

  if (start === null || end === null || !isValidCoordinate(start) || !isValidCoordinate(end)) {
    return errorResponse(
      "invalid_query",
      "startLat/startLon/endLat/endLon は緯度 -90〜90、経度 -180〜180 の数値で指定してください",
      400,
    );
  }

  const id = requestId();
  const result = await analyzeSection(
    start,
    end,
    { store: new DemTileStore(gsiFetch), now: () => new Date() },
  );

  if (result.kind === "too-short") {
    return errorResponse("analysis_area_too_small", `断面線が短すぎます (${result.lengthM.toFixed(0)}m)。30m 以上を指定してください`, 422);
  }
  if (result.kind === "too-long") {
    return errorResponse("analysis_area_too_large", `断面線が長すぎます (${result.lengthM.toFixed(0)}m)。20km 以下を指定してください`, 413);
  }
  if (result.kind === "no-coverage") {
    return errorResponse("no_coverage", "この断面の DEM データはありません。データが無いことは安全を意味しません。", 404);
  }
  if (result.kind === "unavailable" || result.kind === "error") {
    return errorResponse("upstream_unavailable", "DEM の取得に失敗しました。判定不能は安全を意味しません。", 503);
  }

  return NextResponse.json({
    data: {
      kind: "ok",
      start: result.start,
      end: result.end,
      samples: result.samples,
      stats: result.stats,
      quality: result.quality,
      provenance: result.provenance,
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
  });
}
