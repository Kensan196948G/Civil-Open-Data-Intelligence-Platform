import type {
  Coordinate,
  DemSource,
  Provenance,
  QualityGrade,
  QualitySummary,
} from "../domain";
import { decodeElevation, decodePng, lonLatToTilePixel, rgbAt } from "../geo";
import type { FetchContext } from "./data-adapter";

/**
 * GSI elevation-tile access (design spec 6.1, 8.2, 9.1).
 *
 * Transport is injected as a {@link TileFetcher} so the lookup logic is
 * testable offline with fixture tiles and never touches the network by itself.
 * URLs are built exclusively from the constant table below plus clamped
 * integer tile indices, so no user input can steer the request target
 * (SSRF-safe by construction; the API layer adds an allowlist check on top).
 */

export interface GsiDemSourceSpec {
  /** Path segment under the GSI XYZ endpoint (e.g. "dem5a_png"). */
  readonly path: string;
  /** The single zoom level the source is served at. */
  readonly zoom: number;
  readonly resolutionM: number;
  readonly name: string;
}

/** Tile URL patterns and zoom levels: GSI 標高タイル一覧 (see GSI_TERMS_URL). */
export const GSI_DEM_SOURCES: Readonly<Record<DemSource, GsiDemSourceSpec>> = {
  DEM1A: { path: "dem1a_png", zoom: 17, resolutionM: 1, name: "国土地理院 標高タイル DEM1A" },
  DEM5A: { path: "dem5a_png", zoom: 15, resolutionM: 5, name: "国土地理院 標高タイル DEM5A" },
  DEM5B: { path: "dem5b_png", zoom: 15, resolutionM: 5, name: "国土地理院 標高タイル DEM5B" },
  DEM5C: { path: "dem5c_png", zoom: 15, resolutionM: 5, name: "国土地理院 標高タイル DEM5C" },
  DEM10B: { path: "dem_png", zoom: 14, resolutionM: 10, name: "国土地理院 標高タイル DEM10B" },
};

/**
 * Default resolution order (design spec 6.1: best available source first).
 * DEM1A is excluded by default because its coverage is sparse and every miss
 * costs one upstream round-trip; callers can opt in via `priority`.
 */
export const DEFAULT_DEM_PRIORITY: readonly DemSource[] = ["DEM5A", "DEM5B", "DEM5C", "DEM10B"];

/**
 * Provisional quality grade per source for single-point results (MVP): graded
 * by resolution and survey method precision (1A/5A laser > 5B photogrammetry >
 * 5C > 10B). Area analyses will compute grades from actual pixel mixes later.
 */
const SOURCE_QUALITY_GRADE: Readonly<Record<DemSource, QualityGrade>> = {
  DEM1A: "A",
  DEM5A: "A",
  DEM5B: "B",
  DEM5C: "C",
  DEM10B: "D",
};

/** QualitySummary for a single-point lookup that resolved via one source. */
export function pointQualityFor(source: DemSource): QualitySummary {
  return {
    grade: SOURCE_QUALITY_GRADE[source],
    missingRatio: 0,
    sourceMix: { DEM1A: 0, DEM5A: 0, DEM5B: 0, DEM5C: 0, DEM10B: 0, [source]: 1 },
    coverage: "FULL",
    warnings: [],
  };
}

export const GSI_TILE_BASE_URL = "https://cyberjapandata.gsi.go.jp/xyz/";
export const GSI_TERMS_URL = "https://maps.gsi.go.jp/development/ichiran.html";

export function buildGsiDemTileUrl(source: DemSource, x: number, y: number): URL {
  const spec = GSI_DEM_SOURCES[source];
  return new URL(`${spec.path}/${spec.zoom}/${x}/${y}.png`, GSI_TILE_BASE_URL);
}

/** Minimal transport result. `bytes` is null for bodyless responses. */
export interface TileFetchResult {
  readonly status: number;
  readonly bytes: Uint8Array | null;
}

export type TileFetcher = (url: URL, ctx: FetchContext) => Promise<TileFetchResult>;

export interface ElevationLookupDeps {
  readonly fetcher: TileFetcher;
  /** Resolution order; defaults to {@link DEFAULT_DEM_PRIORITY}. */
  readonly priority?: readonly DemSource[];
  /** Injected clock for provenance timestamps. */
  readonly now: () => Date;
}

export interface ElevationLookupResult {
  readonly elevationM: number | null;
  readonly source: DemSource | null;
  /** FULL when a value was found; NONE when every source lacks data here. */
  readonly coverage: "FULL" | "NONE";
  readonly attempted: readonly DemSource[];
  readonly provenance: readonly Provenance[];
}

/**
 * Raised when at least one source failed (network error, upstream 5xx or a
 * corrupt tile) and no elevation could be found. Absence of data must not be
 * asserted in that situation: a failed source might still hold a value
 * (Unknown is not Safe), so callers map this to 503 rather than 404.
 */
export class UpstreamTileError extends Error {
  readonly attempted: readonly DemSource[];

  constructor(message: string, attempted: readonly DemSource[]) {
    super(message);
    this.name = "UpstreamTileError";
    this.attempted = attempted;
  }
}

/**
 * Resolve the elevation at a coordinate by walking the source priority list.
 * Each source is consulted at its own zoom level; a 404 or a no-data pixel
 * means "this source has nothing here" and the next source is tried.
 */
export async function lookupElevation(
  coordinate: Coordinate,
  ctx: FetchContext,
  deps: ElevationLookupDeps,
): Promise<ElevationLookupResult> {
  const priority = deps.priority ?? DEFAULT_DEM_PRIORITY;
  const attempted: DemSource[] = [];
  const failures: string[] = [];

  for (const source of priority) {
    attempted.push(source);
    const spec = GSI_DEM_SOURCES[source];
    const { tile, px, py } = lonLatToTilePixel(coordinate.lon, coordinate.lat, spec.zoom);
    const url = buildGsiDemTileUrl(source, tile.x, tile.y);

    let result: TileFetchResult;
    try {
      result = await deps.fetcher(url, ctx);
    } catch (error) {
      if (ctx.signal?.aborted === true) {
        // The client is gone — stop walking sources instead of retrying all.
        throw error;
      }
      failures.push(`${source}: fetch failed (${String(error)})`);
      continue;
    }

    if (result.status === 404 || result.status === 204) {
      continue; // The source has no tile here — a legitimate absence.
    }
    if (result.status !== 200 || result.bytes === null) {
      failures.push(`${source}: upstream returned HTTP ${result.status}`);
      continue;
    }

    let elevationM: number | null;
    try {
      const png = await decodePng(result.bytes);
      elevationM = decodeElevation(...rgbAt(png, px, py));
    } catch (error) {
      failures.push(`${source}: tile decode failed (${String(error)})`);
      continue;
    }

    if (elevationM === null) {
      continue; // No-data sentinel at this pixel — try the next source.
    }

    return {
      elevationM,
      source,
      coverage: "FULL",
      attempted,
      provenance: [
        {
          sourceId: `gsi_${spec.path}`,
          sourceName: spec.name,
          sourceUrl: url.toString(),
          termsUrl: GSI_TERMS_URL,
          retrievedAt: deps.now().toISOString(),
          resolutionM: spec.resolutionM,
          processed: true,
          processingNote: "GSI標高タイルPNGをspec 8.2の式で標高値へ復号",
        },
      ],
    };
  }

  if (failures.length > 0) {
    // A failed source might still hold data: absence cannot be asserted.
    throw new UpstreamTileError(failures.join("; "), attempted);
  }

  return { elevationM: null, source: null, coverage: "NONE", attempted, provenance: [] };
}
