import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { fetchWithGuard, sanitizeUrl } from "@/lib/http-client";
import { buildElevationUrl, isGsiElevationEndpoint, isValidLatLon, parseElevationResponse } from "@/lib/gsi";
import { checkRateLimit, clientIdentifier, rateLimitHeaders, rateLimitResponse } from "@/lib/rate-limit";

const ELEVATION_RATE_LIMIT = 60;
const ELEVATION_RATE_WINDOW_MS = 60_000;
const ELEVATION_CACHE_TTL_MS = 10 * 60_000;
const elevationCache = new Map<string, { expiresAt: number; value: unknown }>();

/**
 * 地図クリック地点の標高取得。
 * 台帳に登録済みの地理院標高APIエンドポイントのみを取得対象とする
 * (任意URL取得は行わないセキュリティ方針を維持)。
 */
export async function GET(request: NextRequest) {
  const rate = checkRateLimit(
    "map:elevation",
    clientIdentifier(request),
    ELEVATION_RATE_LIMIT,
    ELEVATION_RATE_WINDOW_MS,
  );
  if (!rate.allowed) return rateLimitResponse(rate);

  const sp = request.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  if (!isValidLatLon(lat, lon)) {
    return NextResponse.json(
      { error: "validation_error", message: "lat/lon の値が不正です" },
      { status: 400 },
    );
  }

  const cacheKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const cached = elevationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.value, {
      headers: {
        ...rateLimitHeaders(rate),
        "X-CODIP-Cache": "hit",
      },
    });
  }

  const sources = await prisma.dataSource.findMany({
    where: { endpointUrl: { contains: "cyberjapandata2.gsi.go.jp" } },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
  const source = sources.find((candidate) => isGsiElevationEndpoint(candidate.endpointUrl));
  if (!source?.endpointUrl) {
    return NextResponse.json(
      { error: "not_found", message: "標高APIが台帳に登録されていません" },
      { status: 404 },
    );
  }

  const targetUrl = buildElevationUrl(source.endpointUrl, lat, lon);
  const result = await fetchWithGuard(targetUrl, { method: "GET", readBody: true });

  await prisma.fetchLog.create({
    data: {
      dataSourceId: source.id,
      executionType: "check",
      requestUrl: sanitizeUrl(targetUrl),
      method: "GET",
      statusCode: result.statusCode ?? null,
      success: result.success,
      responseTimeMs: result.responseTimeMs ?? null,
      responseSizeBytes: result.responseSizeBytes ?? null,
      contentType: result.contentType ?? null,
      errorType: result.errorType ?? null,
      errorMessage: result.errorMessage ?? null,
      note: "map: click elevation",
    },
  });

  if (!result.success) {
    return NextResponse.json(
      { success: false, errorType: result.errorType, message: result.errorMessage },
      { status: 502 },
    );
  }

  const parsed = parseElevationResponse(result.previewText ?? "");
  if (!parsed) {
    return NextResponse.json(
      { success: false, errorType: "parse_error", message: "標高APIのレスポンスを解釈できませんでした" },
      { status: 502 },
    );
  }

  const responseBody = { success: true, lat, lon, ...parsed };
  elevationCache.set(cacheKey, {
    expiresAt: Date.now() + ELEVATION_CACHE_TTL_MS,
    value: responseBody,
  });

  return NextResponse.json(responseBody, {
    headers: {
      ...rateLimitHeaders(rate),
      "X-CODIP-Cache": "miss",
    },
  });
}
