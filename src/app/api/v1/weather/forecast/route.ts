import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIdentifier, rateLimitResponse } from "@/lib/rate-limit";
import { decisionNotSupportedWarning, requestId } from "@/lib/v1-response";
import { TtlCache } from "@/lib/ttl-cache";

const ALLOWED_HOST = "api.open-meteo.com";
const FORECAST_CACHE_TTL_MS = 30 * 60_000;
const forecastCache = new TtlCache<unknown>(200, FORECAST_CACHE_TTL_MS);

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:weather:forecast", clientIdentifier(request), 120, 60_000);
  if (!rate.allowed) return rateLimitResponse(rate);
  const sp = request.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lon = Number(sp.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "lat は -90〜90、lon は -180〜180 の数値で指定してください" } },
      { status: 400 },
    );
  }

  const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = forecastCache.get(cacheKey);
  if (cached !== undefined) {
    return NextResponse.json(cached, { headers: { "X-CODIP-Cache": "hit" } });
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max");
  url.searchParams.set("timezone", "Asia/Tokyo");
  url.searchParams.set("forecast_days", "7");

  if (url.hostname !== ALLOWED_HOST || url.protocol !== "https:") {
    return NextResponse.json({ error: { code: "blocked_url", message: "取得先が許可されていません" } }, { status: 502 });
  }

  interface ForecastPayload {
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_sum?: number[];
      wind_speed_10m_max?: number[];
    };
  }
  let payload: ForecastPayload | null = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { "User-Agent": "CivilOpenDataIntelligencePlatform/0.1 (weather-forecast)" },
      });
      if (!response.ok) throw new Error(`upstream returned HTTP ${response.status}`);
      payload = (await response.json()) as ForecastPayload;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return NextResponse.json(
      { error: { code: "upstream_unavailable", message: "週間予報の取得に失敗しました (参考情報)" } },
      { status: 503 },
    );
  }

  if (!payload?.daily?.time) {
    return NextResponse.json(
      { error: { code: "upstream_invalid_response", message: "週間予報のレスポンス形式が不正です" } },
      { status: 502 },
    );
  }
  const daily = payload.daily;
  const time = daily.time;
  if (time === undefined) {
    return NextResponse.json(
      { error: { code: "upstream_invalid_response", message: "週間予報のレスポンス形式が不正です" } },
      { status: 502 },
    );
  }
  const days = time.map((date, index) => ({
    date,
    weatherCode: daily?.weather_code?.[index] ?? null,
    tempMaxC: daily?.temperature_2m_max?.[index] ?? null,
    tempMinC: daily?.temperature_2m_min?.[index] ?? null,
    precipSumMm: daily?.precipitation_sum?.[index] ?? null,
    windMaxMs: daily?.wind_speed_10m_max?.[index] ?? null,
  }));

  const body = {
    data: {
      point: { lat, lon },
      source: "open_meteo_forecast_info",
      generatedAt: new Date().toISOString(),
      days,
    },
    meta: { requestId: requestId(), retrievedAt: new Date().toISOString() },
    warnings: [
      {
        code: "reference_information",
        severity: "info" as const,
        message: "Open-Meteo 7日間予報は参考情報です。気象庁発表の注意報・警報を必ず確認してください。",
      },
      decisionNotSupportedWarning,
    ],
  };
  forecastCache.set(cacheKey, body);
  return NextResponse.json(body, { headers: { "X-CODIP-Cache": "miss" } });
}
