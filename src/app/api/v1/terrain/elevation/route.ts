import { NextRequest, NextResponse } from "next/server";
import { lookupElevation, UpstreamTileError, pointQualityFor } from "@/lib/terrain/adapters";
import { gsiTileFetcher } from "@/lib/terrain/gsi-fetch";
import { isValidCoordinate } from "@/lib/terrain/domain";
import { checkRateLimit, clientIdentifier } from "@/lib/rate-limit";
import { decisionNotSupportedWarning, requestId, v1RateLimitResponse } from "@/lib/v1-response";

const ALGORITHM_VERSION = "0.1.0";
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

function parseNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:terrain:elevation", clientIdentifier(request), RATE_LIMIT, RATE_WINDOW_MS);
  if (!rate.allowed) return v1RateLimitResponse(rate);

  const lat = parseNumber(request.nextUrl.searchParams.get("lat"));
  const lon = parseNumber(request.nextUrl.searchParams.get("lon"));
  if (lat === null || lon === null || !isValidCoordinate({ lat, lon })) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_query",
          message: "lat は -90〜90、lon は -180〜180 の数値で指定してください",
        },
      },
      { status: 400 },
    );
  }

  const id = requestId();
  try {
    const result = await lookupElevation(
      { lat, lon },
      { requestId: id, signal: request.signal },
      { fetcher: gsiTileFetcher, now: () => new Date() },
    );

    if (result.elevationM === null || result.source === null) {
      return NextResponse.json(
        {
          error: {
            code: "no_coverage",
            message: "対象地点に標高データがありません。データが無いことは安全を意味しません。",
            detail: `確認したソース: ${result.attempted.join(", ")}`,
          },
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      data: {
        coordinate: { lat, lon },
        elevationM: result.elevationM,
        source: result.source,
        quality: pointQualityFor(result.source),
        provenance: result.provenance,
      },
      meta: {
        requestId: id,
        algorithmVersion: ALGORITHM_VERSION,
        generatedAt: new Date().toISOString(),
      },
      warnings: [decisionNotSupportedWarning],
    });
  } catch (error) {
    if (error instanceof UpstreamTileError) {
      return NextResponse.json(
        {
          error: {
            code: "upstream_unavailable",
            message: "標高データの取得に失敗しました。データの有無を判定できません (判定不能は安全を意味しません)。",
            detail: error.attempted.join(", "),
          },
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: { code: "internal_error", message: "内部エラーが発生しました" } },
      { status: 500 },
    );
  }
}
