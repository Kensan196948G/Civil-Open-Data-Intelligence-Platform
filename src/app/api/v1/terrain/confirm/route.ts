import { NextRequest, NextResponse } from "next/server";
import { analyzeTerrain } from "@/lib/terrain/terrain-service";
import { DemTileStore } from "@/lib/terrain/elevation-sampler";
import { gsiFetch } from "@/lib/terrain/gsi-fetch";
import { buildConfirmCards } from "@/lib/terrain/confirm-cards";
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

export async function GET(request: NextRequest) {
  const rate = checkRateLimit("api:v1:terrain:confirm", clientIdentifier(request), RATE_LIMIT, RATE_WINDOW_MS);
  if (!rate.allowed) return v1RateLimitResponse(rate);

  const sp = request.nextUrl.searchParams;
  const lat = parseNumber(sp.get("lat"));
  const lon = parseNumber(sp.get("lon"));
  if (lat === null || lon === null || !isValidCoordinate({ lat, lon })) {
    return NextResponse.json(
      { error: { code: "invalid_query", message: "lat は -90〜90、lon は -180〜180 の数値で指定してください" } },
      { status: 400 },
    );
  }

  const id = requestId();
  const terrain = await analyzeTerrain(
    { lat, lon },
    { store: new DemTileStore(gsiFetch), now: () => new Date() },
  );

  const cards = buildConfirmCards({ terrain: terrain.kind === "ok" ? terrain : null, section: null });
  return NextResponse.json({
    data: {
      point: { lat, lon },
      cards: cards.cards,
      passedCount: cards.passedCount,
      skippedCount: cards.skippedCount,
      terrain: terrain.kind === "ok" ? terrain : null,
      terrainStatus: terrain.kind,
    },
    meta: {
      requestId: id,
      algorithmVersion: ALGORITHM_VERSION,
      generatedAt: new Date().toISOString(),
    },
    warnings: [decisionNotSupportedWarning],
  });
}
